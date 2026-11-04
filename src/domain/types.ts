export type MediaFormat = 'TV' | 'TV_SHORT' | 'MOVIE' | 'SPECIAL' | 'OVA' | 'ONA' | 'MUSIC'
export type AiringStatus = 'FINISHED' | 'RELEASING' | 'NOT_YET_RELEASED' | 'CANCELLED' | 'HIATUS'

export interface Relation {
  id: number
  relationType: string
  format: MediaFormat | null
  status: AiringStatus | null
}

/** Fiche anime réduite aux champs utiles (stockée dans le cache). */
export interface Media {
  id: number
  title: { english: string | null; romaji: string | null }
  cover: string | null
  color: string | null
  format: MediaFormat | null
  episodes: number | null
  duration: number | null
  status: AiringStatus | null
  season: string | null
  seasonYear: number | null
  startDate: { year: number | null; month: number | null; day: number | null }
  nextAiring: { episode: number; airingAt: number } | null
  genres: string[]
  tags: { name: string; rank: number }[]
  studios: string[]
  averageScore: number | null
  popularity: number | null
  relations: Relation[]
  fetchedAt: number
}

export type WatchStatus = 'PLANNING' | 'CURRENT' | 'COMPLETED' | 'DROPPED'

export const STATUS_LABEL: Record<WatchStatus, string> = {
  PLANNING: 'À voir',
  CURRENT: 'En cours',
  COMPLETED: 'Terminé',
  DROPPED: 'Abandonné',
}

/** Une entrée de suivi par saison. */
export interface Entry {
  mediaId: number
  franchiseId: number
  status: WatchStatus
  progress: number
  /** 0,5 à 5 par pas de 0,5, ou null. */
  score: number | null
  addedAt: number
  startedAt: number | null
  completedAt: number | null
  updatedAt: number
}

/** Journal compact des épisodes vus. */
export interface LogItem {
  id?: number
  mediaId: number
  episode: number
  at: number
}

export interface Franchise {
  id: number
  mediaIds: number[]
  computedAt: number
}

export const HOUR = 3600_000
export const DAY = 24 * HOUR
