import { describe, expect, it } from 'vitest'
import { buildStats } from '../domain/stats'
import { entry, media, mediaMap } from './fixtures'

const NOW = new Date(2026, 10, 15).getTime()
const THIS_MONTH = new Date(2026, 10, 1).getTime()
const LAST_MONTH = THIS_MONTH - 1

describe('stats', () => {
  it('heures totales = épisodes vus × durée, durée inconnue comptée 24 min', () => {
    const lib = mediaMap(media(1, { duration: 20 }), media(2, { duration: null }))
    const s = buildStats([entry(1, { watched: [[1, 3]] }), entry(2, { watched: [[1, 2]] })], lib, [], NOW)
    expect(s.totalMinutes).toBe(3 * 20 + 2 * 24)
    expect(s.episodes).toBe(5)
  })

  it('ce mois-ci : uniquement le journal du mois en cours', () => {
    const lib = mediaMap(media(1, { duration: 20 }))
    const log = [
      { mediaId: 1, episode: 1, viewing: 1, at: LAST_MONTH },
      { mediaId: 1, episode: 2, viewing: 1, at: THIS_MONTH },
      { mediaId: 1, episode: 3, viewing: 1, at: NOW },
    ]
    expect(buildStats([entry(1, { watched: [[1, 3]] })], lib, log, NOW).monthMinutes).toBe(40)
  })

  it('compte les animes terminés', () => {
    const lib = mediaMap(media(1), media(2))
    expect(buildStats([entry(1, { status: 'COMPLETED' }), entry(2, { status: 'CURRENT' })], lib, [], NOW).completed).toBe(1)
  })

  it('un anime à plusieurs saisons compte pour un, s’il est entièrement vu', () => {
    const lib = mediaMap(media(1), media(2), media(3))
    const entries = [entry(1, { status: 'COMPLETED' }), entry(2, { status: 'COMPLETED', franchiseId: 1 }), entry(3, { status: 'COMPLETED', franchiseId: 3 })]
    expect(buildStats(entries, lib, [], NOW).completed).toBe(2)
  })

  it('« ce mois-ci » ignore les épisodes à date inconnue', () => {
    const lib = mediaMap(media(1, { duration: 20 }))
    const log = [{ mediaId: 1, episode: 1, viewing: 1, at: null }, { mediaId: 1, episode: 2, viewing: 1, at: NOW }]
    expect(buildStats([entry(1, { watched: [[1, 2]] })], lib, log, NOW)).toMatchObject({ totalMinutes: 40, monthMinutes: 20 })
  })

  it('top 3 des genres pondéré par les épisodes vus', () => {
    const lib = mediaMap(
      media(1, { genres: ['Action', 'Drama'] }),
      media(2, { genres: ['Drama', 'Comedy'] }),
      media(3, { genres: ['Fantasy', 'Horror'] }),
    )
    const s = buildStats([entry(1, { watched: [[1, 10]] }), entry(2, { watched: [[1, 5]] }), entry(3, { watched: [[1, 1]] })], lib, [], NOW)
    expect(s.genres).toEqual([
      { name: 'Drama', episodes: 15 },
      { name: 'Action', episodes: 10 },
      { name: 'Comedy', episodes: 5 },
    ])
  })

  it('studio favori : le plus d’épisodes parmi mes animes bien notés seulement', () => {
    const lib = mediaMap(media(1, { studios: ['Gros'] }), media(2, { studios: ['Aimé'] }), media(3, { studios: ['Aimé'] }))
    const s = buildStats([
      entry(1, { watched: [[1, 100]], score: 3 }),
      entry(2, { watched: [[1, 12]], score: 4 }),
      entry(3, { watched: [[1, 12]], score: 5 }),
    ], lib, [], NOW)
    expect(s.favoriteStudio).toEqual({ name: 'Aimé', episodes: 24 })
  })

  it('aucune note haute : pas de studio favori', () => {
    expect(buildStats([entry(1, { watched: [[1, 5]] })], mediaMap(media(1, { studios: ['X'] })), [], NOW).favoriteStudio).toBeNull()
  })
})
