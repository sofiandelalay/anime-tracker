import { cacheDb, type CacheDB } from '../db/cacheDb'
import { HOUR, type Media } from '../domain/types'
import { anilist, type AniListClient } from './client'
import { MEDIA_BY_IDS, SEARCH, toMedia, type PageResponse } from './queries'

export const MEDIA_TTL = 12 * HOUR
export const SEARCH_TTL = 1 * HOUR
export const BATCH_SIZE = 50

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
  opts: { force?: boolean } = {},
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
    if (opts.force || !m || now - m.fetchedAt > MEDIA_TTL) stale.push(id)
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

/** Recherche (cache 1 h). Les fiches trouvées ne sont pas stockées tant qu'on ne les ajoute pas. */
export async function searchAnime(query: string, deps: ApiDeps = defaults()): Promise<Media[]> {
  const key = `search:${query.trim().toLowerCase().replace(/\s+/g, ' ')}`
  const hit = await deps.cache.queries.get(key)
  if (hit && deps.now() - hit.fetchedAt <= SEARCH_TTL) return hit.results

  const data = await deps.client.request<PageResponse>(SEARCH, { search: query.trim() })
  const fetchedAt = deps.now()
  const results = data.Page.media.map((r) => toMedia(r, fetchedAt)).filter((m): m is Media => m !== null)
  await deps.cache.queries.put({ key, results, fetchedAt })
  return results
}
