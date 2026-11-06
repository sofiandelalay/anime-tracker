import { countWatched } from './episodes'
import { animeState } from './listModel'
import type { Entry, LogItem, Media } from './types'
import { timesSeen } from './viewings'

/** Durée supposée d'un épisode quand AniList ne la donne pas (fréquent sur les séries en cours). */
const DEFAULT_DURATION = 24
/** « Bien noté » : même seuil que « aimé » dans Pour toi. */
const WELL_RATED = 4

export interface Stats {
  totalMinutes: number
  /** Épisodes regardés au total, revisionnages compris. */
  episodes: number
  /** Dont en revisionnage. */
  rewatchMinutes: number
  /** Revisionnages terminés : les visionnages au-delà du premier. */
  rewatches: number
  /** La saison vue le plus de fois, si au moins 2. */
  mostRewatched: { media: Media; times: number } | null
  monthMinutes: number
  completed: number
  /** Top 3 pondéré par les épisodes vus. */
  genres: { name: string; episodes: number }[]
  favoriteStudio: { name: string; episodes: number } | null
}

const startOfMonth = (now: number): number => {
  const d = new Date(now)
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime()
}

const top = (counts: Map<string, number>) =>
  [...counts]
    .filter(([, episodes]) => episodes > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, episodes]) => ({ name, episodes }))

/** Animes entièrement vus (une nouvelle saison pas commencée n'enlève rien à ce qui a été vu). */
function countCompletedAnimes(entries: Entry[], media: Map<number, Media>): number {
  const groups = new Map<number, Entry[]>()
  for (const e of entries) groups.set(e.franchiseId, [...(groups.get(e.franchiseId) ?? []), e])
  return [...groups.values()].filter((g) => {
    const s = animeState(g, media)
    return s.complete || s.newSeason
  }).length
}

export function buildStats(entries: Entry[], media: Map<number, Media>, log: LogItem[], now: number): Stats {
  const duration = (id: number) => media.get(id)?.duration ?? DEFAULT_DURATION
  const genres = new Map<string, number>()
  const studios = new Map<string, number>()
  let totalMinutes = 0
  let episodes = 0
  let rewatchMinutes = 0
  let rewatches = 0
  let mostRewatched: Stats['mostRewatched'] = null

  for (const e of entries) {
    const m = media.get(e.mediaId)
    if (!m) continue
    const ordered = [...e.viewings].sort((a, b) => a.number - b.number)
    const watched = ordered.reduce((sum, v) => sum + countWatched(v.watched), 0)
    totalMinutes += watched * duration(e.mediaId)
    episodes += watched
    for (const v of ordered.slice(1)) {
      rewatchMinutes += countWatched(v.watched) * duration(e.mediaId)
      if (v.state === 'completed') rewatches++
    }
    const times = timesSeen(e)
    if (times >= 2 && times > (mostRewatched?.times ?? 0)) mostRewatched = { media: m, times }
    for (const g of m.genres) genres.set(g, (genres.get(g) ?? 0) + watched)
    if (e.score !== null && e.score >= WELL_RATED) {
      for (const s of m.studios) studios.set(s, (studios.get(s) ?? 0) + watched)
    }
  }

  const monthStart = startOfMonth(now)
  const monthMinutes = log.filter((l) => l.at !== null && l.at >= monthStart).reduce((sum, l) => sum + duration(l.mediaId), 0)

  return {
    totalMinutes,
    episodes,
    rewatchMinutes,
    rewatches,
    mostRewatched,
    monthMinutes,
    completed: countCompletedAnimes(entries, media),
    genres: top(genres).slice(0, 3),
    favoriteStudio: top(studios)[0] ?? null,
  }
}
