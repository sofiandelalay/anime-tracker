import type { Entry, LogItem, WatchStatus } from '../domain/types'
import { db, setMeta } from './trackerDb'

export interface Backup {
  app: 'anime-tracker'
  version: 1
  exportedAt: number
  entries: Entry[]
  log: Omit<LogItem, 'id'>[]
}

const STATUSES: WatchStatus[] = ['PLANNING', 'CURRENT', 'COMPLETED', 'DROPPED']

export async function exportData(now = Date.now()): Promise<Backup> {
  const [entries, log] = await Promise.all([db.entries.toArray(), db.log.toArray()])
  return {
    app: 'anime-tracker',
    version: 1,
    exportedAt: now,
    entries,
    log: log.map(({ mediaId, episode, at }) => ({ mediaId, episode, at })),
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
  const b = data as Partial<Backup>
  if (b?.app !== 'anime-tracker' || b.version !== 1 || !Array.isArray(b.entries) || !Array.isArray(b.log)) {
    throw new Error('Ce fichier ne vient pas de cette appli.')
  }
  for (const e of b.entries) {
    const ok = isNum(e.mediaId) && isNum(e.franchiseId) && STATUSES.includes(e.status) && isNum(e.progress) &&
      isNumOrNull(e.score) && isNum(e.addedAt) && isNumOrNull(e.startedAt) && isNumOrNull(e.completedAt) && isNum(e.updatedAt)
    if (!ok) throw new Error('Une entrée du fichier est invalide.')
  }
  for (const l of b.log) {
    if (!isNum(l.mediaId) || !isNum(l.episode) || !isNum(l.at)) throw new Error('Le journal du fichier est invalide.')
  }
  return b as Backup
}

/** Remplace mes données par celles du fichier. */
export async function importData(b: Backup): Promise<void> {
  await db.transaction('rw', db.entries, db.log, async () => {
    await db.entries.clear()
    await db.log.clear()
    await db.entries.bulkPut(b.entries)
    await db.log.bulkAdd(b.log.map(({ mediaId, episode, at }) => ({ mediaId, episode, at })))
  })
}
