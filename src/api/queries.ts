import { MIN_TAG_RANK } from '../domain/recommend'
import type { AiringStatus, Media, MediaFormat } from '../domain/types'

// Jaquettes : tailles large / medium uniquement (jamais extraLarge).
const MEDIA_FIELDS = `
  id idMal type isAdult
  title { romaji english }
  coverImage { large medium color }
  bannerImage
  format episodes duration status season seasonYear
  startDate { year month day }
  nextAiringEpisode { episode airingAt }
  genres
  tags { name rank isAdult isGeneralSpoiler isMediaSpoiler }
  studios(isMain: true) { nodes { name isAnimationStudio } }
  averageScore popularity
  relations { edges { relationType node { id type format status isAdult } } }
`

export const MEDIA_BY_IDS = `query ($ids: [Int], $perPage: Int) {
  Page(page: 1, perPage: $perPage) {
    media(id_in: $ids, type: ANIME, isAdult: false) { ${MEDIA_FIELDS} }
  }
}`

export const SEARCH = `query ($search: String) {
  Page(page: 1, perPage: 20) {
    media(search: $search, type: ANIME, isAdult: false, sort: [SEARCH_MATCH, POPULARITY_DESC]) { ${MEDIA_FIELDS} }
  }
}`

export const SEASON_PAGE = `query ($season: MediaSeason, $year: Int, $page: Int, $perPage: Int) {
  Page(page: $page, perPage: $perPage) {
    pageInfo { hasNextPage }
    media(season: $season, seasonYear: $year, type: ANIME, isAdult: false, format_in: [TV, TV_SHORT, ONA], sort: POPULARITY_DESC) { ${MEDIA_FIELDS} }
  }
}`

export const STREAMING_EPISODES = `query ($id: Int) {
  Media(id: $id, type: ANIME) { streamingEpisodes { title thumbnail } }
}`

export const SYNOPSIS = `query ($id: Int) {
  Media(id: $id, type: ANIME) { description(asHtml: false) }
}`

/**
 * Découverte : un alias par genre, dans une seule requête
 * (`genre_in` d'AniList exige TOUS les genres, ce n'est pas un OU).
 */
export function discoveryQuery(genreCount: number): string {
  const vars = Array.from({ length: genreCount }, (_, i) => `$g${i}: String`).join(', ')
  const pages = Array.from({ length: genreCount }, (_, i) => `g${i}: Page(page: 1, perPage: 25) {
    media(genre: $g${i}, type: ANIME, isAdult: false, startDate_greater: $since, format_in: [TV, TV_SHORT, ONA], status_not: NOT_YET_RELEASED, sort: POPULARITY_DESC) { ${MEDIA_FIELDS} }
  }`).join('\n')
  return `query ($since: FuzzyDateInt, ${vars}) { ${pages} }`
}

/** Recommandations groupées par alias (AniList : complexité 51 par alias, maximum 500). */
export function recommendationsQuery(ids: number[]): string {
  const aliases = ids.map(
    (id, i) => `m${i}: Media(id: ${id}, type: ANIME) { id recommendations(sort: RATING_DESC, perPage: 10) { nodes { rating mediaRecommendation { ...F } } } }`,
  )
  return `query { ${aliases.join('\n')} }\nfragment F on Media { ${MEDIA_FIELDS} }`
}

export interface RawRecommendations {
  id: number
  recommendations: { nodes: { rating: number | null; mediaRecommendation: RawMedia | null }[] } | null
}

export interface RecItem {
  media: Media
  rating: number
}

/** Réduit la réponse à alias : par fiche source, ses recommandations (hors contenu adulte). */
export function parseRecommendations(data: Record<string, RawRecommendations | null>, fetchedAt: number): Map<number, RecItem[]> {
  const out = new Map<number, RecItem[]>()
  for (const source of Object.values(data)) {
    if (!source) continue
    const items: RecItem[] = []
    for (const node of source.recommendations?.nodes ?? []) {
      const media = node.mediaRecommendation ? toMedia(node.mediaRecommendation, fetchedAt) : null
      if (media) items.push({ media, rating: node.rating ?? 0 })
    }
    out.set(source.id, items)
  }
  return out
}

export interface RawMedia {
  id: number
  idMal?: number | null
  type: string | null
  isAdult: boolean | null
  title: { romaji: string | null; english: string | null }
  coverImage: { large: string | null; medium: string | null; color: string | null } | null
  bannerImage?: string | null
  format: MediaFormat | null
  episodes: number | null
  duration: number | null
  status: AiringStatus | null
  season: string | null
  seasonYear: number | null
  startDate: { year: number | null; month: number | null; day: number | null } | null
  nextAiringEpisode: { episode: number; airingAt: number } | null
  genres: string[] | null
  tags: { name: string; rank: number | null; isAdult: boolean | null; isGeneralSpoiler?: boolean | null; isMediaSpoiler?: boolean | null }[] | null
  studios: { nodes: { name: string; isAnimationStudio: boolean }[] } | null
  averageScore: number | null
  popularity: number | null
  relations: {
    edges: { relationType: string; node: { id: number; type: string | null; format: MediaFormat | null; status: AiringStatus | null; isAdult: boolean | null } | null }[]
  } | null
}

export interface PageResponse {
  Page: { pageInfo?: { hasNextPage: boolean | null }; media: RawMedia[] }
}
/**
 * Réduit une réponse AniList aux seuls champs utiles (tags : ni spoilers, ni rang < 60).
 * Renvoie null pour le contenu adulte.
 */
export function toMedia(raw: RawMedia, fetchedAt: number): Media | null {
  if (raw.isAdult) return null
  return {
    id: raw.id,
    idMal: raw.idMal ?? null,
    title: { english: raw.title.english, romaji: raw.title.romaji },
    cover: raw.coverImage?.large ?? raw.coverImage?.medium ?? null,
    banner: raw.bannerImage ?? null,
    color: raw.coverImage?.color ?? null,
    format: raw.format,
    episodes: raw.episodes,
    duration: raw.duration,
    status: raw.status,
    season: raw.season,
    seasonYear: raw.seasonYear,
    startDate: {
      year: raw.startDate?.year ?? null,
      month: raw.startDate?.month ?? null,
      day: raw.startDate?.day ?? null,
    },
    nextAiring: raw.nextAiringEpisode
      ? { episode: raw.nextAiringEpisode.episode, airingAt: raw.nextAiringEpisode.airingAt }
      : null,
    genres: raw.genres ?? [],
    tags: (raw.tags ?? [])
      .filter((t) => !t.isAdult && !t.isGeneralSpoiler && !t.isMediaSpoiler && (t.rank ?? 0) >= MIN_TAG_RANK)
      .map((t) => ({ name: t.name, rank: t.rank ?? 0 })),
    studios: (raw.studios?.nodes ?? []).filter((s) => s.isAnimationStudio).map((s) => s.name),
    averageScore: raw.averageScore,
    popularity: raw.popularity,
    relations: (raw.relations?.edges ?? [])
      .filter((e) => e.node && e.node.type === 'ANIME' && !e.node.isAdult)
      .map((e) => ({ id: e.node!.id, relationType: e.relationType, format: e.node!.format, status: e.node!.status })),
    fetchedAt,
  }
}
