import { compareByStart } from './format'
import { seasonNumber } from './franchise'
import { detectNewSeason } from './newSeason'
import type { Entry, Franchise, Media } from './types'

export type CardKind = 'current' | 'newSeason' | 'planning' | 'completed' | 'dropped'

export interface CardModel {
  key: string
  kind: CardKind
  franchiseId: number
  media: Media
  /** null pour une nouvelle saison pas encore ajoutée. */
  entry: Entry | null
  seasonNumber: number | null
}

export interface ListModel {
  toWatch: CardModel[]
  completed: CardModel[]
  archived: CardModel[]
}

/** Construit les trois vues de « Ma liste » à partir des entrées et des fiches en cache. */
export function buildListModel(
  entries: Entry[],
  media: Map<number, Media>,
  franchises: Map<number, Franchise>,
): ListModel {
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
  const archived: [number, CardModel][] = []

  for (const [franchiseId, group] of groups) {
    const members = franchises.get(franchiseId)?.mediaIds ?? orderedIds(group, media)
    const card = (kind: CardKind, e: Entry | null, m: Media): CardModel => ({
      key: `${kind}-${franchiseId}`,
      kind,
      franchiseId,
      media: m,
      entry: e,
      seasonNumber: seasonNumber(members, m.id),
    })
    const withMedia = (list: Entry[]) => list.filter((e) => media.has(e.mediaId))
    const byOrder = (list: Entry[]) =>
      withMedia(list).sort((a, b) => indexOf(members, a.mediaId) - indexOf(members, b.mediaId))

    const cur = withMedia(group.filter((e) => e.status === 'CURRENT')).sort((a, b) => b.updatedAt - a.updatedAt)
    const plan = byOrder(group.filter((e) => e.status === 'PLANNING'))
    const dropped = withMedia(group.filter((e) => e.status === 'DROPPED')).sort((a, b) => b.updatedAt - a.updatedAt)

    if (cur[0]) {
      current.push([cur[0].updatedAt, card('current', cur[0], media.get(cur[0].mediaId)!)])
    } else if (plan[0]) {
      const latestAdd = Math.max(...plan.map((e) => e.addedAt))
      planning.push([latestAdd, card('planning', plan[0], media.get(plan[0].mediaId)!)])
    } else if (dropped[0]) {
      archived.push([dropped[0].updatedAt, card('dropped', dropped[0], media.get(dropped[0].mediaId)!)])
    } else {
      const done = byOrder(group)
      const last = done[done.length - 1]
      if (!last) continue
      completed.push([last.completedAt ?? last.updatedAt, card('completed', last, media.get(last.mediaId)!)])
      const newId = detectNewSeason(group, media, members)
      const newMedia = newId !== null ? media.get(newId) : undefined
      if (newMedia) {
        const c = card('newSeason', null, newMedia)
        // Le numéro de saison suit la dernière saison connue si la franchise n'a pas encore été recalculée.
        if (c.seasonNumber === null && members.length > 0) c.seasonNumber = members.length + 1
        fresh.push([newMedia, c])
      }
    }
  }

  const desc = (list: [number, CardModel][]) => list.sort((a, b) => b[0] - a[0]).map(([, c]) => c)
  return {
    toWatch: [
      ...desc(current),
      ...fresh.sort((a, b) => compareByStart(a[0], b[0])).map(([, c]) => c),
      ...desc(planning),
    ],
    completed: desc(completed),
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
