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
  /** Identifiant MyAnimeList, pour les titres d'épisodes (absent des fiches mises en cache avant cet ajout). */
  idMal?: number | null
  title: { english: string | null; romaji: string | null }
  cover: string | null
  /** Bannière de l'anime (absente des fiches mises en cache avant cet ajout). */
  banner?: string | null
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

/** Plages d'épisodes [de, à], triées et sans chevauchement : [[1, 12], [15, 15]]. */
export type EpisodeRanges = [number, number][]

export type ViewingState = 'current' | 'completed' | 'interrupted'

/** Un visionnage d'une saison. Dates nulles = inconnues (coché en lot, déclaré après coup). */
export interface Viewing {
  number: number
  watched: EpisodeRanges
  startedAt: number | null
  endedAt: number | null
  state: ViewingState
}

/** Une entrée par saison, pour tout anime coché, noté ou suivi. */
export interface Entry {
  mediaId: number
  franchiseId: number
  status: WatchStatus
  /** Chaque fois que je regarde la saison ; au plus un en cours. Vide tant que rien n'est coché. */
  viewings: Viewing[]
  /** Décide seulement si l'anime apparaît dans À suivre ; mes données existent, suivi ou non. */
  followed: boolean
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
  /** null = date inconnue (coché en lot, rattrapage d'un anime déjà vu) : compte dans les totaux, pas dans « ce mois-ci ». */
  at: number | null
  /** Numéro du visionnage. */
  viewing: number
}

export interface Franchise {
  id: number
  mediaIds: number[]
  computedAt: number
}

export const HOUR = 3600_000
export const DAY = 24 * HOUR
