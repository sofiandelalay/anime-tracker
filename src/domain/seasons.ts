import { countsForProgress } from './franchise'
import type { Entry, Media } from './types'

export type SeasonName = 'WINTER' | 'SPRING' | 'SUMMER' | 'FALL'

export interface SeasonRef {
  season: SeasonName
  year: number
}

const ORDER: SeasonName[] = ['WINTER', 'SPRING', 'SUMMER', 'FALL']
const LABEL: Record<SeasonName, string> = { WINTER: 'Hiver', SPRING: 'Printemps', SUMMER: 'Été', FALL: 'Automne' }

/** janv-mars = WINTER, avr-juin = SPRING, juil-sept = SUMMER, oct-déc = FALL. */
export const seasonOf = (date: Date): SeasonRef => ({
  season: ORDER[Math.floor(date.getMonth() / 3)]!,
  year: date.getFullYear(),
})

export function nextSeason({ season, year }: SeasonRef): SeasonRef {
  const i = ORDER.indexOf(season)
  return i === 3 ? { season: 'WINTER', year: year + 1 } : { season: ORDER[i + 1]!, year }
}

export const seasonLabel = ({ season, year }: SeasonRef): string => `${LABEL[season]} ${year}`
export const seasonKey = ({ season, year }: SeasonRef): string => `${season}-${year}`

export interface SeasonGrid {
  followed: Media[]
  others: Media[]
}

/**
 * Sépare les animes que je suis (en premier, le prochain épisode d'abord) du reste (ordre de popularité).
 * Mes animes viennent aussi de ma liste : ils s'affichent même s'ils sont loin dans le classement.
 * Saison en cours : on y ajoute ce que je suis encore en diffusion (série commencée une saison plus tôt).
 */
export function buildSeasonGrid(pages: Media[], entries: Entry[], library: Map<number, Media>, ref: SeasonRef, isCurrent: boolean): SeasonGrid {
  const followedIds = new Set(entries.filter((e) => e.followed && e.status !== 'DROPPED').map((e) => e.mediaId))
  const fromPages = new Map(pages.map((m) => [m.id, m]))
  const followed: Media[] = []
  for (const id of followedIds) {
    const paged = fromPages.get(id)
    const cached = library.get(id)
    const m = paged && (!cached || paged.fetchedAt >= cached.fetchedAt) ? paged : cached
    if (!m) continue
    const inSeason = m.season === ref.season && m.seasonYear === ref.year
    if (paged || (countsForProgress(m) && (inSeason || (isCurrent && m.status === 'RELEASING')))) followed.push(m)
  }
  followed.sort(
    (a, b) =>
      (a.nextAiring?.airingAt ?? Number.POSITIVE_INFINITY) - (b.nextAiring?.airingAt ?? Number.POSITIVE_INFINITY) ||
      (b.popularity ?? 0) - (a.popularity ?? 0),
  )
  return { followed, others: pages.filter((m) => !followedIds.has(m.id)) }
}
