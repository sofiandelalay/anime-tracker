import Dexie, { type Table } from 'dexie'
import type { Franchise, Media } from '../domain/types'

export interface CachedQuery {
  key: string
  results: Media[]
  fetchedAt: number
}

/**
 * Base de cache, séparée de mes données : « Vider le cache » ne touche jamais `anime-tracker`.
 * Aucune image ici (les jaquettes vivent dans le cache du service worker).
 */
export class CacheDB extends Dexie {
  media!: Table<Media, number>
  queries!: Table<CachedQuery, string>
  franchises!: Table<Franchise, number>

  constructor(name = 'anime-cache') {
    super(name)
    this.version(1).stores({
      media: 'id, fetchedAt',
      queries: 'key, fetchedAt',
      franchises: 'id, *mediaIds, computedAt',
    })
  }
}

export const cacheDb = new CacheDB()
