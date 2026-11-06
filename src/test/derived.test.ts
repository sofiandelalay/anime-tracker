import { beforeEach, describe, expect, it } from 'vitest'
import { AniListClient } from '../api/client'
import { fetchChainSummaries, fetchMediaByIds, searchAnime, type ApiDeps } from '../api/media'
import type { RawMedia } from '../api/queries'
import { CacheDB } from '../db/cacheDb'
import { buildFranchise } from '../domain/franchise'
import recorded from './anilist-recorded.json'

// Réponses réelles d'AniList (novembre 2026), sans les champs étrangers aux relations.
const SEARCH = recorded.search as unknown as Record<string, RawMedia[]>
const MEDIA = recorded.media as unknown as Record<string, RawMedia>
const FRIEREN = 154587
const MINI_PART_1 = 170068

const byId = new Map<number, RawMedia>([...Object.values(SEARCH).flat(), ...Object.values(MEDIA)].map((m) => [m.id, m]))
const cache = new CacheDB('test-derived')

function depsFor(results: Record<string, RawMedia[]> = SEARCH): ApiDeps {
  const fetchRecorded: typeof fetch = async (_u, init) => {
    const { variables } = JSON.parse(String(init!.body)) as { variables: { ids?: number[]; search?: string } }
    const media = variables.ids ? variables.ids.flatMap((id) => byId.get(id) ?? []) : results[variables.search!]!
    return new Response(JSON.stringify({ data: { Page: { media } } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  return { client: new AniListClient({ fetch: fetchRecorded, sleep: async () => undefined }), cache, now: () => 1 }
}

/** Ce qu'affiche la recherche : les séries, avec leur total, et la franchise de la première. */
async function searchSeries(query: string, deps = depsFor()) {
  const rows = await searchAnime(query, deps)
  const series = rows.filter((m) => m.format === 'TV' || m.format === 'TV_SHORT' || m.format === 'ONA')
  const summaries = await fetchChainSummaries(series, undefined, deps)
  const franchise = await buildFranchise(series[0]!, (ids) => fetchMediaByIds(ids, {}, deps))
  return { series, first: series[0]!, summary: summaries.get(series[0]!.id)!, seasons: franchise.mediaIds }
}

describe('saisons et dérivés, sur les vraies données AniList', () => {
  beforeEach(async () => {
    await cache.delete()
    await cache.open()
  })

  it('l’enregistrement contient bien le piège : Frieren et une chaîne de 3 ONA dérivées', () => {
    expect(SEARCH.Frieren!.map((m) => m.id)).toEqual(expect.arrayContaining([FRIEREN, MINI_PART_1, 189513, 206425]))
    expect(byId.get(MINI_PART_1)!.relations!.edges.map((e) => [e.relationType, e.node!.id])).toEqual(
      expect.arrayContaining([['PARENT', FRIEREN], ['SEQUEL', 189513]]),
    )
  })

  it('Frieren : une seule ligne, au titre de la première saison, 3 saisons et 38 épisodes', async () => {
    const { series, first, summary, seasons } = await searchSeries('Frieren')
    expect(series.map((m) => m.id)).toEqual([FRIEREN])
    expect(first.title.romaji).toBe('Sousou no Frieren')
    expect(seasons).toEqual([FRIEREN, 182255, 209939]) // la dernière est annoncée, sans épisodes
    expect(summary).toEqual({ seasons: 3, episodes: 38 })
  })

  it('le dérivé trouvé seul garde sa ligne, sans jamais rejoindre les saisons de Frieren', async () => {
    const onlyMini = { mini: SEARCH.Frieren!.filter((m) => m.id === MINI_PART_1) }
    const { series, summary, seasons } = await searchSeries('mini', depsFor(onlyMini))
    expect(series.map((m) => m.id)).toEqual([MINI_PART_1])
    expect(seasons).toEqual([MINI_PART_1, 189513, 206425])
    expect(summary).toEqual({ seasons: 3, episodes: 24 })
  })

  it('Re:Zero : Break Time (TV_SHORT puis ONA) ne fait ni une ligne ni une saison', async () => {
    const { series, summary, seasons } = await searchSeries('Re:Zero')
    expect(series.map((m) => m.id)).toEqual([21355])
    expect(seasons).toEqual([21355, 108632, 119661, 163134, 189046])
    expect(summary).toEqual({ seasons: 5, episodes: 85 })
  })

  it('Slime : la S2 n’est reliée que par une OVA, traversée mais jamais comptée ; Nikki reste dehors', async () => {
    const { series, summary, seasons } = await searchSeries('Tensei Shitara Slime')
    expect(series.map((m) => m.id)).toEqual([101280])
    expect(seasons).toEqual([101280, 108511, 116742, 156822, 182205, 217331])
    expect(summary).toEqual({ seasons: 6, episodes: 96 })
  })

  it('Railgun : un PARENT vers Index, absent des résultats, ne fait pas disparaître une vraie série', async () => {
    const { series, summary, seasons } = await searchSeries('Railgun')
    expect(series.map((m) => m.id)).toEqual([6213])
    expect(seasons).toHaveLength(4)
    expect(summary).toEqual({ seasons: 4, episodes: 73 })
  })
})
