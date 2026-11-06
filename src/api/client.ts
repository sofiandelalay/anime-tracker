/**
 * Client AniList unique : file d'attente (≤ 25 req/min), gestion du 429 (Retry-After).
 * AniList limite actuellement à 30 requêtes par minute.
 */

export const ANILIST_ENDPOINT = 'https://graphql.anilist.co'

type Sleep = (ms: number) => Promise<void>
const realSleep: Sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Fenêtre glissante : au plus `max` départs par `windowMs`, exécutés un par un. */
export class RateLimiter {
  private starts: number[] = []
  private pauseUntil = 0
  private chain: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly max: number,
    private readonly windowMs = 60_000,
    private readonly now: () => number = Date.now,
    private readonly sleep: Sleep = realSleep,
  ) {}

  /** Suspend la file (ex. après un 429). */
  pause(ms: number): void {
    this.pauseUntil = Math.max(this.pauseUntil, this.now() + ms)
  }

  schedule<T>(task: () => Promise<T>): Promise<T> {
    const run = this.chain.then(() => this.waitTurn()).then(task)
    this.chain = run.catch(() => undefined)
    return run
  }

  private async waitTurn(): Promise<void> {
    for (;;) {
      const t = this.now()
      if (t < this.pauseUntil) {
        await this.sleep(this.pauseUntil - t)
        continue
      }
      this.starts = this.starts.filter((s) => t - s < this.windowMs)
      if (this.starts.length < this.max) {
        this.starts.push(t)
        return
      }
      await this.sleep(this.starts[0]! + this.windowMs - t)
    }
  }
}

export class AniListError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
    this.name = 'AniListError'
  }
}

export interface ClientOptions {
  fetch?: typeof fetch
  maxPerMinute?: number
  maxRetries?: number
  now?: () => number
  sleep?: Sleep
  endpoint?: string
  timeoutMs?: number
}

/** Réseau coupé ou erreur du serveur : on réessaie de nous-mêmes, sans déranger. */
const RETRY_DELAYS = [1000, 3000]
const REQUEST_TIMEOUT = 15_000
/** En navigateur, Retry-After n'est lisible que si le serveur l'expose (CORS) : sinon, on attend ceci. */
const DEFAULT_RETRY_AFTER = 20
const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false

export class AniListClient {
  private readonly limiter: RateLimiter
  private readonly fetchFn: typeof fetch
  private readonly maxRetries: number
  private readonly endpoint: string
  private readonly sleep: Sleep
  private readonly timeoutMs: number

  constructor(opts: ClientOptions = {}) {
    this.fetchFn = opts.fetch ?? ((...args) => fetch(...args))
    this.limiter = new RateLimiter(opts.maxPerMinute ?? 25, 60_000, opts.now ?? Date.now, opts.sleep ?? realSleep)
    this.maxRetries = opts.maxRetries ?? 3
    this.endpoint = opts.endpoint ?? ANILIST_ENDPOINT
    this.sleep = opts.sleep ?? realSleep
    this.timeoutMs = opts.timeoutMs ?? REQUEST_TIMEOUT
  }

  async request<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    let failures = 0
    const retry = async () => {
      const delay = RETRY_DELAYS[failures++]
      if (delay === undefined || isOffline()) return false
      await this.sleep(delay)
      return true
    }
    for (let attempt = 0; ; attempt++) {
      let res: Response
      try {
        res = await this.limiter.schedule(() =>
          this.fetchFn(this.endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ query, variables }),
            ...(typeof AbortSignal.timeout === 'function' ? { signal: AbortSignal.timeout(this.timeoutMs) } : {}),
          }),
        )
      } catch {
        if (await retry()) continue
        throw new AniListError('Réseau indisponible')
      }
      if (res.status >= 500) {
        if (await retry()) continue
        throw new AniListError(`Erreur AniList (${res.status})`, res.status)
      }
      if (res.status === 429) {
        if (attempt >= this.maxRetries) throw new AniListError('Trop de requêtes, réessaie dans un instant.', 429)
        const retryAfter = Number(res.headers.get('Retry-After'))
        this.limiter.pause((Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : DEFAULT_RETRY_AFTER) * 1000)
        continue
      }
      const body = (await res.json().catch(() => null)) as { data?: T; errors?: { message: string }[] } | null
      if (!res.ok || !body || body.errors?.length || !body.data) {
        throw new AniListError(body?.errors?.[0]?.message ?? `Erreur AniList (${res.status})`, res.status)
      }
      return body.data
    }
  }
}

export const anilist = new AniListClient()
