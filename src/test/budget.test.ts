import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cacheDb } from '../db/cacheDb'
import { db } from '../db/trackerDb'
import type { Entry } from '../domain/types'
import { raw } from './fixtures'

/**
 * Budget AniList (30 req/min, file à 25) avec 100 animes dans ma liste, tous notés, et tous les candidats
 * de Pour toi étant des saisons 3 (le pire cas) : un rafraîchissement complet + le calcul de Pour toi
 * + une page de Saisons tiennent dans une seule minute.
 */
const FRANCHISES = 50 // 50 franchises de 2 saisons = 100 animes, chacune reliée à un film puis une S3 hors liste.

function world() {
  const out = new Map<number, ReturnType<typeof raw>>()
  const edge = (id: number, relationType: string, format: 'TV' | 'MOVIE' = 'TV') => ({
    relationType, node: { id, type: 'ANIME', format, status: 'FINISHED' as const, isAdult: false },
  })
  // Pire cas pour Pour toi : chaque candidat recommandé est une saison 3, à remonter sur 2 niveaux.
  for (let id = 1000; id < 1000 + FRANCHISES * 10; id += 1) {
    for (let i = 0; i < 10; i++) {
      const s3 = 5000 + id + i
      out.set(s3, raw(s3, { relations: { edges: [edge(s3 + 10_000, 'PREQUEL')] } }))
      out.set(s3 + 10_000, raw(s3 + 10_000, { relations: { edges: [edge(s3 + 20_000, 'PREQUEL')] } }))
      out.set(s3 + 20_000, raw(s3 + 20_000))
    }
  }
  for (let f = 0; f < FRANCHISES; f++) {
    const [s1, s2, film, s3] = [1000 + f * 10, 1001 + f * 10, 1002 + f * 10, 1003 + f * 10]
    out.set(s1, raw(s1, { startDate: { year: 2000, month: 1, day: 1 }, relations: { edges: [edge(s2, 'SEQUEL')] } }))
    out.set(s2, raw(s2, { startDate: { year: 2001, month: 1, day: 1 }, relations: { edges: [edge(s1, 'PREQUEL'), edge(film, 'SEQUEL', 'MOVIE')] } }))
    out.set(film, raw(film, { format: 'MOVIE', startDate: { year: 2002, month: 1, day: 1 }, relations: { edges: [edge(s2, 'PREQUEL'), edge(s3, 'SEQUEL')] } }))
    out.set(s3, raw(s3, { startDate: { year: 2003, month: 1, day: 1 }, relations: { edges: [edge(film, 'PREQUEL')] } }))
  }
  return out
}

function installApi() {
  const all = world()
  const counter = { requests: 0 }
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    counter.requests++
    const { query, variables } = JSON.parse(String(init.body)) as { query: string; variables: Record<string, unknown> }
    let data: unknown
    if (query.includes('recommendations(')) {
      const aliases = [...query.matchAll(/(m\d+): Media\(id: (\d+)/g)]
      expect(aliases.length).toBeLessThanOrEqual(9) // complexité AniList : 51 par alias, 500 au plus
      data = Object.fromEntries(aliases.map(([, alias, id]) => [alias, {
        id: Number(id),
        recommendations: { nodes: Array.from({ length: 10 }, (_, i) => ({ rating: 10 - i, mediaRecommendation: all.get(5000 + Number(id) + i)! })) },
      }]))
    } else if (variables.ids) {
      const media = (variables.ids as number[]).flatMap((id) => (all.has(id) ? [all.get(id)!] : []))
      data = { Page: { media } }
    } else if (variables.season) {
      data = { Page: { pageInfo: { hasNextPage: true }, media: [raw(9000)] } }
    } else if (variables.search) {
      data = { Page: { media: Array.from({ length: 20 }, (_, i) => all.get(6000 + i)!) } }
    } else {
      data = Object.fromEntries(Object.keys(variables).filter((k) => /^g\d$/.test(k)).map((k) => [k, { media: [raw(9100)] }]))
    }
    return new Response(JSON.stringify({ data }), { status: 200 })
  }))
  return counter
}

/** Un nouveau client (file vide) pour chaque scénario : chacun représente une minute à part. */
async function freshApp() {
  vi.resetModules()
  const [{ fetchSeasonPage, searchAnime }, { computeSuggestions }, { ensureData, refreshIfDue }] = await Promise.all([
    import('../api/media'), import('../domain/suggestions'), import('../domain/sync'),
  ])
  return { fetchSeasonPage, searchAnime, computeSuggestions, ensureData, refreshIfDue }
}

function hundredEntries(): Entry[] {
  const list: Entry[] = []
  for (let f = 0; f < FRANCHISES; f++) {
    for (const id of [1000 + f * 10, 1001 + f * 10]) {
      list.push({
        mediaId: id, franchiseId: id, status: 'COMPLETED', viewings: [{ number: 1, watched: [[1, 12]], startedAt: 0, endedAt: 0, state: 'completed' }], followed: true, score: 5, addedAt: 0, startedAt: 0, completedAt: 0, updatedAt: 0,
      })
    }
  }
  return list
}

describe('budget de requêtes avec 100 animes', () => {
  beforeEach(async () => {
    await Promise.all([db.entries.clear(), db.meta.clear(), cacheDb.media.clear(), cacheDb.franchises.clear(), cacheDb.kv.clear(), cacheDb.queries.clear()])
    await db.entries.bulkPut(hundredEntries())
  })
  afterAll(() => vi.unstubAllGlobals())

  it('cache vide : lancement, Pour toi et une page de Saisons tiennent sous les 25 requêtes', async () => {
    const api = installApi()
    const { computeSuggestions, ensureData, fetchSeasonPage, refreshIfDue } = await freshApp()
    await refreshIfDue()
    await ensureData()
    const afterBoot = api.requests
    await computeSuggestions()
    const afterForYou = api.requests
    await fetchSeasonPage('FALL', 2026, 1)
    // eslint-disable-next-line no-console
    console.info(`Requêtes : lancement ${afterBoot}, Pour toi ${afterForYou - afterBoot}, Saisons 1, total ${api.requests}`)
    expect(api.requests).toBeLessThanOrEqual(25)
    expect(await cacheDb.franchises.count()).toBe(FRANCHISES)
  }, 30_000)

  it('une recherche coûte au plus une requête par niveau de préquels, puis plus rien', async () => {
    const api = installApi()
    const { searchAnime } = await freshApp()
    await searchAnime('suites')
    const first = api.requests
    expect(first).toBeLessThanOrEqual(3) // recherche + 2 niveaux, pour 20 résultats
    await searchAnime('suites')
    expect(api.requests).toBe(first)
  }, 30_000)

  it('après un import (franchises absentes, fiches en cache) : pas une requête par franchise', async () => {
    const api = installApi()
    const { ensureData, refreshIfDue } = await freshApp()
    await refreshIfDue()
    await cacheDb.franchises.clear()
    const before = api.requests
    await ensureData()
    expect(api.requests - before).toBeLessThanOrEqual(5)
    expect(await cacheDb.franchises.count()).toBe(FRANCHISES)
  }, 30_000)

  it('recalcul après un changement de note : seulement les préquels des nouveaux candidats', async () => {
    const api = installApi()
    const { computeSuggestions } = await freshApp()
    await computeSuggestions()
    const before = api.requests
    await db.entries.update(1000, { score: 1 })
    await computeSuggestions()
    // Recommandations en cache ; une requête par niveau de préquels (ici 2) pour ce qui entre dans la présélection.
    expect(api.requests - before).toBeLessThanOrEqual(2)
  }, 30_000)
})
