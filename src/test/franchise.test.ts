import { describe, expect, it, vi } from 'vitest'
import { buildFranchise, nextInFranchise, seasonNumber } from '../domain/franchise'
import { media, mediaMap, rel } from './fixtures'

// S1 (1) → S2 (2) → Film (3) → S3 (4) ; S1 a aussi un spin-off (5) et une OVA (6).
const all = mediaMap(
  media(1, { relations: [rel(2, 'SEQUEL'), rel(5, 'SPIN_OFF'), rel(6, 'SIDE_STORY', { format: 'OVA' })] }),
  media(2, { relations: [rel(1, 'PREQUEL'), rel(3, 'SEQUEL', { format: 'MOVIE' })] }),
  media(3, { format: 'MOVIE', relations: [rel(2, 'PREQUEL'), rel(4, 'SEQUEL')] }),
  media(4, { relations: [rel(3, 'PREQUEL')] }),
  media(5, { relations: [rel(1, 'PARENT')] }),
  media(6, { format: 'OVA' }),
)
const loader = () =>
  vi.fn(async (ids: number[]) => new Map(ids.flatMap((id) => (all.has(id) ? [[id, all.get(id)!] as const] : []))))

describe('regroupement en franchises', () => {
  it('suit SEQUEL / PREQUEL, traverse les films mais ne garde que TV / TV_SHORT / ONA', async () => {
    const load = loader()
    const f = await buildFranchise(all.get(4)!, load)
    expect(f.id).toBe(1)
    expect(f.mediaIds).toEqual([1, 2, 4])
  })

  it('donne le même identifiant quelle que soit la saison de départ', async () => {
    expect((await buildFranchise(all.get(1)!, loader())).id).toBe(1)
    expect((await buildFranchise(all.get(2)!, loader())).id).toBe(1)
  })

  it('ignore les spin-off et charge les fiches par lots (un appel par niveau)', async () => {
    const load = loader()
    const f = await buildFranchise(all.get(1)!, load)
    expect(f.mediaIds).not.toContain(5)
    expect(load).toHaveBeenCalledTimes(3) // [2], [3], [4]
  })

  it('identifiant = la saison la plus ancienne, même si la chaîne est mal ordonnée', async () => {
    const m = mediaMap(
      media(10, { startDate: { year: 2015, month: 1, day: 1 }, relations: [rel(11, 'PREQUEL')] }),
      media(11, { startDate: { year: 2018, month: 1, day: 1 }, relations: [rel(10, 'SEQUEL')] }),
    )
    const f = await buildFranchise(m.get(11)!, async (ids) => new Map(ids.map((id) => [id, m.get(id)!])))
    expect(f).toEqual({ id: 10, mediaIds: [10, 11] })
  })

  it('un film ajouté seul forme sa propre franchise', async () => {
    const load = loader()
    expect(await buildFranchise(all.get(3)!, load)).toEqual({ id: 3, mediaIds: [3] })
    expect(load).not.toHaveBeenCalled()
  })

  it('numérote les saisons et trouve la suivante', () => {
    expect(seasonNumber([1, 2, 4], 4)).toBe(3)
    expect(seasonNumber([1], 1)).toBeNull()
    expect(nextInFranchise([1, 2, 4], 2)).toBe(4)
    expect(nextInFranchise([1, 2, 4], 4)).toBeNull()
  })
})
