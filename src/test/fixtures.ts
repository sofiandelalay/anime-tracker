import type { RawMedia } from '../api/queries'
import type { Entry, EpisodeRanges, Media, Relation, Viewing } from '../domain/types'

export function media(id: number, over: Partial<Media> = {}): Media {
  return {
    id,
    title: { english: null, romaji: `Anime ${id}` },
    cover: null,
    color: null,
    format: 'TV',
    episodes: 12,
    duration: 24,
    status: 'FINISHED',
    season: null,
    seasonYear: 2000 + id,
    startDate: { year: 2000 + id, month: 1, day: 1 },
    nextAiring: null,
    genres: [],
    tags: [],
    studios: [],
    averageScore: null,
    popularity: null,
    relations: [],
    fetchedAt: 0,
    ...over,
  }
}

export const rel = (id: number, relationType: string, over: Partial<Relation> = {}): Relation => ({
  id, relationType, format: 'TV', status: 'FINISHED', ...over,
})

/** `watched` raccourcit le visionnage 1 : terminé si la saison l'est, sinon en cours. */
export function entry(mediaId: number, { watched, ...over }: Partial<Entry> & { watched?: EpisodeRanges } = {}): Entry {
  const done = over.status === 'COMPLETED'
  const viewings: Viewing[] = watched?.length || done
    ? [{ number: 1, watched: watched ?? [], startedAt: null, endedAt: null, state: done ? 'completed' : 'current' }]
    : []
  return {
    mediaId,
    franchiseId: mediaId,
    status: 'PLANNING',
    viewings,
    followed: true,
    score: null,
    addedAt: 0,
    startedAt: null,
    completedAt: null,
    updatedAt: 0,
    ...over,
  }
}

export function raw(id: number, over: Partial<RawMedia> = {}): RawMedia {
  return {
    id,
    type: 'ANIME',
    isAdult: false,
    title: { romaji: `Anime ${id}`, english: null },
    coverImage: { large: `https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/${id}.jpg`, medium: null, color: null },
    format: 'TV',
    episodes: 12,
    duration: 24,
    status: 'FINISHED',
    season: 'SPRING',
    seasonYear: 2020,
    startDate: { year: 2020, month: 4, day: 1 },
    nextAiringEpisode: null,
    genres: ['Drama'],
    tags: [],
    studios: { nodes: [] },
    averageScore: 80,
    popularity: 1000,
    relations: { edges: [] },
    ...over,
  }
}

export const mediaMap = (...list: Media[]) => new Map(list.map((m) => [m.id, m]))
