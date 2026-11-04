import type { AiringStatus, Media, MediaFormat } from '../domain/types'

// Jaquettes : tailles large / medium uniquement (jamais extraLarge).
const MEDIA_FIELDS = `
  id type isAdult
  title { romaji english }
  coverImage { large medium color }
  format episodes duration status season seasonYear
  startDate { year month day }
  nextAiringEpisode { episode airingAt }
  genres
  tags { name rank isAdult }
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

export interface RawMedia {
  id: number
  type: string | null
  isAdult: boolean | null
  title: { romaji: string | null; english: string | null }
  coverImage: { large: string | null; medium: string | null; color: string | null } | null
  format: MediaFormat | null
  episodes: number | null
  duration: number | null
  status: AiringStatus | null
  season: string | null
  seasonYear: number | null
  startDate: { year: number | null; month: number | null; day: number | null } | null
  nextAiringEpisode: { episode: number; airingAt: number } | null
  genres: string[] | null
  tags: { name: string; rank: number | null; isAdult: boolean | null }[] | null
  studios: { nodes: { name: string; isAnimationStudio: boolean }[] } | null
  averageScore: number | null
  popularity: number | null
  relations: {
    edges: { relationType: string; node: { id: number; type: string | null; format: MediaFormat | null; status: AiringStatus | null; isAdult: boolean | null } | null }[]
  } | null
}

export interface PageResponse {
  Page: { media: RawMedia[] }
}

/** Réduit une réponse AniList aux seuls champs utiles. Renvoie null pour le contenu adulte. */
export function toMedia(raw: RawMedia, fetchedAt: number): Media | null {
  if (raw.isAdult) return null
  return {
    id: raw.id,
    title: { english: raw.title.english, romaji: raw.title.romaji },
    cover: raw.coverImage?.large ?? raw.coverImage?.medium ?? null,
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
    tags: (raw.tags ?? []).filter((t) => !t.isAdult).map((t) => ({ name: t.name, rank: t.rank ?? 0 })),
    studios: (raw.studios?.nodes ?? []).filter((s) => s.isAnimationStudio).map((s) => s.name),
    averageScore: raw.averageScore,
    popularity: raw.popularity,
    relations: (raw.relations?.edges ?? [])
      .filter((e) => e.node && e.node.type === 'ANIME' && !e.node.isAdult)
      .map((e) => ({ id: e.node!.id, relationType: e.relationType, format: e.node!.format, status: e.node!.status })),
    fetchedAt,
  }
}
