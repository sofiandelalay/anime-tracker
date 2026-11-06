import { describe, expect, it } from 'vitest'
import { animeState, animeStatusLabel, buildListModel } from '../domain/listModel'
import type { Franchise } from '../domain/types'
import { entry, media, mediaMap } from './fixtures'

const franchise = (id: number, ...mediaIds: number[]): [number, Franchise] => [id, { id, mediaIds, computedAt: 0 }]
const s1 = media(1, { title: { english: 'Titans', romaji: null } })
const s2 = media(2, { title: { english: 'Titans Saison 2', romaji: null } })
const s3 = media(3, { status: 'NOT_YET_RELEASED', episodes: null })
const titans = new Map([franchise(1, 1, 2, 3)])
const done = (id: number, over = {}) => entry(id, { franchiseId: 1, status: 'COMPLETED', watched: [[1, 12]], ...over })
const todo = (id: number, over = {}) => entry(id, { franchiseId: 1, ...over })
const all = mediaMap(s1, s2, s3)

describe('Ma liste : À suivre', () => {
  it('ordonne : En cours (récent d’abord), nouvelles saisons, puis À voir', () => {
    const m = new Map([...all, ...mediaMap(media(10), media(11), media(12), media(13))])
    const entries = [
      entry(10, { status: 'CURRENT', watched: [[1, 1]], updatedAt: 5 }),
      entry(11, { status: 'CURRENT', watched: [[1, 1]], updatedAt: 9 }),
      entry(12, { addedAt: 1 }),
      entry(13, { addedAt: 3 }),
      done(1), done(2), todo(3),
    ]
    const model = buildListModel(entries, m, titans)
    expect(model.toWatch.map((c) => [c.kind, c.media.id])).toEqual([
      ['current', 11], ['current', 10], ['newSeason', 3], ['planning', 13], ['planning', 12],
    ])
    expect(model.toWatch[2]!.seasonNumber).toBe(3)
    expect(model.toWatch[2]!.newSeason).toBe(true)
  })

  it('une carte par anime : titre de l’anime, saison en cours', () => {
    const model = buildListModel([done(1), todo(2, { status: 'CURRENT', watched: [[1, 3]] }), todo(3)], all, titans)
    expect(model.toWatch).toHaveLength(1)
    const card = model.toWatch[0]!
    expect(card.media.id).toBe(2)
    expect(card.seasonNumber).toBe(2)
    expect(card.animeTitle).toBe('Titans')
    expect(model.completed).toHaveLength(0)
  })

  it('saison finie, la suivante pas commencée : l’anime reste en cours, sur la suivante', () => {
    const f = new Map([franchise(1, 1, 2)])
    const model = buildListModel([done(1), todo(2)], mediaMap(s1, s2), f)
    expect(model.toWatch.map((c) => [c.kind, c.media.id])).toEqual([['current', 2]])
  })

  it('rien de commencé : À voir, sur la première saison', () => {
    const model = buildListModel([todo(1), todo(2), todo(3)], all, titans)
    expect(model.toWatch.map((c) => [c.kind, c.media.id])).toEqual([['planning', 1]])
  })

  it('un anime suivi entièrement vu va dans Terminés', () => {
    const f = new Map([franchise(1, 1, 2)])
    const model = buildListModel([done(1), done(2)], mediaMap(s1, s2), f)
    expect(model.toWatch).toHaveLength(0)
    expect(model.completed.map((c) => c.franchiseId)).toEqual([1])
    expect(model.completed[0]!.followed).toBe(true)
  })
})

describe('Ma liste : nouvelle saison', () => {
  it('un anime suivi revient dans À suivre avec le badge', () => {
    const model = buildListModel([done(1), done(2), todo(3)], all, titans)
    expect(model.toWatch[0]).toMatchObject({ kind: 'newSeason', newSeason: true })
    expect(model.completed).toHaveLength(0)
  })

  it('un anime non suivi reste dans Terminés, avec un badge discret', () => {
    const model = buildListModel([done(1, { followed: false }), done(2, { followed: false }), todo(3, { followed: false })], all, titans)
    expect(model.toWatch).toHaveLength(0)
    expect(model.completed[0]).toMatchObject({ newSeason: true, followed: false })
  })

  it('un anime mis de côté n’y gagne pas de retour dans À suivre', () => {
    const entries = [todo(1, { followed: false, status: 'CURRENT', watched: [[1, 3]] }), todo(2, { followed: false }), todo(3, { followed: false })]
    const model = buildListModel(entries, all, titans)
    expect(model.toWatch).toHaveLength(0)
    expect(model.shelved).toHaveLength(1)
  })

  it('une franchise abandonnée ne revient jamais', () => {
    const model = buildListModel([done(1), todo(2, { status: 'DROPPED' }), todo(3)], all, titans)
    expect(model.toWatch).toHaveLength(0)
    expect(model.archived).toHaveLength(1)
  })
})

describe('Ma liste : non suivis', () => {
  it('Terminés = entièrement vus, suivis ou non', () => {
    const f = new Map([franchise(1, 1, 2)])
    const model = buildListModel([done(1, { followed: false }), done(2, { followed: false })], mediaMap(s1, s2), f)
    expect(model.completed).toHaveLength(1)
    expect(model.shelved).toHaveLength(0)
  })

  it('Mis de côté = non suivi avec une progression partielle, ou seulement noté', () => {
    const partial = buildListModel([todo(1, { followed: false, status: 'CURRENT', watched: [[1, 3]] }), todo(2, { followed: false })], mediaMap(s1, s2), new Map([franchise(1, 1, 2)]))
    expect(partial.shelved.map((c) => c.media.id)).toEqual([1])
    const rated = buildListModel([todo(1, { followed: false, score: 4 })], mediaMap(s1), new Map([franchise(1, 1)]))
    expect(rated.shelved).toHaveLength(1)
  })

  it('non suivi et sans aucune donnée : nulle part', () => {
    const model = buildListModel([todo(1, { followed: false })], mediaMap(s1), new Map([franchise(1, 1)]))
    expect(Object.values(model).flat()).toHaveLength(0)
  })

  it('libellé de l’anime entier', () => {
    expect(animeStatusLabel(animeState([done(1)], mediaMap(s1)))).toBe('Terminé')
    expect(animeStatusLabel(animeState([todo(1)], mediaMap(s1)))).toBe('À voir')
    expect(animeStatusLabel(animeState([todo(1, { status: 'CURRENT', watched: [[1, 1]], followed: false })], mediaMap(s1)))).toBe('Mis de côté')
    expect(animeStatusLabel(animeState([todo(1, { status: 'DROPPED' })], mediaMap(s1)))).toBe('Archivé')
  })
})
