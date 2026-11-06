import { fetchMediaByIds } from '../api/media'
import { cacheDb } from '../db/cacheDb'
import { purgeCache, requestPersistence } from '../db/maintenance'
import { db, getMeta, setMeta } from '../db/trackerDb'
import { attachSeasons, computeFranchise } from './actions'
import { compareByStart } from './format'
import { preloadChains } from './franchise'
import { HOUR, type Entry, type Media } from './types'

export const REFRESH_INTERVAL = 12 * HOUR

/** Complète ce qui manque (fiches ou franchises absentes, ex. après « Vider le cache »). */
/** Rattache sans réseau les saisons déjà connues du cache à mes animes (migration, puis à chaque lancement). */
export async function attachKnownSeasons(): Promise<void> {
  const entries = await db.entries.toArray()
  const franchises = await cacheDb.franchises.where('mediaIds').anyOf(entries.map((e) => e.mediaId)).toArray()
  const done = new Set<number>()
  for (const f of franchises) {
    if (done.has(f.id)) continue
    done.add(f.id)
    const stale = entries.filter((e) => f.mediaIds.includes(e.mediaId) && e.franchiseId !== f.id).map((e) => e.mediaId)
    if (stale.length > 0) await db.entries.where('mediaId').anyOf(stale).modify({ franchiseId: f.id })
    await attachSeasons(f.id, f.mediaIds)
  }
}

export async function ensureData(): Promise<void> {
  await attachKnownSeasons()
  const entries = await db.entries.toArray()
  if (entries.length === 0) return
  const cached = await cacheDb.media.bulkGet(entries.map((e) => e.mediaId))
  const missing = entries.filter((_, i) => !cached[i]).map((e) => e.mediaId)
  const media = new Map<number, Media>(cached.filter((m): m is Media => !!m).map((m) => [m.id, m]))
  if (missing.length > 0) {
    for (const [id, m] of await fetchMediaByIds(missing)) media.set(id, m)
  }

  // Beaucoup de franchises à calculer (ex. après un import) : on charge les chaînes par lots d'abord.
  const known = await cacheDb.franchises.where('mediaIds').anyOf(entries.map((e) => e.mediaId)).toArray()
  const covered = new Set(known.flatMap((f) => f.mediaIds))
  const todo = entries.filter((e) => !covered.has(e.mediaId)).map((e) => media.get(e.mediaId)).filter((m): m is Media => !!m)
  if (todo.length > 0) await preloadChains(todo, (ids) => fetchMediaByIds(ids))

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
  const watchedGroups: Entry[][] = []
  for (const group of groups.values()) {
    // Une franchise Abandonnée ne revient pas : inutile d'y chercher une nouvelle saison.
    if (group.some((e) => e.status === 'DROPPED')) continue
    watchedGroups.push(group)
    const known = group.map((e) => cached.get(e.mediaId)).filter((m): m is Media => !!m).sort(compareByStart)
    // Seules bougent les saisons pas finies et la dernière connue (c'est elle qui annonce une suite).
    const tip = known[known.length - 1]
    if (tip) ids.add(tip.id)
    for (const e of group) {
      const m = cached.get(e.mediaId)
      if (!m || m.status !== 'FINISHED') ids.add(e.mediaId)
    }
  }

  const fresh = await fetchMediaByIds([...ids], { force: true })
  await preloadChains(
    watchedGroups.flat().map((e) => fresh.get(e.mediaId) ?? cached.get(e.mediaId)).filter((m): m is Media => !!m),
    (list) => fetchMediaByIds(list),
  )
  for (const group of watchedGroups) {
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

const AIRED_CHECK_INTERVAL = 15 * 60_000
let lastAiredCheck = 0

/**
 * Un épisode suivi vient de sortir (compte à rebours écoulé) : on rafraîchit ces fiches, par lots,
 * pour pouvoir le cocher tout de suite. Au plus une fois toutes les 15 min.
 */
export async function refreshAired(now = Date.now()): Promise<void> {
  if (now - lastAiredCheck < AIRED_CHECK_INTERVAL) return
  const entries = await db.entries.where('status').anyOf('CURRENT', 'PLANNING').toArray()
  const cached = await cacheDb.media.bulkGet(entries.map((e) => e.mediaId))
  const ids = cached
    .filter((m): m is Media => !!m?.nextAiring && m.nextAiring.airingAt * 1000 <= now)
    .map((m) => m.id)
  if (ids.length === 0) return
  lastAiredCheck = now
  await fetchMediaByIds(ids, { force: true })
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
  await attachKnownSeasons().catch(() => undefined)
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return
  await refreshIfDue().catch(() => undefined)
  await ensureData().catch(() => undefined)
  await refreshAired().catch(() => undefined)
}
