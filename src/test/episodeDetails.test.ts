import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { AniListClient } from '../api/client'
import { EPISODE_TTL, JikanClient, loadEpisodeDetails, type TitlesDeps } from '../api/episodes'
import { CacheDB } from '../db/cacheDb'
import { CACHE_MAX_AGE, purgeCache } from '../db/maintenance'
import { TrackerDB } from '../db/trackerDb'
import { animeAiringLabel, communityScore, episodeScore, seasonEpisodeLabel } from '../domain/format'
import { episodeDateLine } from '../domain/progress'
import { DAY } from '../domain/types'
import { media } from './fixtures'

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status })

describe('détail d’un épisode', () => {
  const cache = new CacheDB('test-episode-details')
  const NOW = Date.UTC(2026, 10, 6)
  let t: number
  let calls: string[]
  let routes: (url: string) => Response | Promise<Response>
  let anilistFetch: ReturnType<typeof vi.fn<typeof fetch>>
  let deps: TitlesDeps
  const m = media(1, { idMal: 5 })
  const row = (n = 7) => cache.episodes.get(`1:${n}`)

  const detail = (over = {}) => ({
    data: { mal_id: 7, title: 'Le départ', title_romanji: null, aired: new Date(NOW - 60 * DAY).toISOString(), filler: true, recap: false, synopsis: 'Il part.', ...over },
  })
  const list = { data: [{ mal_id: 7, title: 'Le départ', title_romanji: null, score: 4.6 }], pagination: { has_next_page: false } }
  const videos = { data: [{ mal_id: 7, episode: 'Episode 7', images: { jpg: { image_url: 'https://img/7.jpg' } } }], pagination: { has_next_page: false } }

  const standard = (url: string) => {
    if (url.includes('/videos/episodes')) return json(videos)
    if (/\/episodes\/\d+$/.test(url)) return json(detail())
    return json(list)
  }

  beforeEach(async () => {
    await Promise.all([cache.episodes.clear(), cache.titles.clear(), cache.kv.clear()])
    t = NOW
    calls = []
    routes = standard
    anilistFetch = vi.fn<typeof fetch>(async () => json({ data: { Media: { streamingEpisodes: [] } } }))
    const sleep = async (ms: number) => void (t += ms)
    deps = {
      jikan: new JikanClient({ now: () => t, sleep, fetch: async (url) => {
        calls.push(String(url))
        return routes(String(url))
      } }),
      client: new AniListClient({ fetch: anilistFetch, now: () => t, sleep }),
      cache,
      now: () => t,
    }
  })
  afterAll(() => cache.delete())

  it('réunit résumé, note, badges et vignette', async () => {
    await loadEpisodeDetails(m, 7, deps)
    expect(await row()).toMatchObject({ title: 'Le départ', synopsis: 'Il part.', score: 4.6, filler: true, recap: false, thumbnail: 'https://img/7.jpg', complete: true })
  })

  it('sorti depuis plus de 30 jours : sans expiration', async () => {
    await loadEpisodeDetails(m, 7, deps)
    expect((await row())!.permanent).toBe(true)
    const before = calls.length
    t += 400 * DAY
    await loadEpisodeDetails(m, 7, deps)
    expect(calls.length).toBe(before)
  })

  it('sorti récemment : 24 h', async () => {
    routes = (url) => (/\/episodes\/\d+$/.test(url) ? json(detail({ aired: new Date(NOW - 2 * DAY).toISOString() })) : standard(url))
    await loadEpisodeDetails(m, 7, deps)
    expect((await row())!.permanent).toBe(false)
    const before = calls.length
    await loadEpisodeDetails(m, 7, deps)
    expect(calls.length).toBe(before)
    t += EPISODE_TTL + 1
    await loadEpisodeDetails(m, 7, deps)
    expect(calls.length).toBeGreaterThan(before)
  })

  it('note déjà reçue avec les titres : pas de requête de liste en plus', async () => {
    const scores = Array.from({ length: 7 }, () => null as number | null)
    scores[6] = 3.9
    await cache.titles.put({ mediaId: 1, titles: [], scores, fetchedAt: t, permanent: true })
    await loadEpisodeDetails(m, 7, deps)
    expect((await row())!.score).toBe(3.9)
    expect(calls.some((u) => u.includes('/anime/5/episodes?page='))).toBe(false)
  })

  it('une panne de Jikan n’est pas figée, et ne bloque pas la vignette de repli', async () => {
    routes = () => {
      throw new TypeError('Failed to fetch')
    }
    anilistFetch.mockImplementation(async () => json({ data: { Media: { streamingEpisodes: [{ title: 'Episode 7 - Repli', thumbnail: 'https://cr/7.jpg' }] } } }))
    await loadEpisodeDetails(m, 7, deps)
    expect(await row()).toMatchObject({ thumbnail: 'https://cr/7.jpg', title: 'Repli', complete: false, permanent: false, synopsis: null })

    // Jikan revient (après la pause de 10 min) : l'épisode est redemandé.
    routes = standard
    t += 11 * 60_000
    await loadEpisodeDetails(m, 7, deps)
    expect(await row()).toMatchObject({ synopsis: 'Il part.', complete: true })
  })

  it('un 404 n’est pas une panne : pas de résumé, mais Jikan reste utilisable', async () => {
    routes = (url) => (/\/episodes\/\d+$/.test(url) ? json({}, 404) : standard(url))
    await loadEpisodeDetails(m, 7, deps)
    expect(await row()).toMatchObject({ synopsis: null, complete: true })
    routes = standard
    await loadEpisodeDetails(m, 8, deps)
    expect(calls.some((u) => u.endsWith('/episodes/8'))).toBe(true)
  })

  it('vignette : déduit la bonne page, deux requêtes au plus', async () => {
    routes = (url) => {
      if (!url.includes('/videos/episodes')) return standard(url)
      const page = Number(/page=(\d+)/.exec(url)![1])
      const top = 500 - (page - 1) * 100
      return json({
        data: Array.from({ length: 100 }, (_, i) => ({ mal_id: top - i, episode: `Episode ${top - i}`, images: { jpg: { image_url: `https://img/${top - i}.jpg` } } })),
        pagination: { has_next_page: page < 5 },
      })
    }
    await loadEpisodeDetails(m, 150, deps)
    expect((await row(150))!.thumbnail).toBe('https://img/150.jpg')
    expect(calls.filter((u) => u.includes('/videos/episodes'))).toHaveLength(2)
  })

  it('sans idMal : ne demande rien à Jikan', async () => {
    await loadEpisodeDetails(media(2, { idMal: null }), 1, deps)
    expect(calls).toHaveLength(0)
  })

  it('la purge garde les épisodes sans expiration', async () => {
    const tracker = new TrackerDB('test-episodes-tracker')
    const base = { title: null, synopsis: null, score: null, aired: null, filler: false, recap: false, thumbnail: null, fetchedAt: 0, complete: true }
    await cache.episodes.bulkPut([{ ...base, key: '1:1', permanent: true }, { ...base, key: '1:2', permanent: false }])
    await purgeCache(CACHE_MAX_AGE * 2, { tracker, cache })
    expect((await cache.episodes.toArray()).map((e) => e.key)).toEqual(['1:1'])
    await tracker.delete()
  })
})

