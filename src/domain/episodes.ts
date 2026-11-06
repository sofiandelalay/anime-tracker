/**
 * Ensemble des épisodes vus d'une saison, stocké en plages triées : « 1 à 500 » tient en [[1, 500]].
 * Module pur.
 */
import type { EpisodeRanges } from './types'

export const rangeOf = (from: number, to: number): EpisodeRanges => (to >= from ? [[from, to]] : [])

export const countWatched = (ranges: EpisodeRanges): number =>
  ranges.reduce((sum, [from, to]) => sum + to - from + 1, 0)

export const hasEpisode = (ranges: EpisodeRanges, episode: number): boolean =>
  ranges.some(([from, to]) => episode >= from && episode <= to)

function normalize(ranges: EpisodeRanges): EpisodeRanges {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0])
  const out: EpisodeRanges = []
  for (const [from, to] of sorted) {
    const last = out[out.length - 1]
    if (last && from <= last[1] + 1) last[1] = Math.max(last[1], to)
    else out.push([from, to])
  }
  return out
}

export const addEpisodes = (ranges: EpisodeRanges, from: number, to = from): EpisodeRanges =>
  to < from ? ranges : normalize([...ranges.map(([a, b]) => [a, b] as [number, number]), [from, to]])

export function removeEpisode(ranges: EpisodeRanges, episode: number): EpisodeRanges {
  return ranges.flatMap(([from, to]): EpisodeRanges => {
    if (episode < from || episode > to) return [[from, to]]
    return [...rangeOf(from, episode - 1), ...rangeOf(episode + 1, to)]
  })
}

/** Le premier épisode non vu (au moins 1). */
export function firstUnwatched(ranges: EpisodeRanges): number {
  const first = normalize(ranges)[0]
  return first && first[0] === 1 ? first[1] + 1 : 1
}

/** Nombre d'épisodes non cochés avant K. */
export const missingBefore = (ranges: EpisodeRanges, episode: number): number =>
  Math.max(0, episode - 1) - countWatched(ranges.flatMap(([from, to]) => rangeOf(from, Math.min(to, episode - 1))))

export type CheckPlan =
  | { kind: 'check' }
  /** X épisodes précédents manquent : il faut demander. */
  | { kind: 'confirm'; missing: number }
  | { kind: 'uncheck' }

/** Ce que déclenche un toucher sur la case de l'épisode K. */
export function planToggle(ranges: EpisodeRanges, episode: number): CheckPlan {
  if (hasEpisode(ranges, episode)) return { kind: 'uncheck' }
  const missing = missingBefore(ranges, episode)
  return missing > 0 ? { kind: 'confirm', missing } : { kind: 'check' }
}

/** Liste des numéros qui diffèrent entre deux ensembles. */
export function diffEpisodes(before: EpisodeRanges, after: EpisodeRanges): { added: number[]; removed: number[] } {
  const expand = (ranges: EpisodeRanges) => ranges.flatMap(([from, to]) => Array.from({ length: to - from + 1 }, (_, i) => from + i))
  return {
    added: expand(after).filter((n) => !hasEpisode(before, n)),
    removed: expand(before).filter((n) => !hasEpisode(after, n)),
  }
}

export const isEpisodeRanges = (v: unknown): v is EpisodeRanges =>
  Array.isArray(v) && v.every((r) => Array.isArray(r) && r.length === 2 && Number.isInteger(r[0]) && Number.isInteger(r[1]) && r[0] >= 1 && r[1] >= r[0])

/** Tranches d'affichage pour les saisons longues : 1-100, 101-200… */
export function episodeSlices(total: number, size = 100): { from: number; to: number }[] {
  const out = []
  for (let from = 1; from <= total; from += size) out.push({ from, to: Math.min(total, from + size - 1) })
  return out
}
