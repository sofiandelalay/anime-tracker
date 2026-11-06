import { describe, expect, it } from 'vitest'
import { airingLabel, cleanSynopsis, formatCountdown, formatHours, formatStartDate, genreLabel } from '../domain/format'
import { buildSeasonGrid, nextSeason, seasonLabel, seasonOf, type SeasonRef } from '../domain/seasons'
import { entry, media, mediaMap } from './fixtures'

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

describe('saisons', () => {
  it.each([
    [0, 'WINTER'], [2, 'WINTER'], [3, 'SPRING'], [5, 'SPRING'], [6, 'SUMMER'], [8, 'SUMMER'], [9, 'FALL'], [11, 'FALL'],
  ])('mois %i → %s', (month, season) => {
    expect(seasonOf(new Date(2026, month, 15)).season).toBe(season)
  })

  it('l’hiver suit l’automne, l’année change', () => {
    expect(nextSeason({ season: 'FALL', year: 2026 })).toEqual({ season: 'WINTER', year: 2027 })
    expect(nextSeason({ season: 'WINTER', year: 2027 })).toEqual({ season: 'SPRING', year: 2027 })
  })

  it('libellés en français', () => {
    expect(seasonLabel({ season: 'FALL', year: 2026 })).toBe('Automne 2026')
    expect(seasonLabel({ season: 'WINTER', year: 2027 })).toBe('Hiver 2027')
  })
})

describe('compte à rebours', () => {
  it('jours et heures', () => expect(formatCountdown(2 * DAY + 4 * HOUR + 10 * MIN)).toBe('2 j 4 h'))
  it('moins d’une heure', () => expect(formatCountdown(35 * MIN)).toBe('35 min'))
  it('heures et minutes', () => expect(formatCountdown(4 * HOUR + 20 * MIN)).toBe('4 h 20 min'))
  it('jour rond', () => expect(formatCountdown(3 * DAY)).toBe('3 j'))
  it('jamais 0 min', () => expect(formatCountdown(5_000)).toBe('1 min'))

  it('badge complet, y compris une fois l’horaire passé', () => {
    const next = { episode: 7, airingAt: 1000 }
    expect(airingLabel(next, 1000 * 1000 - 2 * DAY - 4 * HOUR)).toBe('Ép. 7 dans 2 j 4 h')
    expect(airingLabel(next, 1000 * 1000 - 35 * MIN)).toBe('Ép. 7 dans 35 min')
    expect(airingLabel(next, 1000 * 1000 + MIN)).toBe('Ép. 7 sorti')
  })
})

describe('date de début', () => {
  it('jour connu', () => expect(formatStartDate({ year: 2027, month: 1, day: 10 })).toBe('10 janv.'))
  it('mois seul', () => expect(formatStartDate({ year: 2027, month: 1, day: null })).toBe('janvier'))
  it('sans date précise : rien', () => {
    expect(formatStartDate({ year: 2027, month: null, day: null })).toBeNull()
    expect(formatStartDate({ year: null, month: null, day: null })).toBeNull()
  })
})

describe('grille d’une saison', () => {
  const fall: SeasonRef = { season: 'FALL', year: 2026 }
  const inFall = { season: 'FALL', seasonYear: 2026 }

  it('met mes animes en premier (prochain épisode d’abord), même hors des pages chargées', () => {
    const paged = media(1, { ...inFall, popularity: 90 })
    const followedPaged = media(2, { ...inFall, popularity: 80, nextAiring: { episode: 2, airingAt: 2000 } })
    const followedFar = media(3, { ...inFall, popularity: 1, nextAiring: { episode: 2, airingAt: 1000 } })
    const grid = buildSeasonGrid([paged, followedPaged], [entry(2), entry(3)], mediaMap(followedPaged, followedFar), fall, true)
    expect(grid.followed.map((m) => m.id)).toEqual([3, 2])
    expect(grid.others.map((m) => m.id)).toEqual([1])
  })

  it('saison en cours : inclut ce que je suis encore en diffusion depuis une saison passée', () => {
    const longRunner = media(5, { season: 'SUMMER', seasonYear: 2026, status: 'RELEASING' })
    expect(buildSeasonGrid([], [entry(5)], mediaMap(longRunner), fall, true).followed).toHaveLength(1)
    expect(buildSeasonGrid([], [entry(5)], mediaMap(longRunner), { season: 'WINTER', year: 2027 }, false).followed).toHaveLength(0)
  })

  it('un anime abandonné ne compte pas comme suivi', () => {
    const m = media(6, inFall)
    const grid = buildSeasonGrid([m], [entry(6, { status: 'DROPPED' })], mediaMap(m), fall, true)
    expect(grid.followed).toHaveLength(0)
    expect(grid.others.map((x) => x.id)).toEqual([6])
  })

  it('un anime non suivi ne compte pas comme suivi', () => {
    const m = media(8, inFall)
    expect(buildSeasonGrid([m], [entry(8, { followed: false })], mediaMap(m), fall, true).followed).toHaveLength(0)
  })

  it('garde la fiche la plus récente pour le compte à rebours', () => {
    const old = media(7, { ...inFall, fetchedAt: 1, nextAiring: { episode: 1, airingAt: 1 } })
    const recent = media(7, { ...inFall, fetchedAt: 2, nextAiring: { episode: 2, airingAt: 2 } })
    expect(buildSeasonGrid([recent], [entry(7)], mediaMap(old), fall, true).followed[0]!.nextAiring?.episode).toBe(2)
    expect(buildSeasonGrid([old], [entry(7)], mediaMap(recent), fall, true).followed[0]!.nextAiring?.episode).toBe(2)
  })
})

describe('synopsis', () => {
  it('retire balises, spoilers et source, décode les entités', () => {
    const raw = 'Un <i>héros</i> &amp; son chat.<br><br>~!Il meurt.!~Fin.<br>\n(Source: MAL)'
    const text = cleanSynopsis(raw)
    expect(text).not.toMatch(/[<>]|Source|meurt/)
    expect(text).toContain('Un héros & son chat.')
    expect(text).toContain('Fin.')
  })

  it('une balise échappée reste du texte inoffensif', () => {
    expect(cleanSynopsis('a &lt;script&gt; b')).toBe('a <script> b')
  })

  it('coupe proprement au mot', () => {
    expect(cleanSynopsis('un deux trois quatre', 10)).toBe('un deux…')
  })

  it('rien en entrée : chaîne vide', () => expect(cleanSynopsis(null)).toBe(''))
})

describe('libellés', () => {
  it('traduit les genres', () => {
    expect(genreLabel('Slice of Life')).toBe('Tranche de vie')
    expect(genreLabel('Action')).toBe('Action')
  })

  it('heures', () => {
    expect(formatHours(0)).toBe('0 h')
    expect(formatHours(45)).toBe('45 min')
    expect(formatHours(210)).toBe('3,5 h')
    expect(formatHours(7700)).toBe('128 h')
  })
})
