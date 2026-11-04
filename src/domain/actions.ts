import { fetchMediaByIds } from '../api/media'
import { cacheDb } from '../db/cacheDb'
import { db } from '../db/trackerDb'
import { buildFranchise, nextInFranchise } from './franchise'
import { applyProgress } from './progress'
import type { Entry, Media, WatchStatus } from './types'

export type Undo = () => Promise<void>

/** Photographie les entrées et le journal d'une franchise pour pouvoir annuler. */
async function snapshot(franchiseId: number): Promise<Undo> {
  const entries = await db.entries.where('franchiseId').equals(franchiseId).toArray()
  const ids = entries.map((e) => e.mediaId)
  const log = await db.log.where('mediaId').anyOf(ids).toArray()
  return () =>
    db.transaction('rw', db.entries, db.log, async () => {
      const nowIds = await db.entries.where('franchiseId').equals(franchiseId).primaryKeys()
      await db.entries.bulkDelete(nowIds)
      await db.entries.bulkPut(entries)
      await db.log.where('mediaId').anyOf([...ids, ...nowIds]).delete()
      await db.log.bulkPut(log)
    })
}

/** Calcule (ou recalcule) la franchise d'une fiche, la met en cache et réaligne mes entrées. */
export async function computeFranchise(media: Media): Promise<number> {
  const result = await buildFranchise(media, (ids) => fetchMediaByIds(ids))
  const members = result.mediaIds.length > 0 ? result.mediaIds : [media.id]
  await cacheDb.transaction('rw', cacheDb.franchises, async () => {
    // Supprime les anciennes versions qui partageaient une saison avec celle-ci.
    await cacheDb.franchises.where('mediaIds').anyOf(members).filter((f) => f.id !== result.id).delete()
    await cacheDb.franchises.put({ id: result.id, mediaIds: result.mediaIds, computedAt: Date.now() })
  })
  await db.entries
    .where('mediaId').anyOf(members)
    .filter((e) => e.franchiseId !== result.id)
    .modify({ franchiseId: result.id })
  return result.id
}

/** Ajoute un anime : « À voir », ou « En cours » si je l'ai déjà commencé. */
export async function addAnime(media: Media, alreadyWatched = 0): Promise<void> {
  if (await db.entries.get(media.id)) return
  await cacheDb.media.put(media)
  let franchiseId = media.id
  try {
    franchiseId = await computeFranchise(media)
  } catch {
    // Hors ligne : la franchise sera recalculée plus tard (ensureData).
  }
  const now = Date.now()
  let entry: Entry = {
    mediaId: media.id,
    franchiseId,
    status: 'PLANNING',
    progress: 0,
    score: null,
    addedAt: now,
    startedAt: null,
    completedAt: null,
    updatedAt: now,
  }
  if (alreadyWatched > 0) entry = applyProgress(entry, media, alreadyWatched, now).entry
  await db.entries.put(entry)
}

export interface ProgressOutcome {
  mediaId: number
  changed: boolean
  completed: boolean
  /** Saison suivante à proposer (pas encore dans ma liste). */
  nextSeasonId: number | null
  undo: Undo
}

/** Change le nombre d'épisodes vus (journalise chaque épisode coché). */
export async function setProgress(mediaId: number, target: (current: number) => number): Promise<ProgressOutcome> {
  const media = await cacheDb.media.get(mediaId)
  const existing = await db.entries.get(mediaId)
  if (!media || !existing) throw new Error('Anime introuvable')
  const undo = await snapshot(existing.franchiseId)

  const result = await db.transaction('rw', db.entries, db.log, async () => {
    const entry = (await db.entries.get(mediaId))!
    const now = Date.now()
    const res = applyProgress(entry, media, target(entry.progress), now)
    if (res.entry.progress === entry.progress && res.entry.status === entry.status) return null
    await db.entries.put(res.entry)
    if (res.entry.progress > entry.progress) {
      const items = []
      for (let ep = entry.progress + 1; ep <= res.entry.progress; ep++) items.push({ mediaId, episode: ep, at: now })
      await db.log.bulkAdd(items)
    } else {
      await db.log.where('mediaId').equals(mediaId).filter((l) => l.episode > res.entry.progress).delete()
    }
    return res
  })

  let nextSeasonId: number | null = null
  if (result?.completed) {
    const franchise = await cacheDb.franchises.get(existing.franchiseId)
    const next = franchise ? nextInFranchise(franchise.mediaIds, mediaId) : null
    if (next !== null && !(await db.entries.get(next))) nextSeasonId = next
  }
  return { mediaId, changed: result !== null, completed: !!result?.completed, nextSeasonId, undo }
}

export const incrementEpisode = (mediaId: number) => setProgress(mediaId, (p) => p + 1)

export async function setStatus(mediaId: number, status: WatchStatus): Promise<Undo> {
  const entry = await db.entries.get(mediaId)
  if (!entry || entry.status === status) return async () => {}
  const media = await cacheDb.media.get(mediaId)
  const undo = await snapshot(entry.franchiseId)
  const now = Date.now()
  const next: Entry = { ...entry, status, updatedAt: now }
  if (status === 'COMPLETED') {
    next.completedAt = now
    if (media?.episodes) next.progress = Math.max(entry.progress, media.episodes)
    next.startedAt ??= now
  } else {
    next.completedAt = null
  }
  if (status === 'CURRENT') next.startedAt ??= now
  await db.entries.put(next)
  return undo
}

export async function setScore(mediaId: number, score: number | null): Promise<void> {
  const s = score === null ? null : Math.min(5, Math.max(0.5, Math.round(score * 2) / 2))
  await db.entries.update(mediaId, { score: s, updatedAt: Date.now() })
}

/** Archiver = passer en Abandonné toutes les saisons à suivre de la franchise. */
export async function archiveFranchise(franchiseId: number): Promise<Undo> {
  const undo = await snapshot(franchiseId)
  const now = Date.now()
  await db.entries
    .where('franchiseId').equals(franchiseId)
    .filter((e) => e.status === 'CURRENT' || e.status === 'PLANNING')
    .modify({ status: 'DROPPED', updatedAt: now })
  return undo
}
