/**
 * Titres et détails d'épisodes : Jikan (file séparée d'AniList, 3 req/s et 60 req/min), sinon streamingEpisodes
 * d'AniList, sinon « Épisode N » à l'affichage. Jamais bloquant : l'interface s'affiche sans attendre et lit le cache en direct.
 */
import { cacheDb, type CacheDB, type CachedEpisode } from '../db/cacheDb'
import { DAY, HOUR, type Media } from '../domain/types'
import { anilist, RateLimiter, type AniListClient } from './client'
import { fetchMediaByIds } from './media'
import { STREAMING_EPISODES } from './queries'

export const JIKAN_ENDPOINT = 'https://api.jikan.moe/v4'
export const TITLES_TTL = 12 * HOUR
export const EPISODE_TTL = 24 * HOUR
/** Sorti depuis plus longtemps : son résumé ne bougera plus, il est gardé sans expiration. */
export const EPISODE_SETTLED_AFTER = 30 * DAY
const STREAMING_TTL = 24 * HOUR
const JIKAN_TIMEOUT = 8000
/** Après une panne, on ne réessaie pas Jikan tout de suite : on passe directement au repli. */
const JIKAN_DOWN_PAUSE = 10 * 60_000

type Sleep = (ms: number) => Promise<void>

export interface JikanEpisode {
  mal_id: number
  title: string | null
  title_romanji: string | null
  /** Note de la communauté, de 1 à 5 (présente dans la liste, pas toujours dans le détail). */
  score?: number | null
}

export interface JikanEpisodeDetail extends JikanEpisode {
  aired?: string | null
  filler?: boolean | null
  recap?: boolean | null
  synopsis?: string | null
}

interface JikanPage<T> {
  data: T[]
  pagination: { has_next_page: boolean; last_visible_page?: number }
}

export interface JikanVideo {
  mal_id: number
  episode?: string | null
  images?: { jpg?: { image_url?: string | null } | null } | null
}

/** La ressource n'existe pas : ce n'est pas une panne. */
class JikanNotFound extends Error {}

export interface JikanOptions {
  fetch?: typeof fetch
  now?: () => number
  sleep?: Sleep
  maxRetries?: number
  timeoutMs?: number
}

export class JikanClient {
  private readonly perSecond: RateLimiter
  private readonly perMinute: RateLimiter
  private readonly fetchFn: typeof fetch
  private readonly now: () => number
  private readonly maxRetries: number
  private readonly timeoutMs: number
  private downUntil = 0

  constructor(opts: JikanOptions = {}) {
    const now = opts.now ?? Date.now
    const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
    this.perSecond = new RateLimiter(3, 1000, now, sleep)
    this.perMinute = new RateLimiter(60, 60_000, now, sleep)
    this.fetchFn = opts.fetch ?? ((...args) => fetch(...args))
    this.now = now
    this.maxRetries = opts.maxRetries ?? 3
    this.timeoutMs = opts.timeoutMs ?? JIKAN_TIMEOUT
  }

  private call(url: string): Promise<Response> {
    return this.perMinute.schedule(() =>
      this.perSecond.schedule(() =>
        this.fetchFn(url, typeof AbortSignal.timeout === 'function' ? { signal: AbortSignal.timeout(this.timeoutMs) } : {}),
      ),
    )
  }

  private async get<T>(path: string): Promise<T> {
    if (this.now() < this.downUntil) throw new Error('Jikan indisponible')
    const url = `${JIKAN_ENDPOINT}${path}`
    try {
      for (let attempt = 0; ; attempt++) {
        const res = await this.call(url)
        if (res.status === 429 && attempt < this.maxRetries) {
          const retryAfter = Number(res.headers.get('Retry-After'))
          const ms = (Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 2 ** attempt) * 1000
          this.perSecond.pause(ms)
          this.perMinute.pause(ms)
          continue
        }
        if (res.status === 404) throw new JikanNotFound()
        if (!res.ok) throw new Error(`Jikan ${res.status}`)
        return (await res.json()) as T
      }
    } catch (err) {
      if (!(err instanceof JikanNotFound)) this.downUntil = this.now() + JIKAN_DOWN_PAUSE
      throw err
    }
  }

  episodes(idMal: number, page: number): Promise<JikanPage<JikanEpisode>> {
    return this.get(`/anime/${idMal}/episodes?page=${page}`)
  }

  episode(idMal: number, episode: number): Promise<{ data: JikanEpisodeDetail }> {
    return this.get(`/anime/${idMal}/episodes/${episode}`)
  }

  videos(idMal: number, page: number): Promise<JikanPage<JikanVideo>> {
    return this.get(`/anime/${idMal}/videos/episodes?page=${page}`)
  }
}

