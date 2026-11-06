import { describe, expect, it } from 'vitest'
import {
  addEpisodes, countWatched, diffEpisodes, episodeSlices, firstUnwatched, hasEpisode, isEpisodeRanges, missingBefore, planToggle, removeEpisode,
} from '../domain/episodes'

describe('ensemble d’épisodes vus', () => {
  it('reste compact : mille épisodes tiennent en une plage', () => {
    let w = addEpisodes([], 1, 1000)
    expect(w).toEqual([[1, 1000]])
    expect(countWatched(w)).toBe(1000)
    w = addEpisodes(w, 1001)
    expect(w).toEqual([[1, 1001]])
  })

  it('fusionne les plages qui se touchent, dans n’importe quel ordre', () => {
    expect(addEpisodes(addEpisodes(addEpisodes([], 3), 1), 2)).toEqual([[1, 3]])
    expect(addEpisodes([[1, 2], [5, 6]], 3, 4)).toEqual([[1, 6]])
    expect(addEpisodes([[1, 2]], 5)).toEqual([[1, 2], [5, 5]])
  })

  it('retirer coupe la plage sans toucher au reste', () => {
    expect(removeEpisode([[1, 5]], 3)).toEqual([[1, 2], [4, 5]])
    expect(removeEpisode([[1, 5]], 1)).toEqual([[2, 5]])
    expect(removeEpisode([[1, 5]], 5)).toEqual([[1, 4]])
    expect(removeEpisode([[3, 3]], 3)).toEqual([])
    expect(removeEpisode([[1, 2]], 9)).toEqual([[1, 2]])
  })

  it('premier épisode non vu', () => {
    expect(firstUnwatched([])).toBe(1)
    expect(firstUnwatched([[1, 4], [6, 7]])).toBe(5)
    expect(firstUnwatched([[3, 4]])).toBe(1)
  })

  it('compare deux ensembles pour le journal', () => {
    expect(diffEpisodes([[1, 2]], [[2, 3]])).toEqual({ added: [3], removed: [1] })
  })

  it('valide les données d’un fichier', () => {
    expect(isEpisodeRanges([[1, 2]])).toBe(true)
    expect(isEpisodeRanges([[0, 2]])).toBe(false)
    expect(isEpisodeRanges([[3, 2]])).toBe(false)
    expect(isEpisodeRanges(null)).toBe(false)
  })

  it('tranches pour les saisons longues', () => {
    expect(episodeSlices(250)).toEqual([{ from: 1, to: 100 }, { from: 101, to: 200 }, { from: 201, to: 250 }])
  })
})

describe('cocher un épisode plus loin', () => {
  it('aucun précédent manquant : la case se coche directement', () => {
    expect(planToggle([[1, 4]], 5)).toEqual({ kind: 'check' })
    expect(planToggle([], 1)).toEqual({ kind: 'check' })
  })

  it('certains manquants : X = le nombre réel d’épisodes non cochés avant K', () => {
    expect(planToggle([[1, 2], [5, 5]], 8)).toEqual({ kind: 'confirm', missing: 4 })
    expect(missingBefore([[1, 2], [5, 5]], 8)).toBe(4)
  })

  it('tous manquants', () => {
    expect(planToggle([], 8)).toEqual({ kind: 'confirm', missing: 7 })
  })

  it('un épisode coché après K ne compte pas comme précédent', () => {
    expect(planToggle([[1, 3], [9, 10]], 5)).toEqual({ kind: 'confirm', missing: 1 })
  })

  it('décocher ne décoche que celui-là, sans fenêtre', () => {
    expect(planToggle([[1, 8]], 3)).toEqual({ kind: 'uncheck' })
    expect(hasEpisode(removeEpisode([[1, 8]], 3), 4)).toBe(true)
  })
})
