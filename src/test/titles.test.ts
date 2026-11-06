import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { AniListClient } from '../api/client'
import { JikanClient, jikanTitle, loadEpisodeTitles, parseStreamingTitle, TITLES_TTL, type TitlesDeps } from '../api/episodes'
import { CacheDB } from '../db/cacheDb'
import { CACHE_MAX_AGE, purgeCache } from '../db/maintenance'
import { TrackerDB } from '../db/trackerDb'
import { media } from './fixtures'

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers })

function clock() {
  const c = { t: 1_000_000, now: () => c.t, sleep: async (ms: number) => void (c.t += ms) }
  return c
}

const page = (from: number, to: number, hasNext: boolean) => ({
  data: Array.from({ length: to - from + 1 }, (_, i) => ({ mal_id: from + i, title: `Titre ${from + i}`, title_romanji: null })),
  pagination: { has_next_page: hasNext },
})

describe('file Jikan', () => {
  it('jamais plus de 3 requêtes par seconde ni 60 par minute', async () => {
    const c = clock()
    const starts: number[] = []
    const client = new JikanClient({
      now: c.now,
      sleep: c.sleep,
      fetch: async () => {
        starts.push(c.t)
        return json(page(1, 1, false))
      },
    })
    await Promise.all(Array.from({ length: 130 }, () => client.episodes(1, 1)))
    expect(starts).toHaveLength(130)
    for (let i = 3; i < starts.length; i++) expect(starts[i]! - starts[i - 3]!).toBeGreaterThanOrEqual(1000)
    for (let i = 60; i < starts.length; i++) expect(starts[i]! - starts[i - 60]!).toBeGreaterThanOrEqual(60_000)
  })

  it('respecte Retry-After sur un 429 puis réessaie', async () => {
    const c = clock()
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({}, 429, { 'Retry-After': '4' }))
      .mockImplementation(async () => json(page(1, 1, false)))
    const client = new JikanClient({ fetch: fetchMock, now: c.now, sleep: c.sleep })
    const start = c.t
    await client.episodes(1, 1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(c.t - start).toBeGreaterThanOrEqual(4000)
  })

  it('après une panne, n’insiste pas pendant quelques minutes', async () => {
    const c = clock()
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch'))
    const client = new JikanClient({ fetch: fetchMock, now: c.now, sleep: c.sleep })
    await expect(client.episodes(1, 1)).rejects.toThrow()
    await expect(client.episodes(1, 2)).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('titres d’épisodes', () => {
  const cache = new CacheDB('test-titles')
  let c: ReturnType<typeof clock>
  let jikanFetch: ReturnType<typeof vi.fn<typeof fetch>>
  let anilistFetch: ReturnType<typeof vi.fn<typeof fetch>>
  let deps: TitlesDeps

  const streaming = (titles: string[]) => json({ data: { Media: { streamingEpisodes: titles.map((title) => ({ title })) } } })
  const titles = async (id = 1) => (await cache.titles.get(id))?.titles

  beforeEach(async () => {
    await Promise.all([cache.titles.clear(), cache.kv.clear()])
    c = clock()
    jikanFetch = vi.fn<typeof fetch>()
    anilistFetch = vi.fn<typeof fetch>(async () => streaming([]))
    deps = {
      jikan: new JikanClient({ fetch: jikanFetch, now: c.now, sleep: c.sleep }),
      client: new AniListClient({ fetch: anilistFetch, now: c.now, sleep: c.sleep }),
      cache,
      now: c.now,
    }
  })
  afterAll(() => cache.delete())

  it('title, sinon title_romanji', () => {
    expect(jikanTitle({ mal_id: 1, title: 'A', title_romanji: 'B' })).toBe('A')
    expect(jikanTitle({ mal_id: 1, title: ' ', title_romanji: 'B' })).toBe('B')
    expect(jikanTitle({ mal_id: 1, title: null, title_romanji: null })).toBeNull()
  })

  it('charge toutes les pages, en ordre, par 100', async () => {
    jikanFetch.mockImplementation(async (url) => (String(url).endsWith('page=1') ? json(page(1, 100, true)) : json(page(101, 120, false))))
    await loadEpisodeTitles(media(1, { idMal: 5, episodes: 120 }), deps)
    expect(jikanFetch).toHaveBeenCalledTimes(2)
    expect(String(jikanFetch.mock.calls[0]![0])).toBe('https://api.jikan.moe/v4/anime/5/episodes?page=1')
    const t = await titles()
    expect(t).toHaveLength(120)
    expect(t![119]).toBe('Titre 120')
  })

  it('saison finie de diffusion : sans expiration', async () => {
    jikanFetch.mockImplementation(async () => json(page(1, 12, false)))
    const m = media(1, { idMal: 5 })
    await loadEpisodeTitles(m, deps)
    c.t += 365 * 24 * 3600_000
    await loadEpisodeTitles(m, deps)
    expect(jikanFetch).toHaveBeenCalledTimes(1)
  })

  it('saison en cours : 12 h', async () => {
    jikanFetch.mockImplementation(async () => json(page(1, 3, false)))
    const m = media(1, { idMal: 5, status: 'RELEASING' })
    await loadEpisodeTitles(m, deps)
    await loadEpisodeTitles(m, deps)
    expect(jikanFetch).toHaveBeenCalledTimes(1)
    c.t += TITLES_TTL + 1
    await loadEpisodeTitles(m, deps)
    expect(jikanFetch).toHaveBeenCalledTimes(2)
  })

  it('Jikan en panne : streamingEpisodes d’AniList, non définitif', async () => {
    jikanFetch.mockRejectedValue(new TypeError('Failed to fetch'))
    anilistFetch.mockImplementation(async () => streaming(['Episode 2 - Deux', 'Episode 1 - Un', 'Bonus']))
    await loadEpisodeTitles(media(1, { idMal: 5 }), deps)
    expect(await titles()).toEqual(['Un', 'Deux'])
    expect((await cache.titles.get(1))!.permanent).toBe(false)
  })

  it('idMal manquant : passe directement au repli', async () => {
    anilistFetch.mockImplementation(async () => streaming(['Episode 1 - Un']))
    await loadEpisodeTitles(media(1, { idMal: null }), deps)
    expect(jikanFetch).not.toHaveBeenCalled()
    expect(await titles()).toEqual(['Un'])
  })

  it('aucune source : ne lève pas (l’écran affichera « Épisode N »)', async () => {
    jikanFetch.mockRejectedValue(new TypeError('Failed to fetch'))
    anilistFetch.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(loadEpisodeTitles(media(1, { idMal: 5 }), deps)).resolves.toBeUndefined()
    expect(await titles()).toBeUndefined()
  })

  it('une panne ne remplace pas des titres déjà connus par du vide', async () => {
    await cache.titles.put({ mediaId: 1, titles: ['Ancien'], fetchedAt: 0, permanent: false })
    await loadEpisodeTitles(media(1, { idMal: null }), deps)
    expect(await titles()).toEqual(['Ancien'])
  })

  it('analyse les titres de streaming', () => {
    expect(parseStreamingTitle('Episode 130 - Scent of Danger!')).toEqual({ episode: 130, title: 'Scent of Danger!' })
    expect(parseStreamingTitle('Special')).toBeNull()
  })

  it('la purge garde les titres sans expiration', async () => {
    const tracker = new TrackerDB('test-titles-tracker')
    await cache.titles.bulkPut([
      { mediaId: 1, titles: ['a'], fetchedAt: 0, permanent: true },
      { mediaId: 2, titles: ['b'], fetchedAt: 0, permanent: false },
    ])
    await purgeCache(CACHE_MAX_AGE * 2, { tracker, cache })
    expect((await cache.titles.toArray()).map((t) => t.mediaId)).toEqual([1])
    await tracker.delete()
  })
})
