import { fetchMediaByIds } from '../api/media'
import { cacheDb } from '../db/cacheDb'
import { db } from '../db/trackerDb'
import { compareByStart } from './format'
import { addEpisodes, diffEpisodes, firstUnwatched, rangeOf, removeEpisode } from './episodes'
import { buildFranchise } from './franchise'
import { applyWatched, isReleased, maxEpisode } from './progress'
import { buildFollowEntries, newEntry, type Where } from './tracking'
import { addPastViewing, hasTicked, isRewatching, removeViewing, shownViewing, startViewing, stopViewing, timesSeen, watchedOf } from './viewings'
import type { Entry, EpisodeRanges, Media } from './types'

export type Undo = () => Promise<void>

/** Photographie les entrées et le journal d'une franchise pour pouvoir annuler. */
async function snapshot(franchiseId: number): Promise<Undo> {
  const entries = await db.entries.where('franchiseId').equals(franchiseId).toArray()
  const ids = entries.map((e) => e.mediaId)
  const log = await db.log.where('mediaId').anyOf(ids).toArray()
  return () =>
    db.transaction('rw', db.entries, db.log, async () => {
      const nowIds = await db.entries.where('franchiseId').equals(franchiseId).primaryKeys()
      await db.entries.bulkDelete(nowIds)
      await db.entries.bulkPut(entries)
      await db.log.where('mediaId').anyOf([...ids, ...nowIds]).delete()
      await db.log.bulkPut(log)
    })
}

const computing = new Map<number, Promise<number>>()

/**
 * Calcule (ou recalcule) la franchise d'une fiche, la met en cache, réaligne mes entrées et y rattache
 * les nouvelles saisons. Un calcul déjà en cours est partagé : ajouter pendant que la feuille s'ouvre ne double pas les requêtes.
 */
export function computeFranchise(media: Media): Promise<number> {
  let running = computing.get(media.id)
  if (!running) {
    running = runComputeFranchise(media).finally(() => computing.delete(media.id))
    computing.set(media.id, running)
  }
  return running
}

async function runComputeFranchise(media: Media): Promise<number> {
  const result = await buildFranchise(media, (ids) => fetchMediaByIds(ids))
  const members = result.mediaIds.length > 0 ? result.mediaIds : [media.id]
  await cacheDb.transaction('rw', cacheDb.franchises, async () => {
    // Supprime les anciennes versions qui partageaient une saison avec celle-ci.
    await cacheDb.franchises.where('mediaIds').anyOf(members).filter((f) => f.id !== result.id).delete()
    await cacheDb.franchises.put({ id: result.id, mediaIds: result.mediaIds, computedAt: Date.now() })
  })
  await db.entries
    .where('mediaId').anyOf(members)
    .filter((e) => e.franchiseId !== result.id)
    .modify({ franchiseId: result.id })
  await attachSeasons(result.id, members)
  return result.id
}

/**
 * Une nouvelle saison d'un anime que j'ai enregistré lui est rattachée automatiquement.
 * Elle hérite du suivi ; c'est le modèle de Ma liste qui décide si l'anime revient dans À suivre.
 */
export async function attachSeasons(franchiseId: number, members: number[]): Promise<void> {
  await db.transaction('rw', db.entries, async () => {
    const group = await db.entries.where('franchiseId').equals(franchiseId).toArray()
    if (group.length === 0) return
    const followed = group.some((e) => e.followed)
    const known = new Set(group.map((e) => e.mediaId))
    const now = Date.now()
    await db.entries.bulkAdd(members.filter((id) => !known.has(id)).map((id) => newEntry(id, franchiseId, followed, now)))
  })
}

