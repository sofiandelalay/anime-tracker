import { describe, expect, it } from 'vitest'
import { applyWatched, episodeRowCount, globalProgress, globalScore, maxEpisode, progressInfo, seasonLine } from '../domain/progress'
import { entry, media } from './fixtures'

const airing = media(1, { status: 'RELEASING', episodes: 12, nextAiring: { episode: 8, airingAt: 0 } })

describe('calcul de progression', () => {
  it('nombre de cases cochées / total, et repère des épisodes sortis', () => {
    const info = progressInfo(entry(0, { watched: [[1, 4], [6, 7]] }), airing)
    expect(info.watched).toBe(6)
    expect(info.watchedRatio).toBe(0.5)
    expect(info.aired).toBe(7)
    expect(info.airedRatio).toBeCloseTo(7 / 12)
    expect(seasonLine(2, info)).toBe('Saison 2 · Ép. 6 / 12')
  })

  it('« +1 épisode » vise le premier épisode non vu, même s’il y a un trou', () => {
    expect(progressInfo(entry(0, { watched: [[1, 4], [6, 7]] }), airing).nextEpisode).toBe(5)
  })

  it('ne propose pas un épisode pas encore sorti', () => {
    const info = progressInfo(entry(0, { watched: [[1, 7]] }), airing)
    expect(info.nextEpisode).toBeNull()
    expect(info.canIncrement).toBe(false)
  })

  it('gère un total inconnu', () => {
    const m = media(3, { status: 'RELEASING', episodes: null, nextAiring: { episode: 101, airingAt: 0 } })
    const info = progressInfo(entry(0, { watched: [[1, 40]] }), m)
    expect(info.total).toBeNull()
    expect(seasonLine(null, info)).toBe('Ép. 40')
    expect(maxEpisode(m)).toBe(100)
    expect(episodeRowCount(m, [[1, 40]])).toBe(101)
  })

  it('rien à cocher pour un anime pas encore sorti', () => {
    expect(progressInfo(null, media(4, { status: 'NOT_YET_RELEASED', episodes: 12 })).canIncrement).toBe(false)
  })
})

describe('statut déduit des cases', () => {
  it('première case : À voir → En cours avec date de début', () => {
    const r = applyWatched(entry(2), media(2), [[1, 1]], 42)
    expect(r.entry.status).toBe('CURRENT')
    expect(r.entry.startedAt).toBe(42)
    expect(r.completed).toBe(false)
  })

  it('toutes les cases cochées, dans le désordre : Terminé', () => {
    const r = applyWatched(entry(2, { status: 'CURRENT', watched: [[2, 12]] }), media(2), [[1, 12]], 99)
    expect(r.completed).toBe(true)
    expect(r.entry.status).toBe('COMPLETED')
    expect(r.entry.completedAt).toBe(99)
  })

  it('ne termine pas une saison encore en diffusion', () => {
    const m = media(5, { status: 'RELEASING', episodes: 12, nextAiring: null })
    const r = applyWatched(entry(5, { status: 'CURRENT' }), m, [[1, 12]], 1)
    expect(r.completed).toBe(false)
    expect(r.entry.status).toBe('CURRENT')
  })

  it('décocher repasse en En cours, ou À voir s’il ne reste rien', () => {
    const done = entry(2, { status: 'COMPLETED', watched: [[1, 12]], completedAt: 5 })
    const r = applyWatched(done, media(2), [[1, 11]], 6)
    expect(r.entry.status).toBe('CURRENT')
    expect(r.entry.completedAt).toBeNull()
    expect(applyWatched(entry(2, { status: 'CURRENT', watched: [[1, 1]] }), media(2), [], 6).entry.status).toBe('PLANNING')
  })

  it('ne re-déclenche pas la fin de saison si déjà Terminé', () => {
    const done = entry(2, { status: 'COMPLETED', watched: [[1, 12]] })
    expect(applyWatched(done, media(2), [[1, 12]], 6).completed).toBe(false)
  })

  it('cocher sur un anime archivé l’enregistre sans le faire revenir, sauf s’il est fini', () => {
    const dropped = entry(2, { status: 'DROPPED', watched: [[1, 3]] })
    expect(applyWatched(dropped, media(2), [[1, 4]], 6).entry.status).toBe('DROPPED')
    expect(applyWatched(dropped, media(2), [[1, 12]], 6).entry.status).toBe('COMPLETED')
  })
})

describe('niveau de l’anime entier', () => {
  it('progression globale : toutes saisons sorties, pas les annoncées', () => {
    const seasons = [media(1), media(2, { status: 'RELEASING', episodes: 24, nextAiring: { episode: 5, airingAt: 0 } }), media(3, { status: 'NOT_YET_RELEASED', episodes: 12 })]
    const entries = new Map([[1, entry(1, { watched: [[1, 12]] })], [2, entry(2, { watched: [[1, 3]] })]])
    expect(globalProgress(seasons, entries)).toMatchObject({ watched: 15, total: 36 })
  })

  it('note globale : moyenne des saisons notées', () => {
    expect(globalScore([entry(1, { score: 5 }), entry(2, { score: 4 }), entry(3)])).toBe(4.5)
    expect(globalScore([entry(1)])).toBeNull()
  })
})
