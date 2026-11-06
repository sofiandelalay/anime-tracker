import { compareByStart, displayTitle } from './format'
import { countWatched } from './episodes'
import { seasonNumber } from './franchise'
import { isReleased } from './progress'
import type { Entry, Franchise, Media } from './types'
import { currentViewing, hasTicked, ordinal, watchedOf } from './viewings'

export type CardKind = 'current' | 'newSeason' | 'planning' | 'completed' | 'shelved' | 'dropped'

export interface CardModel {
  key: string
  kind: CardKind
  franchiseId: number
  /** Saison affichée sur la carte. */
  media: Media
  entry: Entry
  seasonNumber: number | null
  /** Titre de l'anime (sa première saison). */
  animeTitle: string
  followed: boolean
  /** Une saison annoncée ou en diffusion, pas encore commencée, attend. */
  newSeason: boolean
  /** « 2e visionnage » pendant un revisionnage. */
  viewingBadge: string | null
}

export interface ListModel {
  toWatch: CardModel[]
  completed: CardModel[]
  shelved: CardModel[]
  archived: CardModel[]
}

export interface AnimeState {
  archived: boolean
  followed: boolean
  hasData: boolean
  /** Toutes les saisons sont terminées. */
  complete: boolean
  /** Tout ce qui est sorti est vu, et une nouvelle saison attend. */
  newSeason: boolean
}

const hasStarted = (e: Entry) => e.status === 'COMPLETED' || e.status === 'CURRENT' || hasTicked(e)

/** État de l'anime entier, déduit de ses saisons. */
export function animeState(group: Entry[], media: Map<number, Media>): AnimeState {
  const remaining = group.filter((e) => e.status !== 'COMPLETED')
  const done = group.length - remaining.length
  const newSeason =
    done > 0 &&
    remaining.length > 0 &&
    remaining.every((e) => {
      const m = media.get(e.mediaId)
      return !!m && countWatched(watchedOf(e)) === 0 && (m.status === 'NOT_YET_RELEASED' || m.status === 'RELEASING')
    })
  return {
    archived: group.some((e) => e.status === 'DROPPED'),
    followed: group.some((e) => e.followed),
    hasData: group.some((e) => hasStarted(e) || e.score !== null),
    complete: group.length > 0 && remaining.length === 0,
    newSeason,
  }
}

export function animeStatusLabel(state: AnimeState): string {
  if (state.archived) return 'Archivé'
  if (state.complete) return 'Terminé'
  if (!state.followed) return state.hasData ? 'Mis de côté' : 'Pas suivi'
  if (state.newSeason) return 'Nouvelle saison'
  return state.hasData ? 'En cours' : 'À voir'
}

export interface AnimeBadge {
  label: 'Suivi' | 'Terminé' | 'Mis de côté' | 'Archivé'
  followed: boolean
}

/** L'état de chaque anime enregistré, retrouvable par n'importe laquelle de ses saisons. Rangé comme dans Ma liste. */
export function animeBadges(entries: Entry[], media: Map<number, Media>): Map<number, AnimeBadge> {
  const groups = new Map<number, Entry[]>()
  for (const e of entries) groups.set(e.franchiseId, [...(groups.get(e.franchiseId) ?? []), e])
  const out = new Map<number, AnimeBadge>()
  for (const [franchiseId, group] of groups) {
    const s = animeState(group, media)
    let label: AnimeBadge['label'] | null
    if (s.archived) label = 'Archivé'
    else if (s.complete) label = 'Terminé'
    else if (s.followed) label = 'Suivi'
    else if (s.newSeason) label = 'Terminé'
    else label = s.hasData ? 'Mis de côté' : null
    if (!label) continue
    // Un archivé ne se rajoute pas d'un tap : « Reprendre » est sur sa page.
    const badge = { label, followed: s.followed || s.archived }
    out.set(franchiseId, badge)
    for (const e of group) out.set(e.mediaId, badge)
  }
  return out
}

