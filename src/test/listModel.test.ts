import { describe, expect, it } from 'vitest'
import { buildListModel } from '../domain/listModel'
import { detectNewSeason } from '../domain/newSeason'
import type { Franchise } from '../domain/types'
import { entry, media, mediaMap, rel } from './fixtures'

const s1 = media(1, { relations: [rel(2, 'SEQUEL', { status: 'NOT_YET_RELEASED' })] })
const s2 = media(2, { status: 'NOT_YET_RELEASED', relations: [rel(1, 'PREQUEL')] })

describe('détection de nouvelle saison', () => {
  it('détecte un SEQUEL annoncé pour une franchise entièrement terminée', () => {
    expect(detectNewSeason([entry(1, { status: 'COMPLETED' })], mediaMap(s1, s2))).toBe(2)
  })

  it('accepte aussi un SEQUEL en diffusion', () => {
    const a = media(1, { relations: [rel(2, 'SEQUEL', { status: 'RELEASING' })] })
    expect(detectNewSeason([entry(1, { status: 'COMPLETED' })], mediaMap(a))).toBe(2)
  })

  it('ignore une franchise abandonnée, même partiellement', () => {
    const entries = [entry(1, { status: 'COMPLETED' }), entry(3, { status: 'DROPPED', franchiseId: 1 })]
    expect(detectNewSeason(entries, mediaMap(s1, s2))).toBeNull()
  })

  it('ignore une franchise non terminée', () => {
    expect(detectNewSeason([entry(1, { status: 'CURRENT' })], mediaMap(s1, s2))).toBeNull()
  })

  it('ignore une suite déjà dans ma liste, un film ou une suite déjà sortie', () => {
    expect(detectNewSeason([entry(1, { status: 'COMPLETED' }), entry(2, { status: 'COMPLETED' })], mediaMap(s1, s2))).toBeNull()
    const film = media(1, { relations: [rel(9, 'SEQUEL', { format: 'MOVIE', status: 'NOT_YET_RELEASED' })] })
    expect(detectNewSeason([entry(1, { status: 'COMPLETED' })], mediaMap(film))).toBeNull()
    const old = media(1, { relations: [rel(9, 'SEQUEL', { status: 'FINISHED' })] })
    expect(detectNewSeason([entry(1, { status: 'COMPLETED' })], mediaMap(old))).toBeNull()
  })

  it('trouve une saison reliée via un film grâce aux membres de la franchise', () => {
    const a = media(1, { relations: [rel(3, 'SEQUEL', { format: 'MOVIE' })] })
    const b = media(4, { status: 'RELEASING' })
    expect(detectNewSeason([entry(1, { status: 'COMPLETED' })], mediaMap(a, b), [1, 4])).toBe(4)
  })
})

describe('Ma liste', () => {
  const franchises = new Map<number, Franchise>([[1, { id: 1, mediaIds: [1, 2], computedAt: 0 }]])

  it('ordonne : En cours (récent d’abord), nouvelles saisons, puis À voir', () => {
    const m = mediaMap(s1, s2, media(10), media(11), media(12), media(13))
    const entries = [
      entry(10, { status: 'CURRENT', updatedAt: 5 }),
      entry(11, { status: 'CURRENT', updatedAt: 9 }),
      entry(12, { status: 'PLANNING', addedAt: 1 }),
      entry(13, { status: 'PLANNING', addedAt: 3 }),
      entry(1, { status: 'COMPLETED' }),
    ]
    const model = buildListModel(entries, m, franchises)
    expect(model.toWatch.map((c) => [c.kind, c.media.id])).toEqual([
      ['current', 11], ['current', 10], ['newSeason', 2], ['planning', 13], ['planning', 12],
    ])
    expect(model.toWatch[2]!.seasonNumber).toBe(2)
    expect(model.toWatch[2]!.entry).toBeNull()
    expect(model.completed.map((c) => c.media.id)).toEqual([1])
  })

  it('une carte par franchise, sur la saison en cours', () => {
    const a = media(20, { startDate: { year: 2010, month: 1, day: 1 } })
    const b = media(21, { startDate: { year: 2012, month: 1, day: 1 } })
    const f = new Map<number, Franchise>([[20, { id: 20, mediaIds: [20, 21], computedAt: 0 }]])
    const entries = [
      entry(20, { status: 'COMPLETED', franchiseId: 20 }),
      entry(21, { status: 'CURRENT', franchiseId: 20, progress: 3 }),
    ]
    const model = buildListModel(entries, mediaMap(a, b), f)
    expect(model.toWatch).toHaveLength(1)
    expect(model.toWatch[0]!.media.id).toBe(21)
    expect(model.toWatch[0]!.seasonNumber).toBe(2)
    expect(model.completed).toHaveLength(0)
  })

  it('les franchises archivées restent dans Archivés', () => {
    const model = buildListModel([entry(1, { status: 'DROPPED' })], mediaMap(s1, s2), franchises)
    expect(model.toWatch).toHaveLength(0)
    expect(model.archived).toHaveLength(1)
  })
})
