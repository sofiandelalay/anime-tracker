/** Ajout d'un anime entier : calcul pur des entrées à écrire. */
import { diffEpisodes, rangeOf } from './episodes'
import { applyWatched, maxEpisode } from './progress'
import type { Entry, LogItem, Media } from './types'
import { nextViewingNumber, shownViewing, watchedOf } from './viewings'

export function newEntry(mediaId: number, franchiseId: number, followed: boolean, now: number): Entry {
  return {
    mediaId,
    franchiseId,
    status: 'PLANNING',
    viewings: [],
    followed,
    score: null,
    addedAt: now,
    startedAt: null,
    completedAt: null,
    updatedAt: now,
  }
}

/** « Tu en es où ? » : null = pas commencé ; `all` = j'ai tout vu, `times` fois. */
export type Where = { seasonId: number; episode: number } | { all: true; times?: number } | null

/**
 * Tous les épisodes sortis cochés, à date inconnue, `times` fois. Une saison encore en diffusion garde sa dernière
 * fois en cours. Une saison finie dont on ignore le nombre d'épisodes est simplement Terminée.
 */
export function watchEverything(entry: Entry, m: Media, now: number, times = 1): Entry {
  const max = maxEpisode(m)
  // Rien de sorti (saison annoncée) : rien à cocher, aucun visionnage.
  if (max === 0) return entry
  let e = entry
  for (let i = 0; i < times; i++) {
    if (i > 0) e = { ...e, viewings: [...e.viewings, { number: nextViewingNumber(e), watched: [], startedAt: null, endedAt: null, state: 'current' }] }
    if (i < times - 1 && m.status === 'RELEASING') {
      // Les fois d'avant sont terminées, même si la saison continue.
      const ticked = applyWatched(e, m, rangeOf(1, max), now, { unknownDate: true }).entry
      e = { ...ticked, viewings: ticked.viewings.map((v) => (v.state === 'current' ? { ...v, state: 'completed' as const } : v)) }
    } else if (Number.isFinite(max)) {
      e = applyWatched(e, m, rangeOf(1, max), now, { unknownDate: true }).entry
    } else if (m.status === 'FINISHED') {
      const viewings = e.viewings.length > 0 ? e.viewings : [{ number: 1, watched: [], startedAt: null, endedAt: null, state: 'completed' as const }]
      e = { ...e, viewings: viewings.map((v) => (v.state === 'current' ? { ...v, state: 'completed' as const } : v)), status: 'COMPLETED', completedAt: e.completedAt ?? now, startedAt: e.startedAt ?? now, updatedAt: now }
    }
  }
  return e
}

/**
 * Une entrée par saison de la franchise, toutes suivies. « Déjà commencé » : les saisons précédentes sont
 * entièrement cochées et Terminées, la saison choisie cochée jusqu'à l'épisode indiqué.
 * Une entrée existante garde ses données (elle passe seulement en suivie) : on ne coche que ce qui manque.
 */
export function buildFollowEntries(
  franchiseId: number,
  seasons: Media[],
  existing: Map<number, Entry>,
  where: Where,
  now: number,
): { entries: Entry[]; log: Omit<LogItem, 'id'>[] } {
  const started = where && 'seasonId' in where ? where : null
  const chosenAt = started ? seasons.findIndex((m) => m.id === started.seasonId) : -1
  const entries: Entry[] = []
  const log: Omit<LogItem, 'id'>[] = []

  seasons.forEach((m, i) => {
    const base: Entry = { ...(existing.get(m.id) ?? newEntry(m.id, franchiseId, true, now)), franchiseId, followed: true }
    if (where && 'all' in where) {
      const seen = watchEverything(base, m, now, Math.max(1, where.times ?? 1))
      entries.push(seen)
      for (const v of seen.viewings) {
        const before = base.viewings.find((x) => x.number === v.number)?.watched ?? []
        for (const episode of diffEpisodes(before, v.watched).added) log.push({ mediaId: m.id, episode, at: null, viewing: v.number })
      }
      return
    }
    if (i > chosenAt || chosenAt < 0 || !started) {
      entries.push(base)
      return
    }
    const upTo = i === chosenAt ? Math.min(started.episode, maxEpisode(m)) : maxEpisode(m)
    const finite = Number.isFinite(upTo) ? upTo : 0
    const target = rangeOf(1, finite)
    const merged = watchedOf(base).length > 0 && !target.length ? watchedOf(base) : target
    const res = applyWatched(base, m, merged, now, { unknownDate: true }).entry
    // Saison précédente sans nombre d'épisodes connu : on sait seulement qu'elle est vue.
    const done: Entry = i < chosenAt
      ? { ...res, viewings: res.viewings.map((v) => (v.state === 'current' ? { ...v, state: 'completed' as const } : v)), status: 'COMPLETED', completedAt: res.completedAt ?? now, startedAt: res.startedAt ?? now }
      : res
    entries.push(done)
    const number = shownViewing(done)?.number ?? 1
    for (const episode of diffEpisodes(watchedOf(base), watchedOf(done)).added) log.push({ mediaId: m.id, episode, at: null, viewing: number })
  })
  return { entries, log }
}

/** Saison proposée par défaut dans « Tu en es où ? » : celle touchée si elle a des épisodes sortis, sinon la dernière sortie. */
export function defaultSeason(seasons: Media[], touchedId: number): Media | null {
  const touched = seasons.find((m) => m.id === touchedId)
  if (touched && maxEpisode(touched) > 0) return touched
  const released = seasons.filter((m) => maxEpisode(m) > 0)
  return released[released.length - 1] ?? null
}
