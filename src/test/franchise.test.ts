import { describe, expect, it, vi } from 'vitest'
import { buildFranchise, nextInFranchise, resolveRoots, seasonNumber } from '../domain/franchise'
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

describe('anime global (resolveRoots)', () => {
  const chain = mediaMap(
    media(1, { relations: [rel(2, 'SEQUEL')] }),
    media(2, { relations: [rel(1, 'PREQUEL'), rel(3, 'SEQUEL', { format: 'MOVIE' })] }),
    media(3, { format: 'MOVIE', relations: [rel(2, 'PREQUEL'), rel(4, 'SEQUEL')] }),
    media(4, { relations: [rel(3, 'PREQUEL')] }),
    media(10, { format: 'MOVIE', relations: [rel(11, 'PREQUEL')] }),
    media(11, { format: 'MOVIE' }),
    media(20, { relations: [rel(1, 'SIDE_STORY')] }),
  )
  const loader = () => {
    const calls: number[][] = []
    const load = async (ids: number[]) => {
      calls.push(ids)
      return new Map(ids.flatMap((id) => (chain.has(id) ? [[id, chain.get(id)!] as const] : [])))
    }
    return { calls, load }
  }

  it('remonte jusqu’à la première saison, en traversant un film', async () => {
    const { load } = loader()
    const info = (await resolveRoots([chain.get(4)!], load)).get(4)!
    expect(info.root.id).toBe(1)
    expect(info.chain.sort()).toEqual([1, 2, 3, 4])
  })

  it('une première saison reste elle-même, sans aucune requête', async () => {
    const { load, calls } = loader()
    expect((await resolveRoots([chain.get(1)!], load)).get(1)!.root.id).toBe(1)
    expect(calls).toHaveLength(0)
  })

  it('un seul appel par niveau, quel que soit le nombre de fiches', async () => {
    const { load, calls } = loader()
    await resolveRoots([chain.get(4)!, chain.get(2)!, chain.get(10)!], load)
    // Niveau 1 : 3, 1, 11 ; niveau 2 : 2 est déjà connu, rien à charger.
    expect(calls).toHaveLength(1)
    expect(calls[0]!.sort()).toEqual([1, 11, 3])
  })

  it('une chaîne de films seuls : le plus ancien', async () => {
    const { load } = loader()
    expect((await resolveRoots([chain.get(10)!], load)).get(10)!.root.id).toBe(10)
  })

  it('ne suit que les préquels (un spin-off reste à part), et survit à une fiche introuvable', async () => {
    const { load } = loader()
    expect((await resolveRoots([chain.get(20)!], load)).get(20)!.root.id).toBe(20)
    const orphan = media(30, { relations: [rel(999, 'PREQUEL')] })
    expect((await resolveRoots([orphan], load)).get(30)!.root.id).toBe(30)
  })
})

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
