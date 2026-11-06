import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { AniListClient, RateLimiter } from '../api/client'
import {
  fetchDiscovery, fetchMediaByIds, fetchRecommendations, fetchSeasonPage, fetchSynopsis, MEDIA_TTL, searchAnime, SEARCH_TTL,
  SEASON_TTL, SUGGESTION_SOURCE_TTL, type ApiDeps,
} from '../api/media'
import { toMedia } from '../api/queries'
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

  it('réseau coupé : réessaie seul, puis réussit', async () => {
    const clock = fakeClock()
    const fetchMock = vi.fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockImplementation(async () => json({ data: { ok: true } }))
    const client = new AniListClient({ fetch: fetchMock, now: clock.now, sleep: clock.sleep })
    await expect(client.request('query { ok }')).resolves.toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(clock.t).toBeGreaterThanOrEqual(1000)
  })

  it('erreur 500 : réessaie seul, puis réussit', async () => {
    const clock = fakeClock()
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('oups', { status: 500 }))
      .mockResolvedValueOnce(new Response('oups', { status: 503 }))
      .mockImplementation(async () => json({ data: { ok: true } }))
    const client = new AniListClient({ fetch: fetchMock, now: clock.now, sleep: clock.sleep })
    await expect(client.request('query { ok }')).resolves.toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('panne qui dure : abandonne après deux nouveaux essais', async () => {
    const clock = fakeClock()
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('oups', { status: 500 }))
    const client = new AniListClient({ fetch: fetchMock, now: clock.now, sleep: clock.sleep })
    await expect(client.request('query { x }')).rejects.toMatchObject({ status: 500 })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('une erreur de requête (400) ne se réessaie pas', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => json({ errors: [{ message: 'Boom' }] }, 400))
    const client = new AniListClient({ fetch: fetchMock })
    await expect(client.request('query { x }')).rejects.toThrow('Boom')
    expect(fetchMock).toHaveBeenCalledTimes(1)
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
    await Promise.all([cache.media.clear(), cache.queries.clear(), cache.franchises.clear(), cache.kv.clear()])
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
      'averageScore', 'banner', 'color', 'cover', 'duration', 'episodes', 'fetchedAt', 'format', 'genres', 'id', 'idMal', 'nextAiring',
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

  it('ne garde ni tags spoilers, ni tags de rang < 60', () => {
    const m = toMedia(raw(1, {
      tags: [
        { name: 'Bon', rank: 80, isAdult: false, isGeneralSpoiler: false, isMediaSpoiler: false },
        { name: 'Faible', rank: 59, isAdult: false },
        { name: 'Spoiler', rank: 90, isAdult: false, isMediaSpoiler: true },
        { name: 'Spoiler général', rank: 90, isAdult: false, isGeneralSpoiler: true },
        { name: 'Adulte', rank: 90, isAdult: true },
      ],
    }), 0)!
    expect(m.tags).toEqual([{ name: 'Bon', rank: 80 }])
  })

  it('page de saison : cache 6 h, puis rafraîchit ; hors ligne, sert le périmé', async () => {
    const page = () => json({ data: { Page: { pageInfo: { hasNextPage: true }, media: [raw(1)] } } })
    fetchMock.mockImplementation(async () => page())
    expect((await fetchSeasonPage('FALL', 2026, 1, deps)).hasNext).toBe(true)
    await fetchSeasonPage('FALL', 2026, 1, deps)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await fetchSeasonPage('FALL', 2026, 2, deps)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    clock.t += SEASON_TTL + 1
    await fetchSeasonPage('FALL', 2026, 1, deps)
    expect(fetchMock).toHaveBeenCalledTimes(3)

    clock.t += SEASON_TTL + 1
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    expect((await fetchSeasonPage('FALL', 2026, 1, deps)).media).toHaveLength(1)
  })

  describe('recommandations groupées', () => {
    const reply = (query: string) => {
      const data = Object.fromEntries([...query.matchAll(/(m\d+): Media\(id: (\d+)/g)].map(([, alias, id]) => [alias, {
        id: Number(id),
        recommendations: { nodes: [{ rating: 3, mediaRecommendation: raw(1000 + Number(id)) }] },
      }]))
      return json({ data })
    }
    const queryOf = (init?: RequestInit) => (JSON.parse(String(init!.body)) as { query: string }).query

    it('regroupe par lots de 8 alias et met en cache par anime', async () => {
      fetchMock.mockImplementation(async (_u, init) => reply(queryOf(init)))
      const ids = Array.from({ length: 20 }, (_, i) => i + 1)
      const out = await fetchRecommendations(ids, {}, deps)
      expect(out.size).toBe(20)
      expect(fetchMock).toHaveBeenCalledTimes(3)
      await fetchRecommendations([...ids, 21], {}, deps)
      expect(fetchMock).toHaveBeenCalledTimes(4)
      expect(queryOf(fetchMock.mock.calls[3]![1])).toContain('Media(id: 21,')
      expect(queryOf(fetchMock.mock.calls[3]![1])).not.toContain('Media(id: 1,')
    })

    it('une fiche disparue (404) ne prive pas les autres', async () => {
      fetchMock.mockImplementation(async (_u, init) => {
        const q = queryOf(init)
        return q.includes('Media(id: 3,') ? json({ errors: [{ message: 'Not Found.' }] }, 404) : reply(q)
      })
      const out = await fetchRecommendations([1, 2, 3, 4], {}, deps)
      expect(out.get(1)).toHaveLength(1)
      expect(out.get(4)).toHaveLength(1)
      expect(out.get(3)).toEqual([])
    })

    it('réseau coupé : lève une erreur s’il manque un anime, sinon sert le périmé', async () => {
      fetchMock.mockImplementation(async (_u, init) => reply(queryOf(init)))
      await fetchRecommendations([1], {}, deps)
      clock.t += SUGGESTION_SOURCE_TTL + 1
      fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
      expect((await fetchRecommendations([1], {}, deps)).get(1)).toHaveLength(1)
      await expect(fetchRecommendations([1, 2], {}, deps)).rejects.toThrow()
    })
  })

  it('découverte : une seule requête pour 3 genres, sans doublons', async () => {
    fetchMock.mockImplementation(async () => json({ data: { g0: { media: [raw(1), raw(2)] }, g1: { media: [raw(2)] }, g2: { media: [raw(3)] } } }))
    const out = await fetchDiscovery(['Drama', 'Action', 'Fantasy'], {}, deps)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(out.map((m) => m.id).sort()).toEqual([1, 2, 3])
    await fetchDiscovery(['Action', 'Drama', 'Fantasy'], {}, deps)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('synopsis : nettoyé, mis en cache', async () => {
    fetchMock.mockImplementation(async () => json({ data: { Media: { description: 'Un <b>récit</b><br>(Source: X)' } } }))
    expect(await fetchSynopsis(1, deps)).toBe('Un récit')
    expect(await fetchSynopsis(1, deps)).toBe('Un récit')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  describe('recherche par anime', () => {
    const edge = (id: number, relationType: string) => ({
      relationType, node: { id, type: 'ANIME', format: 'TV' as const, status: 'FINISHED' as const, isAdult: false },
    })
    const s1 = raw(1, { startDate: { year: 2010, month: 1, day: 1 }, relations: { edges: [edge(2, 'SEQUEL')] } })
    const s2 = raw(2, { startDate: { year: 2011, month: 1, day: 1 }, relations: { edges: [edge(1, 'PREQUEL'), edge(3, 'SEQUEL')] } })
    const s3 = raw(3, { startDate: { year: 2012, month: 1, day: 1 }, relations: { edges: [edge(2, 'PREQUEL')] } })
    const film = raw(4, { format: 'MOVIE', startDate: { year: 2013, month: 1, day: 1 }, relations: { edges: [edge(3, 'PREQUEL')] } })
    const world = new Map([s1, s2, s3, film].map((m) => [m.id, m]))

    const api = (found: ReturnType<typeof raw>[]) =>
      fetchMock.mockImplementation(async (_u, init) => {
        const { variables } = JSON.parse(String(init!.body)) as { variables: { ids?: number[] } }
        const media = variables.ids ? variables.ids.flatMap((id) => (world.has(id) ? [world.get(id)!] : [])) : found
        return json({ data: { Page: { media } } })
      })

    it('toutes les saisons trouvées : une seule ligne, sans requête en plus', async () => {
      api([s3, s2, s1])
      expect((await searchAnime('titans', deps)).map((m) => m.id)).toEqual([1])
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('seule une suite trouvée : remonte à la première saison, puis tout vient du cache', async () => {
      api([s3])
      expect((await searchAnime('saison 3', deps)).map((m) => m.id)).toEqual([1])
      expect(fetchMock).toHaveBeenCalledTimes(3) // recherche + 2 niveaux
      fetchMock.mockClear()
      clock.t += MEDIA_TTL + 1 // fiches de plus de 12 h : les liens restent valables
      await searchAnime('autre recherche', deps)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('un film garde sa propre ligne, à côté de l’anime', async () => {
      api([s1, film])
      expect((await searchAnime('titans', deps)).map((m) => m.id)).toEqual([1, 4])
    })

    it('réseau coupé pendant la remontée : montre ce qui a été trouvé, sans le mettre en cache', async () => {
      fetchMock.mockImplementationOnce(async () => json({ data: { Page: { media: [s3] } } }))
      fetchMock.mockImplementation(async () => {
        throw new TypeError('Failed to fetch')
      })
      expect((await searchAnime('coupure', deps)).map((m) => m.id)).toEqual([3])
      expect(await cache.queries.get('search:coupure')).toBeUndefined()
    })
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
