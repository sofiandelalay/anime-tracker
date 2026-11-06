import { isEpisodeRanges, rangeOf } from '../domain/episodes'
import { isViewing, legacyViewings } from '../domain/viewings'
import type { Entry, EpisodeRanges, LogItem, WatchStatus } from '../domain/types'
import { db, setMeta, type HiddenItem } from './trackerDb'

export interface Backup {
  app: 'anime-tracker'
  version: 3
  exportedAt: number
  entries: Entry[]
  log: Omit<LogItem, 'id'>[]
  /** Absent des exports plus anciens. */
  hidden?: HiddenItem[]
}

const STATUSES: WatchStatus[] = ['PLANNING', 'CURRENT', 'COMPLETED', 'DROPPED']

export async function exportData(now = Date.now()): Promise<Backup> {
  const [entries, log, hidden] = await Promise.all([db.entries.toArray(), db.log.toArray(), db.hidden.toArray()])
  return {
    app: 'anime-tracker',
    version: 3,
    exportedAt: now,
    entries,
    log: log.map(({ id: _id, ...item }) => item),
    hidden,
  }
}

export async function markExported(at: number): Promise<void> {
  await setMeta('lastExportAt', at)
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isNumOrNull = (v: unknown) => v === null || isNum(v)

/** Vérifie un fichier d'export ; lève une erreur lisible s'il est invalide. */
export function parseBackup(text: string): Backup {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('Ce fichier n’est pas un JSON valide.')
  }
  type OldEntry = Entry & { progress?: number; watched?: EpisodeRanges }
  const b = data as Omit<Partial<Backup>, 'version' | 'entries'> & { version?: number; entries?: OldEntry[] }
  if (b?.app !== 'anime-tracker' || ![1, 2, 3].includes(b.version ?? 0) || !Array.isArray(b.entries) || !Array.isArray(b.log)) {
    throw new Error('Ce fichier ne vient pas de cette appli.')
  }
  // Anciens exports : v1, un compteur d'épisodes et tout suivi ; v2, un seul ensemble de cases.
  const entries = b.entries.map((e): Entry => {
    if (b.version === 3) return e
    const { progress, watched, ...rest } = e
    const ranges = b.version === 1 ? (isNum(progress) ? rangeOf(1, Math.floor(progress)) : (null as never)) : watched
    if (!isEpisodeRanges(ranges)) throw new Error('Une entrée du fichier est invalide.')
    return { ...rest, followed: b.version === 1 ? true : rest.followed, viewings: legacyViewings(rest, ranges, true) }
  })
  for (const e of entries) {
    const ok = isNum(e.mediaId) && isNum(e.franchiseId) && STATUSES.includes(e.status) && Array.isArray(e.viewings) && e.viewings.every((v) => isViewing(v, isEpisodeRanges)) && typeof e.followed === 'boolean' &&
      isNumOrNull(e.score) && isNum(e.addedAt) && isNumOrNull(e.startedAt) && isNumOrNull(e.completedAt) && isNum(e.updatedAt)
    if (!ok) throw new Error('Une entrée du fichier est invalide.')
  }
  for (const l of b.log) {
    if (!isNum(l.mediaId) || !isNum(l.episode) || !isNumOrNull(l.at)) throw new Error('Le journal du fichier est invalide.')
  }
  if (b.hidden !== undefined) {
    if (!Array.isArray(b.hidden) || !b.hidden.every((h) => isNum(h?.mediaId) && isNum(h?.at))) {
      throw new Error('La liste des animes masqués du fichier est invalide.')
    }
  }
  // Exports précédents : les coches en lot étaient marquées `bulk`.
  const log = (b.log as (Omit<LogItem, 'id' | 'viewing'> & { bulk?: boolean; viewing?: number })[]).map(({ mediaId, episode, at, bulk, viewing }) => ({ mediaId, episode, at: bulk ? null : at, viewing: viewing ?? 1 }))
  return { ...b, version: 3, entries, log } as Backup
}

/** Remplace mes données par celles du fichier. */
export async function importData(b: Backup): Promise<void> {
  await db.transaction('rw', db.entries, db.log, db.hidden, async () => {
    await db.entries.clear()
    await db.log.clear()
    await db.entries.bulkPut(b.entries)
    await db.log.bulkAdd(b.log.map(({ mediaId, episode, at, viewing }) => ({ mediaId, episode, at, viewing })))
    // Un ancien export ne connaît pas les masqués : on garde les miens.
    if (b.hidden) {
      await db.hidden.clear()
      await db.hidden.bulkPut(b.hidden)
    }
  })
}
