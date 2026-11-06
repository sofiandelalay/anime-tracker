import { cacheDb, type CacheDB } from '../db/cacheDb'
import { DAY, HOUR, type Media } from '../domain/types'
import { cleanSynopsis } from '../domain/format'
import { countsForProgress, findDerivedRows, preloadChains, resolveRoots, summarizeChain, type ChainSummary, type RootInfo } from '../domain/franchise'
import { AniListError, anilist, type AniListClient } from './client'
import {
  discoveryQuery, MEDIA_BY_IDS, parseRecommendations, recommendationsQuery, SEARCH, SEASON_PAGE, SYNOPSIS, toMedia,
  type PageResponse, type RawMedia, type RawRecommendations, type RecItem,
} from './queries'

export const MEDIA_TTL = 12 * HOUR
export const SEARCH_TTL = 1 * HOUR
export const SEASON_TTL = 6 * HOUR
export const SUGGESTION_SOURCE_TTL = 24 * HOUR
export const ROOT_MAX_AGE = 30 * DAY
export const BATCH_SIZE = 50
export const SEASON_PAGE_SIZE = 50
/** 8 alias × 51 = 408, sous la complexité maximale d'AniList (500). */
export const RECOMMENDATION_BATCH = 8
const SYNOPSIS_MAX_CHARS = 1200

export interface ApiDeps {
  client: AniListClient
  cache: CacheDB
  now: () => number
}

const defaults = (): ApiDeps => ({ client: anilist, cache: cacheDb, now: Date.now })

/**
 * Récupère des fiches en lot (id_in, pages de 50) en s'appuyant sur le cache (12 h).
 * En cas d'erreur réseau, renvoie ce qui est en cache même périmé.
 */
export async function fetchMediaByIds(
  ids: number[],
  opts: { force?: boolean; maxAge?: number } = {},
  deps: ApiDeps = defaults(),
): Promise<Map<number, Media>> {
  const unique = [...new Set(ids)]
  const out = new Map<number, Media>()
  const cached = await deps.cache.media.bulkGet(unique)
  const now = deps.now()
  const stale: number[] = []
  unique.forEach((id, i) => {
    const m = cached[i]
    if (m) out.set(id, m)
    if (opts.force || !m || now - m.fetchedAt > (opts.maxAge ?? MEDIA_TTL)) stale.push(id)
  })

  try {
    for (let i = 0; i < stale.length; i += BATCH_SIZE) {
      const chunk = stale.slice(i, i + BATCH_SIZE)
      const data = await deps.client.request<PageResponse>(MEDIA_BY_IDS, { ids: chunk, perPage: BATCH_SIZE })
      const fetchedAt = deps.now()
      const fresh = data.Page.media.map((r) => toMedia(r, fetchedAt)).filter((m): m is Media => m !== null)
      await deps.cache.media.bulkPut(fresh)
      for (const m of fresh) out.set(m.id, m)
    }
  } catch (err) {
    if (out.size === 0 && unique.length > 0) throw err
  }
  return out
}

export async function fetchMedia(id: number, deps: ApiDeps = defaults()): Promise<Media | undefined> {
  return (await fetchMediaByIds([id], {}, deps)).get(id)
}

/** L'anime « global » de chaque fiche. Les liens entre saisons ne changent presque jamais : le cache reste valable 30 j. */
export function fetchRoots(list: Media[], deps: ApiDeps = defaults()): Promise<Map<number, RootInfo>> {
  return resolveRoots(list, (ids) => fetchMediaByIds(ids, { maxAge: ROOT_MAX_AGE }, deps))
}

/** Saisons et épisodes au total de chaque anime : une requête par niveau pour tous, jamais une par anime. */
export async function fetchChainSummaries(
  list: Media[],
  shouldStop?: () => boolean,
  deps: ApiDeps = defaults(),
): Promise<Map<number, ChainSummary>> {
  const known = await preloadChains(list, (ids) => fetchMediaByIds(ids, { maxAge: ROOT_MAX_AGE }, deps), shouldStop)
  return new Map(list.map((m) => [m.id, summarizeChain(m, known)]))
}