/** Franchise d'une fiche et ses saisons chargées, dans l'ordre (la fiche seule si on est hors ligne). */
async function loadSeasons(media: Media): Promise<{ franchiseId: number; seasons: Media[] }> {
  await cacheDb.media.put(media)
  let franchiseId = media.id
  let ids = [media.id]
  try {
    franchiseId = await computeFranchise(media)
    ids = (await cacheDb.franchises.get(franchiseId))?.mediaIds ?? ids
  } catch {
    // Hors ligne : les autres saisons seront rattachées plus tard (ensureData).
    const known = await cacheDb.franchises.where('mediaIds').equals(media.id).first()
    if (known) {
      franchiseId = known.id
      ids = known.mediaIds
    }
  }
  const loaded = await fetchMediaByIds(ids).catch(() => new Map<number, Media>())
  const seasons = ids.map((id) => (id === media.id ? media : loaded.get(id))).filter((m): m is Media => !!m)
  return { franchiseId, seasons: seasons.sort(compareByStart) }
}

/** Ajoute l'anime entier à ma liste, quelle que soit la saison touchée. */
export async function addAnime(media: Media, where: Where = null): Promise<Undo> {
  const { franchiseId, seasons } = await loadSeasons(media)
  const undo = await snapshot(franchiseId)
  const existing = new Map((await db.entries.where('franchiseId').equals(franchiseId).toArray()).map((e) => [e.mediaId, e]))
  const { entries, log } = buildFollowEntries(franchiseId, seasons, existing, where, Date.now())
  await db.transaction('rw', db.entries, db.log, async () => {
    await db.entries.bulkPut(entries)
    await db.log.bulkAdd(log)
  })
  return undo
}

/** Crée, sans suivre, les entrées d'un anime la première fois que je coche ou note quelque chose. */
async function ensureRecorded(media: Media): Promise<number> {
  const own = await db.entries.get(media.id)
  if (own) return own.franchiseId
  const { franchiseId, seasons } = await loadSeasons(media)
  const group = await db.entries.where('franchiseId').equals(franchiseId).toArray()
  const followed = group.some((e) => e.followed)
  const now = Date.now()
  await db.entries.bulkAdd(
    seasons.filter((m) => !group.some((e) => e.mediaId === m.id)).map((m) => newEntry(m.id, franchiseId, followed, now)),
  )
  return franchiseId
}

export interface EpisodeOutcome {
  mediaId: number
  franchiseId: number
  changed: boolean
  /** La saison vient de passer en Terminé. */
  completed: boolean
  followed: boolean
  /** Numéro du visionnage touché et nombre de fois vue : un revisionnage fini ne redemande pas de note. */
  viewing: number
  seen: number
  undo: Undo
}

interface ChangeOptions {
  /** Épisodes cochés en lot (précédents, « Tout marquer », …) : journalisés avec une date inconnue. */
  bulk?: (episode: number) => boolean
}

async function changeEpisodes(
  media: Media,
  change: (watched: EpisodeRanges) => EpisodeRanges,
  opts: ChangeOptions = {},
): Promise<EpisodeOutcome> {
  const franchiseId = await ensureRecorded(media)
  const undo = await snapshot(franchiseId)
  const result = await db.transaction('rw', db.entries, db.log, async () => {
    const entry = (await db.entries.get(media.id))!
    return { before: entry, res: await writeWatched(entry, media, change(watchedOf(entry)), Date.now(), opts) }
  })
  return {
    mediaId: media.id,
    franchiseId,
    changed: result.res.changed,
    completed: result.res.completed,
    followed: result.before.followed,
    viewing: result.res.viewing,
    seen: result.res.seen,
    undo,
  }
}

/** Écrit une saison et aligne le journal : une ligne par coche, décocher la retire. */
async function writeWatched(entry: Entry, media: Media, watched: EpisodeRanges, now: number, opts: ChangeOptions) {
  const { added, removed } = diffEpisodes(watchedOf(entry), watched)
  const unchanged = { changed: false, completed: false, viewing: shownViewing(entry)?.number ?? 1, seen: timesSeen(entry) }
  if (added.length === 0 && removed.length === 0) return unchanged
  const res = applyWatched(entry, media, watched, now, { unknownDate: !!opts.bulk && added.every((n) => opts.bulk!(n)) })
  const viewing = shownViewing(res.entry)!.number
  await db.entries.put(res.entry)
  await db.log.bulkAdd(added.map((episode) => ({ mediaId: media.id, episode, viewing, at: opts.bulk?.(episode) ? null : now })))
  if (removed.length > 0) {
    await db.log.where('mediaId').equals(media.id).filter((l) => l.viewing === viewing && removed.includes(l.episode)).delete()
  }
  return { changed: true, completed: res.completed, viewing, seen: timesSeen(res.entry) }
}