export const jikan = new JikanClient()

export interface TitlesDeps {
  jikan: JikanClient
  client: AniListClient
  cache: CacheDB
  now: () => number
}

const defaults = (): TitlesDeps => ({ jikan, client: anilist, cache: cacheDb, now: Date.now })

/** title, sinon title_romanji. */
export const jikanTitle = (ep: JikanEpisode): string | null => ep.title?.trim() || ep.title_romanji?.trim() || null

/** « Episode 12 - Le départ » → épisode 12, « Le départ ». */
export function parseStreamingTitle(raw: string): { episode: number; title: string } | null {
  const match = /^Episode\s+(\d+)\s*[-–:]\s*(.+)$/i.exec(raw.trim())
  return match ? { episode: Number(match[1]), title: match[2]!.trim() } : null
}

type StreamingEpisodes = Record<number, { title: string; thumbnail: string | null }>

/** streamingEpisodes d'AniList, gardé 24 h : sert de repli aux titres comme aux vignettes. */
async function streamingEpisodes(id: number, deps: TitlesDeps): Promise<StreamingEpisodes> {
  const key = `streaming:${id}`
  const hit = await deps.cache.kv.get(key)
  if (hit && deps.now() - hit.fetchedAt <= STREAMING_TTL) return hit.value as StreamingEpisodes
  const data = await deps.client.request<{ Media: { streamingEpisodes: { title: string | null; thumbnail: string | null }[] | null } }>(STREAMING_EPISODES, { id })
  const out: StreamingEpisodes = {}
  for (const s of data.Media.streamingEpisodes ?? []) {
    const parsed = s.title ? parseStreamingTitle(s.title) : null
    if (parsed && parsed.episode >= 1) out[parsed.episode] = { title: parsed.title, thumbnail: s.thumbnail ?? null }
  }
  await deps.cache.kv.put({ key, value: out, fetchedAt: deps.now() })
  return out
}

const inFlight = new Map<number, Promise<void>>()

/** À l'ouverture d'une saison : charge ses titres si le cache ne suffit pas. Ne lève jamais. */
export function loadEpisodeTitles(media: Media, deps: TitlesDeps = defaults()): Promise<void> {
  let running = inFlight.get(media.id)
  if (!running) {
    running = run(media, deps).catch(() => undefined).finally(() => inFlight.delete(media.id))
    inFlight.set(media.id, running)
  }
  return running
}

async function run(media: Media, deps: TitlesDeps): Promise<void> {
  const hit = await deps.cache.titles.get(media.id)
  if (hit && (hit.permanent || deps.now() - hit.fetchedAt <= TITLES_TTL)) return

  // Fiche mise en cache avant l'ajout d'idMal.
  const m = media.idMal === undefined ? (await fetchMediaByIds([media.id], { force: true }).catch(() => null))?.get(media.id) ?? media : media
  const put = (titles: (string | null)[], scores: (number | null)[] | undefined, permanent: boolean) =>
    deps.cache.titles.put({ mediaId: media.id, titles, scores, fetchedAt: deps.now(), permanent })

  let titles: (string | null)[] = []
  let scores: (number | null)[] = []
  let complete = false
  if (m.idMal) {
    try {
      for (let page = 1; ; page++) {
        const res = await deps.jikan.episodes(m.idMal, page)
        for (const ep of res.data) {
          titles[ep.mal_id - 1] = jikanTitle(ep)
          scores[ep.mal_id - 1] = ep.score ?? null
        }
        titles = Array.from(titles, (t) => t ?? null)
        scores = Array.from(scores, (s) => s ?? null)
        // Écrit page après page : les titres apparaissent au fur et à mesure.
        if (res.pagination.has_next_page) await put(titles, scores, false)
        else {
          complete = true
          break
        }
      }
    } catch {
      // On garde les pages déjà reçues ; le repli ne sert que si rien n'est arrivé.
    }
  }
  const useful = titles.some(Boolean)
  if (complete && useful) {
    await put(titles, scores, m.status === 'FINISHED')
    return
  }
  if (useful) {
    await put(titles, scores, false)
    return
  }
  const fallback = await streamingEpisodes(media.id, deps).catch(() => null)
  if (!fallback) return
  const numbers = Object.keys(fallback).map(Number)
  const fromStreaming = Array.from({ length: Math.max(0, ...numbers) }, (_, i) => fallback[i + 1]?.title ?? null)
  if (fromStreaming.some(Boolean)) await put(fromStreaming, undefined, false)
  // Aucune source : on ne remplace pas d'anciens titres par du vide. Le vide est gardé 12 h pour ne pas redemander.
  else if (!hit) await put([], undefined, false)
}

