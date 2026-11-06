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

/**
 * Charge d'un coup, niveau par niveau et par lots, toutes les fiches des chaînes de plusieurs animes.
 * Les `buildFranchise` qui suivent trouvent tout dans le cache au lieu de coûter chacun des requêtes.
 */
export async function preloadChains(list: Media[], load: MediaLoader, shouldStop?: () => boolean): Promise<Map<number, Media>> {
  const known = new Map(list.map((m) => [m.id, m]))
  const queued = new Set(known.keys())
  let frontier = list
  while (frontier.length > 0 && queued.size < MAX_NODES * Math.max(1, list.length) && !shouldStop?.()) {
    const ids = frontier.flatMap((m) => neighbours(m, queued))
    if (ids.length === 0) break
    frontier = [...(await load(ids)).values()]
    for (const m of frontier) known.set(m.id, m)
  }
  return known
}

export interface ChainSummary {
  seasons: number
  episodes: number
}

/** Nombre de saisons et d'épisodes d'un anime, à partir des fiches déjà chargées. */
export function summarizeChain(start: Media, known: Map<number, Media>): ChainSummary {
  const seen = new Set<number>([start.id])
  const stack = [start]
  const seasons: Media[] = []
  while (stack.length > 0) {
    const m = stack.pop()!
    if (countsForProgress(m)) seasons.push(m)
    for (const r of m.relations) {
      const next = known.get(r.id)
      if (CHAIN_RELATIONS.has(r.relationType) && next && !seen.has(r.id)) {
        seen.add(r.id)
        stack.push(next)
      }
    }
  }
  return { seasons: seasons.length, episodes: seasons.reduce((sum, m) => sum + (m.episodes ?? 0), 0) }
}

export interface RootInfo {
  /** Première saison : la fiche qui représente l'anime dans son ensemble. */
  root: Media
  /** La fiche de départ et tous ses préquels connus. */
  chain: number[]
}

/**
 * Remonte les PREQUEL de plusieurs fiches pour trouver l'anime « global » de chacune.
 * Un niveau = un seul appel à `load`, quel que soit le nombre de fiches.
 * Racine = la saison (TV, TV_SHORT, ONA) la plus ancienne ; sans saison dans la chaîne, la fiche la plus ancienne.
 */
export async function resolveRoots(list: Media[], load: MediaLoader): Promise<Map<number, RootInfo>> {
  const known = new Map(list.map((m) => [m.id, m]))
  const prequels = (m: Media) => m.relations.filter((r) => r.relationType === 'PREQUEL').map((r) => r.id)

  let frontier = list
  for (let depth = 0; depth < MAX_NODES && frontier.length > 0; depth++) {
    const ids = [...new Set(frontier.flatMap(prequels))].filter((id) => !known.has(id))
    if (ids.length === 0) break
    const loaded = await load(ids)
    frontier = ids.flatMap((id) => {
      const m = loaded.get(id)
      if (m) known.set(id, m)
      return m ? [m] : []
    })
  }

  const out = new Map<number, RootInfo>()
  for (const start of list) {
    const chain = new Map<number, Media>([[start.id, start]])
    const stack = [start]
    while (stack.length > 0) {
      for (const id of prequels(stack.pop()!)) {
        const m = known.get(id)
        if (m && !chain.has(id)) {
          chain.set(id, m)
          stack.push(m)
        }
      }
    }
    const all = [...chain.values()].sort(compareByStart)
    out.set(start.id, { root: all.find(countsForProgress) ?? all[0]!, chain: [...chain.keys()] })
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