const clampAired = (media: Media, episode: number) => Math.min(episode, maxEpisode(media))

export const checkEpisode = (media: Media, episode: number) =>
  changeEpisodes(media, (w) => (episode <= maxEpisode(media) ? addEpisodes(w, episode) : w))

/** « Oui, tout marquer » : l'épisode K et tous ceux d'avant. */
export const checkThrough = (media: Media, episode: number) =>
  changeEpisodes(media, (w) => addEpisodes(w, 1, clampAired(media, episode)), { bulk: (n) => n !== episode })

export const uncheckEpisode = (media: Media, episode: number) => changeEpisodes(media, (w) => removeEpisode(w, episode))

/** « +1 épisode » : coche le premier épisode non vu. */
export const incrementEpisode = (media: Media) =>
  changeEpisodes(media, (w) => {
    const next = firstUnwatched(w)
    return next <= maxEpisode(media) ? addEpisodes(w, next) : w
  })

export const markSeasonWatched = (media: Media) =>
  changeEpisodes(media, (w) => {
    const max = maxEpisode(media)
    return Number.isFinite(max) ? addEpisodes(w, 1, max) : w
  }, { bulk: () => true })

/** « J'ai tout vu » : tous les épisodes sortis de toutes les saisons. */
export async function markAllWatched(media: Media): Promise<{ undo: Undo; followed: boolean }> {
  const franchiseId = await ensureRecorded(media)
  const undo = await snapshot(franchiseId)
  const { seasons } = await loadSeasons(media)
  const now = Date.now()
  let followed = false
  await db.transaction('rw', db.entries, db.log, async () => {
    for (const m of seasons) {
      const entry = await db.entries.get(m.id)
      if (!entry) continue
      followed ||= entry.followed
      const max = maxEpisode(m)
      if (Number.isFinite(max)) await writeWatched(entry, m, rangeOf(1, max), now, { bulk: () => true })
    }
  })
  return { undo, followed }
}

/** La note reste par saison ; une note sur un anime non suivi l'enregistre sans le suivre. */
export async function setScore(media: Media, score: number | null): Promise<{ followed: boolean; franchiseId: number }> {
  const franchiseId = await ensureRecorded(media)
  const s = score === null ? null : Math.min(5, Math.max(0.5, Math.round(score * 2) / 2))
  await db.entries.update(media.id, { score: s, updatedAt: Date.now() })
  return { followed: (await db.entries.get(media.id))!.followed, franchiseId }
}

/** Note de l'anime entier : posée sur toutes ses saisons commencées (la note globale en est la moyenne). */
export async function setAnimeScore(franchiseId: number, score: number | null): Promise<void> {
  const now = Date.now()
  await db.entries.where('franchiseId').equals(franchiseId)
    .filter((e) => e.status === 'COMPLETED' || hasTicked(e))
    .modify({ score, updatedAt: now })
}

async function updateAll(franchiseId: number, change: Partial<Entry> | ((e: Entry) => void)): Promise<Undo> {
  const undo = await snapshot(franchiseId)
  await db.entries.where('franchiseId').equals(franchiseId).modify(change as (e: Entry) => void)
  return undo
}

/** « Ne plus suivre » : l'anime quitte À suivre, rien n'est effacé. */
export const unfollowAnime = (franchiseId: number) => updateAll(franchiseId, { followed: false, updatedAt: Date.now() })

