import { fetchMediaByIds } from '../api/media'
import { cacheDb } from '../db/cacheDb'
import { purgeCache, requestPersistence } from '../db/maintenance'
import { db, getMeta, setMeta } from '../db/trackerDb'
import { computeFranchise } from './actions'
import { compareByStart } from './format'
import { HOUR, type Entry, type Media } from './types'

export const REFRESH_INTERVAL = 12 * HOUR

/** Complète ce qui manque (fiches ou franchises absentes, ex. après « Vider le cache »). */
export async function ensureData(): Promise<void> {
  const entries = await db.entries.toArray()
  if (entries.length === 0) return
  const cached = await cacheDb.media.bulkGet(entries.map((e) => e.mediaId))
  const missing = entries.filter((_, i) => !cached[i]).map((e) => e.mediaId)
  const media = new Map<number, Media>(cached.filter((m): m is Media => !!m).map((m) => [m.id, m]))
  if (missing.length > 0) {
    for (const [id, m] of await fetchMediaByIds(missing)) media.set(id, m)
  }

  // Franchise absente du cache → recalcul ; identifiant divergent → réalignement.
  const done = new Set<number>()
  for (const e of entries) {
    if (done.has(e.mediaId)) continue
    done.add(e.mediaId)
    const f = await cacheDb.franchises.where('mediaIds').equals(e.mediaId).first()
    if (f) {
      f.mediaIds.forEach((id) => done.add(id))
      if (e.franchiseId !== f.id) {
        await db.entries.where('mediaId').anyOf(f.mediaIds).modify({ franchiseId: f.id })
      }
      continue
    }
    const m = media.get(e.mediaId)
    if (m) await computeFranchise(m).catch(() => undefined)
  }
}

/**
 * Rafraîchissement au lancement (au plus toutes les 12 h), par lots de 50 :
 * - fiches suivies pas encore terminées de diffusion ;
 * - franchises entièrement terminées (pour détecter une nouvelle saison).
 */
export async function refreshIfDue(now = Date.now()): Promise<boolean> {
  const last = await getMeta<number>('lastRefreshAt')
  if (last && now - last < REFRESH_INTERVAL) return false

  const entries = await db.entries.toArray()
  const groups = new Map<number, Entry[]>()
  for (const e of entries) groups.set(e.franchiseId, [...(groups.get(e.franchiseId) ?? []), e])
  const cached = new Map(
    (await cacheDb.media.bulkGet(entries.map((e) => e.mediaId)))
      .filter((m): m is Media => !!m)
      .map((m) => [m.id, m]),
  )

  const ids = new Set<number>()
  const completedFranchises: Entry[][] = []
  for (const group of groups.values()) {
    if (group.some((e) => e.status === 'DROPPED')) continue
    if (group.every((e) => e.status === 'COMPLETED')) {
      completedFranchises.push(group)
      group.forEach((e) => ids.add(e.mediaId))
    } else {
      for (const e of group) {
        const m = cached.get(e.mediaId)
        if (!m || m.status !== 'FINISHED') ids.add(e.mediaId)
      }
    }
  }

  const fresh = await fetchMediaByIds([...ids], { force: true })
  for (const group of completedFranchises) {
    const latest = group
      .map((e) => fresh.get(e.mediaId) ?? cached.get(e.mediaId))
      .filter((m): m is Media => !!m)
      .sort(compareByStart)
      .pop()
    if (latest) await computeFranchise(latest).catch(() => undefined)
  }
  await setMeta('lastRefreshAt', now)
  return true
}

let booting: Promise<void> | null = null

/** Séquence de lancement (une seule fois). Ne lève jamais : l'appli doit marcher hors ligne. */
export function boot(): Promise<void> {
  booting ??= runBoot()
  return booting
}

async function runBoot(): Promise<void> {
  await requestPersistence().catch(() => undefined)
  await purgeCache().catch(() => undefined)
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return
  await refreshIfDue().catch(() => undefined)
  await ensureData().catch(() => undefined)
}
