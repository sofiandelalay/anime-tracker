import { DAY } from '../domain/types'
import { cacheDb, type CacheDB } from './cacheDb'
import { db, getMeta, setMeta, type TrackerDB } from './trackerDb'

export const CACHE_MAX_AGE = 30 * DAY
export const COVERS_CACHE = 'covers'

interface Deps {
  tracker: TrackerDB
  cache: CacheDB
}
const defaults = (): Deps => ({ tracker: db, cache: cacheDb })

/** Fiches et franchises nécessaires pour afficher ma liste hors ligne : jamais purgées. */
export async function protectedIds(deps: Deps = defaults()) {
  const entries = await deps.tracker.entries.toArray()
  const franchiseIds = new Set(entries.map((e) => e.franchiseId))
  const media = new Set(entries.map((e) => e.mediaId))
  const franchises = await deps.cache.franchises.bulkGet([...franchiseIds])
  for (const f of franchises) f?.mediaIds.forEach((id) => media.add(id))
  return { media, franchises: franchiseIds }
}

/** Purge automatique : tout ce qui a plus de 30 jours (hors fiches de ma liste). */
export async function purgeCache(now = Date.now(), deps: Deps = defaults()): Promise<number> {
  const limit = now - CACHE_MAX_AGE
  const keep = await protectedIds(deps)
  let removed = 0
  await deps.cache.transaction('rw', deps.cache.media, deps.cache.queries, deps.cache.franchises, async () => {
    removed += await deps.cache.media.where('fetchedAt').below(limit).filter((m) => !keep.media.has(m.id)).delete()
    removed += await deps.cache.queries.where('fetchedAt').below(limit).delete()
    removed += await deps.cache.franchises
      .where('computedAt').below(limit).filter((f) => !keep.franchises.has(f.id)).delete()
  })
  return removed
}

/** « Vider le cache » : recherches, fiches hors liste, jaquettes. Ne touche jamais à mes données. */
export async function clearCache(deps: Deps = defaults()): Promise<void> {
  const keep = await protectedIds(deps)
  await deps.cache.transaction('rw', deps.cache.media, deps.cache.queries, deps.cache.franchises, async () => {
    await deps.cache.queries.clear()
    await deps.cache.media.filter((m) => !keep.media.has(m.id)).delete()
    await deps.cache.franchises.filter((f) => !keep.franchises.has(f.id)).delete()
  })
  if (typeof caches !== 'undefined') await caches.delete(COVERS_CACHE)
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  if (!navigator.storage?.estimate) return null
  const { usage = 0, quota = 0 } = await navigator.storage.estimate()
  return { usage, quota }
}

/** Demande un stockage persistant au premier lancement. */
export async function requestPersistence(): Promise<void> {
  if (await getMeta<boolean>('persistAsked')) return
  if (navigator.storage?.persist) {
    const granted = await navigator.storage.persist().catch(() => false)
    await setMeta('persistGranted', granted)
  }
  await setMeta('persistAsked', true)
}
