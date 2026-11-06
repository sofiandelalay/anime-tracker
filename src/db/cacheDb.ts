import Dexie, { type Table } from 'dexie'
import type { Franchise, Media } from '../domain/types'

export interface CachedQuery {
  key: string
  results: Media[]
  fetchedAt: number
  /** Pages de saison : il reste des pages après celle-ci. */
  hasNext?: boolean
}

/** Valeurs diverses du cache : synopsis, recommandations par anime, suggestions calculées. */
export interface CachedValue {
  key: string
  value: unknown
  fetchedAt: number
}

/** Titres d'épisodes, texte seul. `permanent` : saison finie de diffusion, jamais expirée. */
export interface CachedTitles {
  mediaId: number
  /** Index 0 = épisode 1. */
  titles: (string | null)[]
  /** Notes de la communauté (Jikan), même index ; absentes si les titres viennent du repli. */
  scores?: (number | null)[]
  fetchedAt: number
  permanent: boolean
}

/** Détail d'un épisode, texte seul : jamais d'image, seulement l'adresse de sa vignette. */
export interface CachedEpisode {
  /** « mediaId:épisode » */
  key: string
  title: string | null
  synopsis: string | null
  score: number | null
  aired: string | null
  filler: boolean
  recap: boolean
  thumbnail: string | null
  fetchedAt: number
  /** Sorti depuis plus de 30 jours : sans expiration. */
  permanent: boolean
  /** Jikan a répondu. Sinon on redemande à la prochaine ouverture. */
  complete: boolean
}

/**
 * Base de cache, séparée de mes données : « Vider le cache » ne touche jamais `anime-tracker`.
 * Aucune image ici (les jaquettes vivent dans le cache du service worker).
 */
export class CacheDB extends Dexie {
  media!: Table<Media, number>
  queries!: Table<CachedQuery, string>
  franchises!: Table<Franchise, number>
  kv!: Table<CachedValue, string>
  titles!: Table<CachedTitles, number>
  episodes!: Table<CachedEpisode, string>

  constructor(name = 'anime-cache') {
    super(name)
    this.version(1).stores({
      media: 'id, fetchedAt',
      queries: 'key, fetchedAt',
      franchises: 'id, *mediaIds, computedAt',
    })
    this.version(2)
      .stores({ kv: 'key, fetchedAt' })
      .upgrade(async (tx) => {
        // Les anciennes fiches contiennent des tags « spoiler » : on les fait périmer pour qu'elles soient rechargées.
        await tx.table('media').toCollection().modify({ fetchedAt: 0 })
        await tx.table('queries').clear()
      })
    this.version(3).stores({ titles: 'mediaId, fetchedAt' })
    this.version(4).stores({ episodes: 'key, fetchedAt' })
  }
}

export const cacheDb = new CacheDB()
