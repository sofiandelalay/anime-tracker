import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db/trackerDb'
import { animeBadges } from '../domain/listModel'
import { addRecent, clearRecents, forgetSearch, MAX_RECENTS, readRecents, rememberSearch } from '../domain/recents'
import { entry, media, mediaMap } from './fixtures'

describe('recherches récentes', () => {
  beforeEach(() => db.meta.clear())

  it('la plus récente d’abord, sans doublon, casse et espaces ignorés', () => {
    expect(addRecent(['Frieren', 'Monster'], '  monster ')).toEqual(['monster', 'Frieren'])
    expect(addRecent([], 'one   piece')).toEqual(['one piece'])
  })

  it('ignore ce qui est trop court pour avoir été une recherche', () => {
    expect(addRecent(['Frieren'], ' a ')).toEqual(['Frieren'])
  })

  it(`en garde ${MAX_RECENTS} au plus`, () => {
    const list = Array.from({ length: MAX_RECENTS }, (_, i) => `anime ${i}`)
    const out = addRecent(list, 'nouveau')
    expect(out).toHaveLength(MAX_RECENTS)
    expect(out[0]).toBe('nouveau')
    expect(out).not.toContain(`anime ${MAX_RECENTS - 1}`)
  })

  it('se conservent, se suppriment une par une ou toutes', async () => {
    await rememberSearch('Frieren')
    await rememberSearch('Monster')
    expect(await readRecents()).toEqual(['Monster', 'Frieren'])
    await forgetSearch('Monster')
    expect(await readRecents()).toEqual(['Frieren'])
    await clearRecents()
    expect(await readRecents()).toEqual([])
  })
})

describe('état affiché dans les résultats', () => {
  const lib = mediaMap(media(1), media(2), media(3, { status: 'NOT_YET_RELEASED' }))
  const done = (id: number, over = {}) => entry(id, { franchiseId: 1, status: 'COMPLETED', watched: [[1, 12]], ...over })
  const label = (entries: ReturnType<typeof entry>[], id = 1) => animeBadges(entries, lib).get(id)

  it('jamais touché : aucun état', () => {
    expect(label([])).toBeUndefined()
  })

  it('Suivi, sur n’importe quelle saison de l’anime', () => {
    const entries = [done(1), entry(2, { franchiseId: 1, status: 'CURRENT', watched: [[1, 1]] })]
    expect(label(entries, 1)).toEqual({ label: 'Suivi', followed: true })
    expect(label(entries, 2)?.label).toBe('Suivi')
  })

  it('Terminé, suivi ou non : on peut encore suivre un anime non suivi', () => {
    expect(label([done(1)])).toEqual({ label: 'Terminé', followed: true })
    expect(label([done(1, { followed: false })])).toEqual({ label: 'Terminé', followed: false })
  })

  it('non suivi, tout vu sauf une saison annoncée : Terminé, comme dans Ma liste', () => {
    expect(label([done(1, { followed: false }), entry(3, { franchiseId: 1, followed: false })])?.label).toBe('Terminé')
  })

  it('une nouvelle saison sur un anime suivi : Suivi', () => {
    expect(label([done(1), entry(3, { franchiseId: 1 })])?.label).toBe('Suivi')
  })

  it('Mis de côté : non suivi avec une progression ou une note', () => {
    expect(label([entry(1, { followed: false, status: 'CURRENT', watched: [[1, 2]] })])).toEqual({ label: 'Mis de côté', followed: false })
    expect(label([entry(1, { followed: false, score: 4 })])?.label).toBe('Mis de côté')
  })

  it('Archivé : pas d’ajout d’un tap', () => {
    expect(label([entry(1, { status: 'DROPPED' })])).toEqual({ label: 'Archivé', followed: true })
  })

  it('non suivi sans aucune donnée : aucun état', () => {
    expect(label([entry(1, { followed: false })])).toBeUndefined()
  })
})