export const episodeKey = (mediaId: number, episode: number): string => `${mediaId}:${episode}`

const videoNumber = (v: JikanVideo): number | null => {
  const parsed = /(\d+)/.exec(v.episode ?? '')
  return parsed ? Number(parsed[1]) : Number.isInteger(v.mal_id) ? v.mal_id : null
}

/**
 * Vignette d'un épisode : Jikan les liste du plus récent au plus ancien. La première page donne le numéro le plus haut
 * et la taille des pages : on en déduit où chercher, deux requêtes au plus.
 */
async function jikanThumbnail(idMal: number, episode: number, deps: TitlesDeps): Promise<string | null> {
  const find = (list: JikanVideo[]) => list.find((v) => videoNumber(v) === episode)?.images?.jpg?.image_url ?? null
  const first = await deps.jikan.videos(idMal, 1)
  const direct = find(first.data)
  if (direct || first.data.length === 0 || !first.pagination.has_next_page) return direct
  const newest = videoNumber(first.data[0]!)
  if (newest === null) return null
  const page = 1 + Math.floor((newest - episode) / first.data.length)
  if (page <= 1) return null
  return find((await deps.jikan.videos(idMal, page)).data)
}

/** Faut-il (re)demander cet épisode ? Une panne n'est jamais figée : seul un chargement complet compte. */
export function isEpisodeFresh(row: CachedEpisode | undefined, now: number): boolean {
  return !!row && (row.permanent || (row.complete && now - row.fetchedAt <= EPISODE_TTL))
}

const loadingEpisodes = new Map<string, Promise<void>>()

/** À l'ouverture d'un épisode : résumé, note, badges et vignette, écrits au fur et à mesure. Ne lève jamais. */
export function loadEpisodeDetails(media: Media, episode: number, deps: TitlesDeps = defaults()): Promise<void> {
  const key = episodeKey(media.id, episode)
  let running = loadingEpisodes.get(key)
  if (!running) {
    running = runDetails(media, episode, deps).catch(() => undefined).finally(() => loadingEpisodes.delete(key))
    loadingEpisodes.set(key, running)
  }
  return running
}

async function runDetails(media: Media, episode: number, deps: TitlesDeps): Promise<void> {
  const key = episodeKey(media.id, episode)
  const hit = await deps.cache.episodes.get(key)
  if (isEpisodeFresh(hit, deps.now())) return

  const m = media.idMal === undefined ? (await fetchMediaByIds([media.id], { force: true }).catch(() => null))?.get(media.id) ?? media : media
  let row: CachedEpisode = hit ?? {
    key, title: null, synopsis: null, score: null, aired: null, filler: false, recap: false, thumbnail: null,
    fetchedAt: deps.now(), permanent: false, complete: false,
  }
  const save = async (change: Partial<CachedEpisode>) => {
    row = { ...row, ...change, fetchedAt: deps.now() }
    await deps.cache.episodes.put(row)
  }

  let reached = false
  if (m.idMal) {
    try {
      const { data } = await deps.jikan.episode(m.idMal, episode)
      reached = true
      await save({
        title: jikanTitle(data) ?? row.title,
        synopsis: data.synopsis?.trim() || null,
        score: data.score ?? row.score,
        aired: data.aired ?? null,
        filler: !!data.filler,
        recap: !!data.recap,
      })
    } catch (err) {
      reached = err instanceof JikanNotFound
    }
    // La note vient de la liste : déjà reçue avec les titres, sinon on demande la page de cet épisode.
    if (reached && row.score === null) {
      const known = await deps.cache.titles.get(media.id)
      const score = known?.scores
        ? known.scores[episode - 1] ?? null
        : await deps.jikan.episodes(m.idMal, Math.ceil(episode / 100))
            .then((p) => p.data.find((e) => e.mal_id === episode)?.score ?? null)
            .catch(() => null)
      if (score !== null) await save({ score })
    }
    if (reached) {
      const thumbnail = await jikanThumbnail(m.idMal, episode, deps).catch(() => null)
      if (thumbnail) await save({ thumbnail })
    }
  }
  if (!row.thumbnail) {
    const streaming = await streamingEpisodes(media.id, deps).catch(() => null)
    const found = streaming?.[episode]
    if (found) await save({ thumbnail: found.thumbnail, title: row.title ?? found.title })
  }

  const settled = !!row.aired && deps.now() - new Date(row.aired).getTime() > EPISODE_SETTLED_AFTER
  await save({ complete: reached, permanent: reached && settled })
}