/**
 * Recherche (cache 1 h) : une ligne par anime, représenté par sa première saison.
 * Film, OVA et spécial gardent leur propre ligne : c'est le seul moyen de les ajouter.
 * Un dérivé disparaît si son anime principal est aussi dans les résultats.
 */
export async function searchAnime(query: string, deps: ApiDeps = defaults()): Promise<Media[]> {
  const key = `search:${query.trim().toLowerCase().replace(/\s+/g, ' ')}`
  const hit = await deps.cache.queries.get(key)
  if (hit && deps.now() - hit.fetchedAt <= SEARCH_TTL) return hit.results

  const data = await deps.client.request<PageResponse>(SEARCH, { search: query.trim() })
  const fetchedAt = deps.now()
  const found = data.Page.media.map((r) => toMedia(r, fetchedAt)).filter((m): m is Media => m !== null)
  let roots: Map<number, RootInfo>
  let derived: Set<number>
  try {
    roots = await fetchRoots(found, deps)
    derived = await findDerivedRows(found, roots, (ids) => fetchMediaByIds(ids, { maxAge: ROOT_MAX_AGE }, deps))
  } catch {
    // Remontée impossible : on montre les saisons trouvées, sans mettre ce résultat incomplet en cache.
    return found
  }
  const byId = new Map<number, Media>()
  for (const m of found) {
    const shown = countsForProgress(m) ? roots.get(m.id)!.root : m
    if (!byId.has(shown.id)) byId.set(shown.id, shown)
  }
  const results = [...byId.values()].filter((m) => !derived.has(m.id))
  await deps.cache.queries.put({ key, results, fetchedAt })
  return results
}

/** Garde une fiche déjà reçue (ouverture de la feuille) sans écraser une version plus récente. */
export async function rememberMedia(media: Media, deps: ApiDeps = defaults()): Promise<void> {
  const existing = await deps.cache.media.get(media.id)
  if (!existing || existing.fetchedAt < media.fetchedAt) await deps.cache.media.put(media)
}

export interface SeasonPage {
  media: Media[]
  hasNext: boolean
}

/** Une page d'une saison (cache 6 h ; hors ligne, sert le cache même périmé). */
export async function fetchSeasonPage(season: string, year: number, page: number, deps: ApiDeps = defaults()): Promise<SeasonPage> {
  const key = `season:${season}:${year}:${page}`
  const hit = await deps.cache.queries.get(key)
  if (hit && deps.now() - hit.fetchedAt <= SEASON_TTL) return { media: hit.results, hasNext: !!hit.hasNext }
  try {
    const data = await deps.client.request<PageResponse>(SEASON_PAGE, { season, year, page, perPage: SEASON_PAGE_SIZE })
    const fetchedAt = deps.now()
    const results = data.Page.media.map((r) => toMedia(r, fetchedAt)).filter((m): m is Media => m !== null)
    const hasNext = !!data.Page.pageInfo?.hasNextPage
    await deps.cache.queries.put({ key, results, fetchedAt, hasNext })
    return { media: results, hasNext }
  } catch (err) {
    if (hit) return { media: hit.results, hasNext: !!hit.hasNext }
    throw err
  }
}

/** Synopsis court, sans balises, chargé seulement à l'ouverture d'une fiche non suivie. */
export async function fetchSynopsis(id: number, deps: ApiDeps = defaults()): Promise<string> {
  const key = `synopsis:${id}`
  const hit = await deps.cache.kv.get(key)
  if (hit) return hit.value as string
  const data = await deps.client.request<{ Media: { description: string | null } }>(SYNOPSIS, { id })
  const text = cleanSynopsis(data.Media.description, SYNOPSIS_MAX_CHARS)
  await deps.cache.kv.put({ key, value: text, fetchedAt: deps.now() })
  return text
}

