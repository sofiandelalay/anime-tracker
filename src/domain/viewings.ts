/**
 * Visionnages d'une saison : chaque fois que je la regarde, avec ses propres cases. Module pur.
 * Règle absolue : rien n'est perdu, sauf par la suppression explicite d'un visionnage.
 */
import { countWatched } from './episodes'
import { isReleased } from './progress'
import type { Entry, EpisodeRanges, Media, Viewing, WatchStatus } from './types'

export const currentViewing = (e: Pick<Entry, 'viewings'>): Viewing | undefined => e.viewings.find((v) => v.state === 'current')

const latest = (list: Viewing[]): Viewing | undefined => list.reduce<Viewing | undefined>((a, v) => (!a || v.number > a.number ? v : a), undefined)

/** Le visionnage que montrent les cases : celui en cours, sinon le dernier terminé, sinon le dernier interrompu. */
export const shownViewing = (e: Pick<Entry, 'viewings'>): Viewing | undefined =>
  currentViewing(e) ?? latest(e.viewings.filter((v) => v.state === 'completed')) ?? latest(e.viewings)

export const watchedOf = (e: Pick<Entry, 'viewings'> | null | undefined): EpisodeRanges => (e ? shownViewing(e)?.watched ?? [] : [])

/** Au moins un épisode coché, tous visionnages confondus. */
export const hasTicked = (e: Pick<Entry, 'viewings'>): boolean => e.viewings.some((v) => v.watched.length > 0)

/** Nombre de fois que la saison a été vue : ses visionnages terminés. */
export const timesSeen = (e: Pick<Entry, 'viewings'> | undefined): number => e?.viewings.filter((v) => v.state === 'completed').length ?? 0

export const isRewatching = (e: Pick<Entry, 'viewings'>): boolean => (currentViewing(e)?.number ?? 0) > 1

export const nextViewingNumber = (e: Pick<Entry, 'viewings'>): number => Math.max(0, ...e.viewings.map((v) => v.number)) + 1

export const ordinal = (n: number): string => (n === 1 ? '1er' : `${n}e`)

/** Le statut de la saison une fois ses visionnages changés. */
function settle(e: Entry, now: number): Entry {
  const viewings = e.viewings.map((v) => ({ ...v }))
  const current = currentViewing({ viewings })
  const keep = (status: WatchStatus) => (e.status === 'DROPPED' ? 'DROPPED' : status)
  if (current) {
    return { ...e, viewings, completedAt: null, updatedAt: now, status: keep(current.watched.length > 0 || current.number > 1 ? 'CURRENT' : 'PLANNING') }
  }
  const done = latest(viewings.filter((v) => v.state === 'completed'))
  if (done) return { ...e, viewings, status: 'COMPLETED', completedAt: done.endedAt ?? e.completedAt ?? now, updatedAt: now }
  // Plus rien de terminé : le dernier visionnage commencé reprend là où il en était.
  const back = latest(viewings.filter((v) => v.state === 'interrupted' && v.watched.length > 0))
  if (back) {
    back.state = 'current'
    back.endedAt = null
    return { ...e, viewings, completedAt: null, updatedAt: now, status: keep('CURRENT') }
  }
  return { ...e, viewings, completedAt: null, updatedAt: now, status: keep('PLANNING') }
}

/** Revoir : un nouveau visionnage, cases décochées. Le précédent est conservé : terminé s'il l'était, sinon interrompu. */
export function startViewing(e: Entry, now: number): Entry {
  const running = currentViewing(e)
  // Un visionnage en cours encore vide sert déjà de nouveau départ.
  if (running && running.watched.length === 0) return { ...e, status: 'CURRENT', completedAt: null, updatedAt: now }
  const viewings = e.viewings.map((v) => (v.state === 'current' ? { ...v, state: 'interrupted' as const, endedAt: now } : v))
  viewings.push({ number: nextViewingNumber(e), watched: [], startedAt: now, endedAt: null, state: 'current' })
  return { ...e, viewings, status: 'CURRENT', completedAt: null, updatedAt: now }
}

/** Arrêter le revisionnage : il passe en interrompu, la saison retrouve son état d'avant. */
export function stopViewing(e: Entry, now: number): Entry {
  const viewings = e.viewings.map((v) => (v.state === 'current' ? { ...v, state: 'interrupted' as const, endedAt: now } : v))
  return settle({ ...e, viewings }, now)
}

/** Le seul cas de suppression, toujours confirmé. */
export function removeViewing(e: Entry, number: number, now: number): Entry {
  return settle({ ...e, viewings: e.viewings.filter((v) => v.number !== number) }, now)
}

/**
 * Une fois vue avant d'utiliser l'appli : tous les épisodes cochés. Elle prend sa place avant un visionnage en cours,
 * qui passe au numéro suivant : `shifted` indique lequel, pour réaligner le journal.
 */
export function addPastViewing(e: Entry, watched: EpisodeRanges, date: number | null, now: number): { entry: Entry; number: number; shifted: number | null } {
  const running = currentViewing(e)
  const number = running ? running.number : nextViewingNumber(e)
  const viewings = e.viewings.map((v) => (running && v.number === running.number ? { ...v, number: v.number + 1 } : v))
  viewings.push({ number, watched, startedAt: date, endedAt: date, state: 'completed' })
  viewings.sort((a, b) => a.number - b.number)
  return { entry: settle({ ...e, viewings }, now), number, shifted: running ? running.number : null }
}

/** Ligne discrète d'une saison, seulement si elle apporte une info. */
export function seasonViewsLine(e: Pick<Entry, 'viewings'> | null | undefined): string | null {
  if (!e) return null
  const seen = timesSeen(e)
  const rerun = isRewatching(e) ? `${ordinal(currentViewing(e)!.number)} visionnage en cours` : null
  if (rerun) return seen > 0 ? `Vue ${seen} fois · ${rerun}` : rerun
  return seen >= 2 ? `Vue ${seen} fois` : null
}

/** Fois où toutes les saisons sorties ont été vues : le minimum des saisons. */
export function animeTimesSeen(seasons: Media[], entries: Map<number, Pick<Entry, 'viewings'>>): number {
  const released = seasons.filter(isReleased)
  if (released.length === 0) return 0
  return Math.min(...released.map((m) => timesSeen(entries.get(m.id) as Entry | undefined)))
}

/** Conversion d'une saison à l'ancien format (migration, anciens exports). */
export function legacyViewings(
  e: { status: WatchStatus; startedAt: number | null; completedAt: number | null },
  watched: EpisodeRanges,
  datesKnown: boolean,
): Viewing[] {
  const done = e.status === 'COMPLETED'
  if (!done && countWatched(watched) === 0) return []
  return [{
    number: 1,
    watched,
    startedAt: datesKnown ? e.startedAt : null,
    endedAt: datesKnown && done ? e.completedAt : null,
    state: done ? 'completed' : 'current',
  }]
}

export const isViewing = (v: unknown, isRanges: (r: unknown) => boolean): v is Viewing => {
  const x = v as Viewing
  const dateOk = (d: unknown) => d === null || (typeof d === 'number' && Number.isFinite(d))
  return !!x && Number.isInteger(x.number) && x.number >= 1 && isRanges(x.watched) && dateOk(x.startedAt) && dateOk(x.endedAt) &&
    ['current', 'completed', 'interrupted'].includes(x.state)
}

export const VIEWING_STATE_LABEL: Record<Viewing['state'], string> = { current: 'En cours', completed: 'Terminé', interrupted: 'Interrompu' }