export const followAnime = (franchiseId: number) => updateAll(franchiseId, { followed: true, updatedAt: Date.now() })

/** Archiver = passer en Abandonné toutes les saisons à suivre de la franchise. */
export async function archiveFranchise(franchiseId: number): Promise<Undo> {
  const now = Date.now()
  return updateAll(franchiseId, (e) => {
    if (e.status === 'CURRENT' || e.status === 'PLANNING') {
      e.status = 'DROPPED'
      e.updatedAt = now
    }
  })
}

/** Reprendre un anime archivé : les statuts sont recalculés depuis les cases cochées. */
export async function unarchiveFranchise(franchiseId: number): Promise<Undo> {
  const now = Date.now()
  return updateAll(franchiseId, (e) => {
    e.followed = true
    if (e.status === 'DROPPED') {
      e.status = watchedOf(e).length > 0 ? 'CURRENT' : 'PLANNING'
      e.updatedAt = now
    }
  })
}

/** Revoir tout l'anime (toutes ses saisons sorties) ou une saison : l'anime redevient suivi, et sort des archives. */
export async function startRewatch(franchiseId: number, seasons: Media[]): Promise<Undo> {
  const undo = await snapshot(franchiseId)
  const now = Date.now()
  const chosen = new Set(seasons.filter(isReleased).map((m) => m.id))
  await db.entries.where('franchiseId').equals(franchiseId).modify((e, ref) => {
    if (chosen.has(e.mediaId)) {
      ref.value = { ...startViewing(e, now), followed: true }
      return
    }
    e.followed = true
    if (e.status === 'DROPPED') e.status = watchedOf(e).length > 0 ? 'CURRENT' : 'PLANNING'
  })
  return undo
}

/** Arrêter le revisionnage : les visionnages en cours au-delà du premier passent en interrompu. */
export async function stopRewatch(franchiseId: number): Promise<Undo> {
  const undo = await snapshot(franchiseId)
  const now = Date.now()
  await db.entries.where('franchiseId').equals(franchiseId).filter(isRewatching).modify((e, ref) => {
    ref.value = stopViewing(e, now)
  })
  return undo
}

/** Déclarer une fois vue avant d'utiliser l'appli : tous les épisodes sortis cochés, date facultative. */
export async function addPastWatch(media: Media, date: number | null): Promise<Undo> {
  const franchiseId = await ensureRecorded(media)
  const undo = await snapshot(franchiseId)
  const max = maxEpisode(media)
  const watched = Number.isFinite(max) ? rangeOf(1, max) : []
  await db.transaction('rw', db.entries, db.log, async () => {
    const { entry, number, shifted } = addPastViewing((await db.entries.get(media.id))!, watched, date, Date.now())
    await db.entries.put(entry)
    if (shifted !== null) {
      await db.log.where('mediaId').equals(media.id).filter((l) => l.viewing === shifted).modify({ viewing: shifted + 1 })
    }
    const episodes = watched.flatMap(([from, to]) => Array.from({ length: to - from + 1 }, (_, i) => from + i))
    await db.log.bulkAdd(episodes.map((episode) => ({ mediaId: media.id, episode, at: date, viewing: number })))
  })
  return undo
}

/** Supprimer un visionnage et ses lignes de journal : le seul cas de suppression, toujours confirmé avant. */
export async function deleteViewing(franchiseId: number, mediaId: number, number: number): Promise<Undo> {
  const undo = await snapshot(franchiseId)
  await db.transaction('rw', db.entries, db.log, async () => {
    await db.entries.put(removeViewing((await db.entries.get(mediaId))!, number, Date.now()))
    await db.log.where('mediaId').equals(mediaId).filter((l) => l.viewing === number).delete()
  })
  return undo
}

/** « Pas pour moi » : masque définitivement une suggestion. */
export async function hideAnime(mediaId: number): Promise<Undo> {
  await db.hidden.put({ mediaId, at: Date.now() })
  return () => db.hidden.delete(mediaId)
}
