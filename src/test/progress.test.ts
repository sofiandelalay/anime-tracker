import { describe, expect, it } from 'vitest'
import { applyProgress, maxEpisode, progressInfo, seasonLine } from '../domain/progress'
import { entry, media } from './fixtures'

const airing = media(1, { status: 'RELEASING', episodes: 12, nextAiring: { episode: 8, airingAt: 0 } })

describe('calcul de progression', () => {
  it('calcule la part vue et le repère des épisodes sortis', () => {
    const info = progressInfo({ progress: 6 }, airing)
    expect(info.watchedRatio).toBe(0.5)
    expect(info.aired).toBe(7)
    expect(info.airedRatio).toBeCloseTo(7 / 12)
    expect(info.canIncrement).toBe(true)
    expect(seasonLine(2, info)).toBe('Saison 2 · Ép. 6 / 12')
  })

  it('pas de repère pour une saison terminée de diffusion', () => {
    expect(progressInfo({ progress: 3 }, media(2)).airedRatio).toBeNull()
  })

  it('gère un total inconnu', () => {
    const m = media(3, { status: 'RELEASING', episodes: null, nextAiring: { episode: 101, airingAt: 0 } })
    const info = progressInfo({ progress: 40 }, m)
    expect(info.total).toBeNull()
    expect(seasonLine(null, info)).toBe('Ép. 40')
    expect(maxEpisode(m)).toBe(100)
  })

  it('ne dépasse pas le dernier épisode sorti', () => {
    const r = applyProgress(entry(1, { status: 'CURRENT', progress: 7 }), airing, 8, 1)
    expect(r.entry.progress).toBe(7)
    expect(progressInfo({ progress: 7 }, airing).canIncrement).toBe(false)
  })

  it('rien à cocher pour un anime pas encore sorti', () => {
    const m = media(4, { status: 'NOT_YET_RELEASED', episodes: 12 })
    expect(applyProgress(entry(4), m, 1, 1).entry.progress).toBe(0)
  })

  it('premier épisode : À voir → En cours avec date de début', () => {
    const r = applyProgress(entry(2), media(2), 1, 42)
    expect(r.entry.status).toBe('CURRENT')
    expect(r.entry.startedAt).toBe(42)
    expect(r.completed).toBe(false)
  })
})

describe('passage automatique en Terminé', () => {
  it('passe en Terminé au dernier épisode d’une saison terminée de diffusion', () => {
    const r = applyProgress(entry(2, { status: 'CURRENT', progress: 11, startedAt: 1 }), media(2), 12, 99)
    expect(r.completed).toBe(true)
    expect(r.entry.status).toBe('COMPLETED')
    expect(r.entry.completedAt).toBe(99)
  })

  it('ne termine pas une saison encore en diffusion', () => {
    const m = media(5, { status: 'RELEASING', episodes: 12, nextAiring: null })
    const r = applyProgress(entry(5, { status: 'CURRENT', progress: 11 }), m, 12, 1)
    expect(r.entry.progress).toBe(12)
    expect(r.completed).toBe(false)
    expect(r.entry.status).toBe('CURRENT')
  })

  it('revenir en arrière repasse en En cours', () => {
    const done = entry(2, { status: 'COMPLETED', progress: 12, completedAt: 5 })
    const r = applyProgress(done, media(2), 11, 6)
    expect(r.entry.status).toBe('CURRENT')
    expect(r.entry.completedAt).toBeNull()
  })

  it('ne re-déclenche pas la complétion si déjà Terminé', () => {
    const done = entry(2, { status: 'COMPLETED', progress: 12 })
    expect(applyProgress(done, media(2), 13, 6).completed).toBe(false)
  })
})