/** Récupère un lot ; un id disparu fait échouer tout le lot (404), on coupe alors en deux. */
async function fetchRecommendationChunk(ids: number[], deps: ApiDeps): Promise<Map<number, RecItem[]>> {
  try {
    const data = await deps.client.request<Record<string, RawRecommendations | null>>(recommendationsQuery(ids))
    return parseRecommendations(data, deps.now())
  } catch (err) {
    if (!(err instanceof AniListError) || err.status !== 404) throw err
    if (ids.length === 1) return new Map([[ids[0]!, []]])
    const mid = Math.ceil(ids.length / 2)
    const left = await fetchRecommendationChunk(ids.slice(0, mid), deps)
    const right = await fetchRecommendationChunk(ids.slice(mid), deps)
    return new Map([...left, ...right])
  }
}

/**
 * Recommandations de plusieurs animes (alias GraphQL, lots de 8), cache 24 h par anime source :
 * changer une note ne redemande que les animes nouvellement aimés.
 */
export async function fetchRecommendations(
  ids: number[],
  opts: { force?: boolean } = {},
  deps: ApiDeps = defaults(),
): Promise<Map<number, RecItem[]>> {
  const unique = [...new Set(ids)]
  const out = new Map<number, RecItem[]>()
  const cached = await deps.cache.kv.bulkGet(unique.map((id) => `recs:${id}`))
  const now = deps.now()
  const stale: number[] = []
  unique.forEach((id, i) => {
    const hit = cached[i]
    if (hit) out.set(id, hit.value as RecItem[])
    if (opts.force || !hit || now - hit.fetchedAt > SUGGESTION_SOURCE_TTL) stale.push(id)
  })
  try {
    for (let i = 0; i < stale.length; i += RECOMMENDATION_BATCH) {
      const chunk = stale.slice(i, i + RECOMMENDATION_BATCH)
      const fresh = await fetchRecommendationChunk(chunk, deps)
      const fetchedAt = deps.now()
      await deps.cache.kv.bulkPut([...fresh].map(([id, value]) => ({ key: `recs:${id}`, value, fetchedAt })))
      for (const [id, items] of fresh) out.set(id, items)
    }
  } catch (err) {
    // Pas de calcul sur des données trouées : on n'accepte que du cache périmé, pas des absents.
    if (unique.some((id) => !out.has(id))) throw err
  }
  return out
}

/** Animes populaires des 3 dernières années dans mes genres préférés (une requête, cache 24 h). */
export async function fetchDiscovery(
  genres: string[],
  opts: { force?: boolean } = {},
  deps: ApiDeps = defaults(),
): Promise<Media[]> {
  if (genres.length === 0) return []
  const key = `discover:${[...genres].sort().join(',')}`
  const hit = await deps.cache.queries.get(key)
  const now = deps.now()
  if (hit && !opts.force && now - hit.fetchedAt <= SUGGESTION_SOURCE_TTL) return hit.results
  const d = new Date(now)
  const since = (d.getFullYear() - 3) * 10000 + (d.getMonth() + 1) * 100 + d.getDate()
  const variables: Record<string, unknown> = { since }
  genres.forEach((g, i) => (variables[`g${i}`] = g))
  try {
    const data = await deps.client.request<Record<string, { media: RawMedia[] }>>(discoveryQuery(genres.length), variables)
    const byId = new Map<number, Media>()
    for (const page of Object.values(data)) {
      for (const r of page.media) {
        const m = toMedia(r, now)
        if (m) byId.set(m.id, m)
      }
    }
    const results = [...byId.values()]
    await deps.cache.queries.put({ key, results, fetchedAt: now })
    return results
  } catch (err) {
    if (hit) return hit.results
    throw err
  }
}
