import Dexie, { type Table } from 'dexie'
import type { Entry, LogItem } from '../domain/types'

export interface MetaItem {
  key: string
  value: unknown
}

/** Mes données : entrées de suivi, journal des épisodes, réglages. */
export class TrackerDB extends Dexie {
  entries!: Table<Entry, number>
  log!: Table<LogItem, number>
  meta!: Table<MetaItem, string>

  constructor(name = 'anime-tracker') {
    super(name)
    this.version(1).stores({
      entries: 'mediaId, franchiseId, status, updatedAt',
      log: '++id, mediaId, at',
      meta: 'key',
    })
  }
}

export const db = new TrackerDB()

export async function getMeta<T>(key: string): Promise<T | undefined> {
  return (await db.meta.get(key))?.value as T | undefined
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value })
}
