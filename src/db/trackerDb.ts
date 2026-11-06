import Dexie, { type Table } from 'dexie'
import { legacyViewings } from '../domain/viewings'
import type { Entry, EpisodeRanges, LogItem } from '../domain/types'

export interface MetaItem {
  key: string
  value: unknown
}

/** Anime masqué par « Pas pour moi » (définitif, donc dans mes données et l'export). */
export interface HiddenItem {
  mediaId: number
  at: number
}

/** Mes données : entrées de suivi, journal des épisodes, animes masqués, réglages. */
export class TrackerDB extends Dexie {
  entries!: Table<Entry, number>
  log!: Table<LogItem, number>
  meta!: Table<MetaItem, string>
  hidden!: Table<HiddenItem, number>

  constructor(name = 'anime-tracker') {
    super(name)
    this.version(1).stores({
      entries: 'mediaId, franchiseId, status, updatedAt',
      log: '++id, mediaId, at',
      meta: 'key',
    })
    this.version(2).stores({ hidden: 'mediaId' })
    // Compteur → ensemble d'épisodes : N épisodes vus deviennent les épisodes 1 à N. Tout est suivi.
    // Les saisons manquantes des franchises sont rattachées ensuite, au lancement (attachKnownSeasons, ensureData).
    this.version(3).stores({}).upgrade((tx) =>
      tx.table('entries').toCollection().modify((e: Entry & { progress?: number; watched?: EpisodeRanges }) => {
        const n = Math.max(0, Math.floor(e.progress ?? 0))
        e.watched = n > 0 ? [[1, n]] : []
        e.followed = true
        delete e.progress
      }),
    )
    // Les coches en lot n'ont pas de vraie date : elles passent en date inconnue.
    this.version(4).stores({}).upgrade((tx) =>
      tx.table('log').toCollection().modify((l: LogItem & { bulk?: boolean }) => {
        if (l.bulk) l.at = null
        delete l.bulk
      }),
    )
    // Les cases actuelles deviennent le visionnage 1. Une saison cochée uniquement en lot garde une date inconnue.
    this.version(5).stores({}).upgrade(async (tx) => {
      const log = await tx.table<LogItem>('log').toArray()
      const dated = new Set(log.filter((l) => l.at !== null).map((l) => l.mediaId))
      const undated = new Set(log.filter((l) => l.at === null).map((l) => l.mediaId))
      await tx.table('entries').toCollection().modify((e: Entry & { watched?: EpisodeRanges }) => {
        e.viewings = legacyViewings(e, e.watched ?? [], dated.has(e.mediaId) || !undated.has(e.mediaId))
        delete e.watched
      })
      await tx.table('log').toCollection().modify({ viewing: 1 })
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
