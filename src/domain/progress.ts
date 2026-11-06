import { countWatched, firstUnwatched, hasEpisode } from './episodes'
import { nextViewingNumber, shownViewing, watchedOf } from './viewings'
import { airedLine, formatStartDate, upcomingLine } from './format'
import type { Entry, EpisodeRanges, Media, Viewing, WatchStatus } from './types'

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
export const isReleased = (m: Media): boolean => m.status !== 'NOT_YET_RELEASED'

/** Vrai si cette saison, finie de diffusion, a tous ses épisodes cochés. */
export const isFullyWatched = (m: Media, watched: EpisodeRanges): boolean =>
  m.status === 'FINISHED' && m.episodes !== null && m.episodes > 0 && countWatched(watched) >= m.episodes

export interface ProgressInfo {
  watched: number
  total: number | null
  aired: number | null
  /** Part vue, de 0 à 1. */
  watchedRatio: number
  /** Part sortie (repère visuel) si en diffusion avec un total connu, sinon null. */
  airedRatio: number | null
  /** Prochain épisode à cocher, ou null s'il n'y en a pas encore. */
  nextEpisode: number | null
  canIncrement: boolean
}

export function progressInfo(entry: Pick<Entry, 'viewings'> | null, m: Media): ProgressInfo {
  const ranges = watchedOf(entry)
  const watched = countWatched(ranges)
  const total = m.episodes
  const aired = airedEpisodes(m)
  const denom = total ?? Math.max(aired ?? 0, watched)
  const next = firstUnwatched(ranges)
  const nextEpisode = next <= maxEpisode(m) ? next : null
  return {
    watched,
    total,
    aired,
    watchedRatio: denom > 0 ? Math.min(1, watched / denom) : 0,
    airedRatio: isAiring(m) && total && aired !== null ? Math.min(1, aired / total) : null,
    nextEpisode,
    canIncrement: nextEpisode !== null,
  }
}

export interface WatchResult {
  entry: Entry
  /** La saison vient de passer en Terminé. */
  completed: boolean
}

/** Applique de nouvelles cases au visionnage en cours et en déduit le statut. `unknownDate` : coché en lot, sans vraie date. */
export function applyWatched(entry: Entry, m: Media, watched: EpisodeRanges, now: number, opts: { unknownDate?: boolean } = {}): WatchResult {
  const count = countWatched(watched)
  const shown = shownViewing(entry)
  const stamp = opts.unknownDate ? null : now
  // Corriger un visionnage terminé le rouvre ; sans aucun visionnage, le premier commence ici.
  const target: Viewing = shown ? { ...shown } : { number: nextViewingNumber(entry), watched: [], startedAt: stamp, endedAt: null, state: 'current' }
  const wasDone = target.state === 'completed'
  const full = isFullyWatched(m, watched)
  target.watched = watched
  target.state = full ? 'completed' : 'current'
  target.endedAt = full ? (wasDone ? target.endedAt : stamp) : null

  const next: Entry = { ...entry, updatedAt: now, viewings: shown ? entry.viewings.map((v) => (v.number === target.number ? target : v)) : [...entry.viewings, target] }
  if (count > 0 && next.startedAt === null) next.startedAt = now

  let status: WatchStatus
  if (full) status = 'COMPLETED'
  // Une saison archivée reste archivée quand on coche : l'historique s'enregistre sans la faire revenir.
  else if (entry.status === 'DROPPED') status = 'DROPPED'
  else status = count > 0 || target.number > 1 ? 'CURRENT' : 'PLANNING'

  next.status = status
  next.completedAt = status === 'COMPLETED' ? entry.completedAt ?? now : null
  return { entry: next, completed: status === 'COMPLETED' && entry.status !== 'COMPLETED' }
}

export const seasonLine = (seasonNumber: number | null, info: ProgressInfo): string => {
  const ep = info.total ? `Ép. ${info.watched} / ${info.total}` : `Ép. ${info.watched}`
  return seasonNumber ? `Saison ${seasonNumber} · ${ep}` : ep
}

/** Progression de l'anime entier : épisodes vus / total, toutes saisons sorties. */
export function globalProgress(seasons: Media[], entries: Map<number, Entry>): { watched: number; total: number; ratio: number } {
  let watched = 0
  let total = 0
  for (const m of seasons) {
    const count = countWatched(watchedOf(entries.get(m.id)))
    watched += count
    if (isReleased(m)) total += m.episodes ?? airedEpisodes(m) ?? count
  }
  const denom = Math.max(total, watched)
  return { watched, total: denom, ratio: denom > 0 ? watched / denom : 0 }
}

/** Note globale : moyenne des saisons notées, arrondie à la demi-étoile. */
export function globalScore(entries: Iterable<Entry>): number | null {
  const scores = [...entries].flatMap((e) => (e.score === null ? [] : [e.score]))
  if (scores.length === 0) return null
  return Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 2) / 2
}

/** Nombre de lignes à afficher : le total si connu, sinon jusqu'au prochain épisode. */
export function episodeRowCount(m: Media, watched: EpisodeRanges): number {
  const highest = watched[watched.length - 1]?.[1] ?? 0
  const known = m.episodes ?? (m.nextAiring ? m.nextAiring.episode : airedEpisodes(m) ?? 0)
  return Math.max(known, highest)
}

export const isEpisodeAired = (m: Media, episode: number): boolean => episode <= maxEpisode(m)

/** La ligne de date d'un épisode : « Sorti le 13 sept. 2026 », « Sort le 20 nov. · dans 2 j 4 h ». */
export function episodeDateLine(m: Media, episode: number, aired: string | null, now: number): string {
  const airing = m.nextAiring?.episode === episode ? m.nextAiring.airingAt * 1000 : null
  const known = airing ?? (aired ? new Date(aired).getTime() : null)
  if (known !== null && !Number.isNaN(known)) return known > now ? upcomingLine(known, now) : airedLine(known)
  const { year, month, day } = m.startDate
  if (episode === 1 && year && month && day) {
    const start = Date.UTC(year, month - 1, day)
    return start > now ? upcomingLine(start, now) : airedLine(start)
  }
  if (isEpisodeAired(m, episode)) return 'Déjà sorti'
  const start = episode === 1 ? formatStartDate(m.startDate) : null
  return start ? `Sort en ${start}` : 'Pas encore sorti'
}

export { hasEpisode }
