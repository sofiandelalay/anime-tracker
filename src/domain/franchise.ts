import { compareByStart } from './format'
import type { Media, MediaFormat } from './types'

/** Formats comptés dans la progression d'une franchise. */
export const PROGRESS_FORMATS: ReadonlySet<MediaFormat> = new Set<MediaFormat>(['TV', 'TV_SHORT', 'ONA'])
const CHAIN_RELATIONS = new Set(['SEQUEL', 'PREQUEL'])
const MAX_NODES = 40

export const countsForProgress = (m: Pick<Media, 'format'>): boolean =>
  m.format !== null && PROGRESS_FORMATS.has(m.format)

export type MediaLoader = (ids: number[]) => Promise<Map<number, Media>>

export interface FranchiseResult {
  /** Fiche la plus ancienne de la chaîne. */
  id: number
  /** Saisons (TV, TV_SHORT, ONA) triées par date de début. */
  mediaIds: number[]
}

/**
 * Parcourt les relations SEQUEL / PREQUEL à partir d'une fiche.
 * Les films / OVA / spéciaux sont traversés (pour relier S1 → film → S2)
 * mais exclus de la liste des saisons. Les fiches sont chargées par niveau, en lot.
 */
export async function buildFranchise(start: Media, load: MediaLoader): Promise<FranchiseResult> {
  if (!countsForProgress(start)) return { id: start.id, mediaIds: [start.id] }

  const seen = new Map<number, Media>([[start.id, start]])
  const queued = new Set<number>([start.id])
  let frontier = neighbours(start, queued)

  while (frontier.length > 0 && seen.size < MAX_NODES) {
    frontier = frontier.slice(0, MAX_NODES - seen.size)
    const loaded = await load(frontier)
    const next: number[] = []
    for (const id of frontier) {
      const m = loaded.get(id)
      if (!m) continue
      seen.set(id, m)
      next.push(...neighbours(m, queued))
    }
    frontier = next
  }

  const members = [...seen.values()].filter(countsForProgress).sort(compareByStart)
  const first = members[0] ?? start
  return { id: first.id, mediaIds: members.map((m) => m.id) }
}

function neighbours(m: Media, queued: Set<number>): number[] {
  const out: number[] = []
  for (const r of m.relations) {
    if (!CHAIN_RELATIONS.has(r.relationType) || queued.has(r.id)) continue
    queued.add(r.id)
    out.push(r.id)
  }
  return out
}

/** Saison suivante dans la franchise (ou null). */
export function nextInFranchise(mediaIds: number[], mediaId: number): number | null {
  const i = mediaIds.indexOf(mediaId)
  return i >= 0 && i + 1 < mediaIds.length ? mediaIds[i + 1]! : null
}

/** Numéro de saison (1, 2, …) ou null si la franchise n'a qu'une saison. */
export function seasonNumber(mediaIds: number[] | undefined, mediaId: number): number | null {
  if (!mediaIds || mediaIds.length < 2) return null
  const i = mediaIds.indexOf(mediaId)
  return i >= 0 ? i + 1 : null
}
