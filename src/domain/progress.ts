import type { Entry, Media } from './types'

/** Nombre d'épisodes déjà sortis, ou null si inconnu. */
export function airedEpisodes(m: Media): number | null {
  if (m.status === 'NOT_YET_RELEASED') return 0
  if (m.nextAiring) return Math.max(0, m.nextAiring.episode - 1)
  return m.episodes
}

/** Épisode maximum que l'on peut cocher (on ne dépasse pas le dernier sorti). */
export function maxEpisode(m: Media): number {
  const aired = airedEpisodes(m)
  if (aired !== null) return m.episodes !== null ? Math.min(aired, m.episodes) : aired
  return m.episodes ?? Number.POSITIVE_INFINITY
}

export const isAiring = (m: Media): boolean => m.status === 'RELEASING'

/** Vrai si cet épisode est le dernier d'une saison terminée de diffusion. */
export const isFinale = (m: Media, progress: number): boolean =>
  m.status === 'FINISHED' && m.episodes !== null && m.episodes > 0 && progress >= m.episodes

export interface ProgressInfo {
  watched: number
  total: number | null
  aired: number | null
  /** Part vue, de 0 à 1. */
  watchedRatio: number
  /** Part sortie (repère visuel) si en diffusion avec un total connu, sinon null. */
  airedRatio: number | null
  canIncrement: boolean
}

export function progressInfo(entry: Pick<Entry, 'progress'> | null, m: Media): ProgressInfo {
  const watched = entry?.progress ?? 0
  const total = m.episodes
  const aired = airedEpisodes(m)
  const denom = total ?? Math.max(aired ?? 0, watched)
  const watchedRatio = denom > 0 ? Math.min(1, watched / denom) : 0
  const airedRatio = isAiring(m) && total && aired !== null ? Math.min(1, aired / total) : null
  return { watched, total, aired, watchedRatio, airedRatio, canIncrement: watched < maxEpisode(m) }
}

export interface ProgressResult {
  entry: Entry
  /** La saison vient de passer en Terminé. */
  completed: boolean
}

/** Applique un nouveau nombre d'épisodes vus en respectant les règles métier. */
export function applyProgress(entry: Entry, m: Media, target: number, now: number): ProgressResult {
  const progress = Math.max(0, Math.min(Math.round(target), maxEpisode(m)))
  const next: Entry = { ...entry, progress, updatedAt: now }
  let completed = false
  if (progress > entry.progress && (entry.status === 'PLANNING' || entry.status === 'DROPPED')) {
    next.status = 'CURRENT'
  }
  if (progress > 0 && next.startedAt === null) next.startedAt = now
  if (isFinale(m, progress)) {
    if (entry.status !== 'COMPLETED') {
      next.status = 'COMPLETED'
      next.completedAt = now
      completed = true
    }
  } else if (entry.status === 'COMPLETED' && progress < entry.progress) {
    next.status = 'CURRENT'
    next.completedAt = null
  }
  return { entry: next, completed }
}

export const seasonLine = (seasonNumber: number | null, info: ProgressInfo): string => {
  const ep = info.total ? `Ép. ${info.watched} / ${info.total}` : `Ép. ${info.watched}`
  return seasonNumber ? `Saison ${seasonNumber} · ${ep}` : ep
}