describe('libellés d’un épisode', () => {
  const NOW = Date.UTC(2026, 10, 6, 12)
  const HOUR = 3600_000

  it('sorti : date de sortie', () => {
    expect(episodeDateLine(media(1), 7, '2026-09-13T00:00:00+00:00', NOW)).toBe('Sorti le 13 sept. 2026')
  })

  it('prochain épisode : date et compte à rebours', () => {
    const m = media(1, { status: 'RELEASING', nextAiring: { episode: 8, airingAt: (NOW + 52 * HOUR) / 1000 } })
    expect(episodeDateLine(m, 8, null, NOW)).toBe('Sort le 8 nov. · dans 2 j 4 h')
  })

  it('sans date connue', () => {
    expect(episodeDateLine(media(1, { startDate: { year: null, month: null, day: null } }), 3, null, NOW)).toBe('Déjà sorti')
    const coming = media(1, { status: 'RELEASING', nextAiring: { episode: 2, airingAt: NOW / 1000 + 9999 } })
    expect(episodeDateLine(coming, 5, null, NOW)).toBe('Pas encore sorti')
  })

  it('premier épisode : la date de début de la saison', () => {
    expect(episodeDateLine(media(1, { startDate: { year: 2020, month: 4, day: 2 } }), 1, null, NOW)).toBe('Sorti le 2 avr. 2020')
    const soon = media(1, { status: 'NOT_YET_RELEASED', startDate: { year: 2027, month: 1, day: 10 } })
    expect(episodeDateLine(soon, 1, null, NOW)).toMatch(/^Sort le 10 janv\. · dans 64 j/)
  })

  it('« S01 | E07 »', () => {
    expect(seasonEpisodeLabel(1, 7)).toBe('S01 | E07')
    expect(seasonEpisodeLabel(12, 1100)).toBe('S12 | E1100')
  })

  it('note de la communauté, masquée si absente', () => {
    expect(communityScore(82)).toBe('4,1 / 5 · communauté')
    expect(communityScore(null)).toBeNull()
    expect(episodeScore(4.6)).toBe('4,6 / 5 · communauté')
    expect(episodeScore(null)).toBeNull()
  })

  it('statut de diffusion de l’anime entier', () => {
    expect(animeAiringLabel([{ status: 'FINISHED' }, { status: 'RELEASING' }])).toBe('En diffusion')
    expect(animeAiringLabel([{ status: 'FINISHED' }, { status: 'NOT_YET_RELEASED' }])).toBe('Terminé')
    expect(animeAiringLabel([{ status: 'NOT_YET_RELEASED' }])).toBe('À venir')
    expect(animeAiringLabel([])).toBeNull()
  })
})
