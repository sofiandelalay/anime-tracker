import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { AniListClient, RateLimiter } from '../api/client'
import { fetchMediaByIds, MEDIA_TTL, searchAnime, SEARCH_TTL, type ApiDeps } from '../api/media'
import { CacheDB } from '../db/cacheDb'
import { HOUR } from '../domain/types'
import { raw } from './fixtures'

/** Horloge simulée : sleep avance le temps instantanément. */
function fakeClock() {
  const c = { t: 0, now: () => c.t, sleep: async (ms: number) => void (c.t += ms) }
  return c
}

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } })

describe('file d’attente AniList', () => {
  it('ne dépasse jamais 25 requêtes par minute', async () => {
    const clock = fakeClock()
    const limiter = new RateLimiter(25, 60_000, clock.now, clock.sleep)
    const starts: number[] = []
    await Promise.all(Array.from({ length: 60 }, () => limiter.schedule(async () => void starts.push(clock.now()))))
    expect(starts).toHaveLength(60)
    for (let i = 25; i < starts.length; i++) expect(starts[i]! - starts[i - 25]!).toBeGreaterThanOrEqual(60_000)
  })

  it('respecte Retry-After sur un 429 puis réessaie', async () => {
    const clock = fakeClock()
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({}, 429, { 'Retry-After': '7' }))
      .mockImplementation(async () => json({ data: { ok: clock.now() } }))
    const client = new AniListClient({ fetch: fetchMock, now: clock.now, sleep: clock.sleep })
    const data = await client.request<{ ok: number }>('query { ok }')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(data.ok).toBeGreaterThanOrEqual(7000)
  })

  it('remonte les erreurs GraphQL', async () => {
    const client = new AniListClient({ fetch: async () => json({ errors: [{ message: 'Boom' }] }, 400) })
    await expect(client.request('query { x }')).rejects.toThrow('Boom')
  })

  it('abandonne après plusieurs 429', async () => {
    const clock = fakeClock()
    const client = new AniListClient({
      fetch: async () => json({}, 429, { 'Retry-After': '1' }), now: clock.now, sleep: clock.sleep, maxRetries: 2,
    })
    await expect(client.request('query { x }')).rejects.toMatchObject({ status: 429 })
  })
})

describe('cache AniList', () => {
  const cache = new CacheDB('test-cache')
  let clock: ReturnType<typeof fakeClock>
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>
  let deps: ApiDeps

  beforeEach(async () => {
    await Promise.all([cache.media.clear(), cache.queries.clear(), cache.franchises.clear()])
    clock = fakeClock()
    clock.t = 1_000_000
    fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
      const body = JSON.parse(String(init!.body)) as { variables: { ids?: number[]; search?: string } }
      const ids = body.variables.ids ?? [1, 2]
      return json({ data: { Page: { media: ids.map((id) => raw(id, id === 666 ? { isAdult: true } : {})) } } })
    })
    deps = { client: new AniListClient({ fetch: fetchMock, now: clock.now, sleep: clock.sleep }), cache, now: clock.now }
  })
  afterAll(() => cache.delete())

  it('regroupe les fiches par pages de 50', async () => {
    const ids = Array.from({ length: 120 }, (_, i) => i + 1)
    const result = await fetchMediaByIds(ids, {}, deps)
    expect(result.size).toBe(120)
    const sizes = fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init!.body)).variables.ids.length)
    expect(sizes).toEqual([50, 50, 20])
  })

  it('sert le cache pendant 12 h puis rafraîchit', async () => {
    await fetchMediaByIds([1, 2], {}, deps)
    await fetchMediaByIds([1, 2], {}, deps)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    clock.t += MEDIA_TTL + 1
    await fetchMediaByIds([1, 2], {}, deps)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('ne redemande que les fiches manquantes', async () => {
    await fetchMediaByIds([1, 2], {}, deps)
    await fetchMediaByIds([1, 2, 3], {}, deps)
    expect(JSON.parse(String(fetchMock.mock.calls[1]![1]!.body)).variables.ids).toEqual([3])
  })

  it('ne garde que les champs utiles et exclut le contenu adulte', async () => {
    const result = await fetchMediaByIds([5, 666], {}, deps)
    expect(result.has(666)).toBe(false)
    const m = await cache.media.get(5)
    expect(Object.keys(m!).sort()).toEqual([
      'averageScore', 'color', 'cover', 'duration', 'episodes', 'fetchedAt', 'format', 'genres', 'id', 'nextAiring',
      'popularity', 'relations', 'season', 'seasonYear', 'startDate', 'status', 'studios', 'tags', 'title',
    ])
    expect(m!.cover).toContain('/large/')
  })

  it('hors ligne : renvoie les fiches en cache même périmées', async () => {
    await fetchMediaByIds([1], {}, deps)
    clock.t += 2 * MEDIA_TTL
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    const result = await fetchMediaByIds([1], {}, deps)
    expect(result.get(1)?.id).toBe(1)
  })

  it('met en cache les recherches pendant 1 h', async () => {
    await searchAnime('Frieren', deps)
    await searchAnime('  frieren ', deps)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    clock.t += SEARCH_TTL + HOUR
    await searchAnime('frieren', deps)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