/** La saison que représente l'anime : En cours la plus récente, sinon la première à voir déjà sortie. */
export function currentSeason(group: Entry[], media: Map<number, Media>, members: number[]): Entry | undefined {
  const known = group.filter((e) => media.has(e.mediaId))
  const running = known.filter((e) => e.status === 'CURRENT').sort((a, b) => b.updatedAt - a.updatedAt || indexOf(members, a.mediaId) - indexOf(members, b.mediaId))[0]
  if (running) return running
  const ordered = [...known].sort((a, b) => indexOf(members, a.mediaId) - indexOf(members, b.mediaId))
  const todo = ordered.filter((e) => e.status !== 'COMPLETED')
  return todo.find((e) => isReleased(media.get(e.mediaId)!)) ?? todo[0] ?? ordered[ordered.length - 1]
}

/** Construit les quatre vues de « Ma liste » : une carte par anime. */
export function buildListModel(entries: Entry[], media: Map<number, Media>, franchises: Map<number, Franchise>): ListModel {
  const groups = new Map<number, Entry[]>()
  for (const e of entries) {
    const g = groups.get(e.franchiseId)
    if (g) g.push(e)
    else groups.set(e.franchiseId, [e])
  }

  const current: [number, CardModel][] = []
  const fresh: [Media, CardModel][] = []
  const planning: [number, CardModel][] = []
  const completed: [number, CardModel][] = []
  const shelved: [number, CardModel][] = []
  const archived: [number, CardModel][] = []

  for (const [franchiseId, group] of groups) {
    const members = franchises.get(franchiseId)?.mediaIds ?? orderedIds(group, media)
    const shown = currentSeason(group, media, members)
    const m = shown && media.get(shown.mediaId)
    if (!shown || !m) continue
    const state = animeState(group, media)
    const root = media.get(members[0] ?? shown.mediaId) ?? m
    const card = (kind: CardKind): CardModel => ({
      key: `${kind}-${franchiseId}`,
      kind,
      franchiseId,
      media: m,
      entry: shown,
      seasonNumber: seasonNumber(members, m.id),
      animeTitle: displayTitle(root),
      followed: state.followed,
      newSeason: state.newSeason,
      viewingBadge: (currentViewing(shown)?.number ?? 0) > 1 ? `${ordinal(currentViewing(shown)!.number)} visionnage` : null,
    })
    const lastTouched = Math.max(...group.map((e) => e.updatedAt))

    if (state.archived) archived.push([lastTouched, card('dropped')])
    else if (state.complete) completed.push([Math.max(...group.map((e) => e.completedAt ?? e.updatedAt)), card('completed')])
    else if (!state.followed) {
      if (state.newSeason) completed.push([lastTouched, card('completed')])
      else if (state.hasData) shelved.push([lastTouched, card('shelved')])
    } else if (state.newSeason) fresh.push([m, card('newSeason')])
    else if (state.hasData) current.push([lastTouched, card('current')])
    else planning.push([Math.max(...group.map((e) => e.addedAt)), card('planning')])
  }

  const desc = (list: [number, CardModel][]) => list.sort((a, b) => b[0] - a[0]).map(([, c]) => c)
  return {
    toWatch: [...desc(current), ...fresh.sort((a, b) => compareByStart(a[0], b[0])).map(([, c]) => c), ...desc(planning)],
    completed: desc(completed),
    shelved: desc(shelved),
    archived: desc(archived),
  }
}

function orderedIds(group: Entry[], media: Map<number, Media>): number[] {
  return group
    .map((e) => media.get(e.mediaId))
    .filter((m): m is Media => !!m)
    .sort(compareByStart)
    .map((m) => m.id)
}

const indexOf = (ids: number[], id: number): number => {
  const i = ids.indexOf(id)
  return i < 0 ? Number.MAX_SAFE_INTEGER : i
}
