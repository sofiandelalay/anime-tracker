/** Orchestration réseau + cache de « Pour toi » ; le calcul lui-même est dans recommend.ts (pur). */
import { fetchDiscovery, fetchMediaByIds, fetchRecommendations, fetchRoots, fetchSeasonPage, ROOT_MAX_AGE } from '../api/media'
import { cacheDb } from '../db/cacheDb'
import { db } from '../db/trackerDb'
import { displayTitle } from './format'
import {
  buildExclusions, buildProfile, COLD_START_RATINGS, coldSuggestions, implicitRatings, knownAnimeCount, MAX_SUGGESTIONS, pickLiked, rankSuggestions, realRatings,
  ratingsSignature, topGenres, type RatedAnime, type Suggestion,
} from './recommend'
import { seasonOf } from './seasons'
import { HOUR, type Franchise, type Media } from './types'

export const SUGGESTIONS_TTL = 24 * HOUR
/** v2 : suggestions par anime global ; les anciennes, par saison, sont recalculées. */
export const SUGGESTIONS_KEY = 'foryou-v2'
/** On garde de la réserve : un ajout ou un « Pas pour moi » fait remonter la suivante, sans recalcul. */
const STORED_SUGGESTIONS = MAX_SUGGESTIONS * 3
const SHORTLIST = 150

export interface SuggestionSet {
  signature: string
  cold: boolean
  items: Suggestion[]
}

/** Titre de la première saison de chaque anime aimé : « Parce que tu as aimé X » parle de l'anime. */
async function animeTitles(ids: number[], franchises: Franchise[]): Promise<Map<number, string>> {
  const firstOf = new Map<number, number>()
  for (const f of franchises) {
    for (const id of f.mediaIds) if (f.mediaIds[0] !== undefined) firstOf.set(id, f.mediaIds[0])
  }
  const firsts = ids.map((id) => firstOf.get(id) ?? id)
  const media = await cacheDb.media.bulkGet(firsts)
  return new Map(ids.flatMap((id, i) => (media[i] ? [[id, displayTitle(media[i])] as const] : [])))
}

/** Calcule les suggestions et les met en cache. Lève une erreur si le réseau manque. */
export async function computeSuggestions(opts: { force?: boolean } = {}, now = Date.now()): Promise<SuggestionSet> {
  const [entries, hidden] = await Promise.all([db.entries.toArray(), db.hidden.toArray()])
  const franchises = (await cacheDb.franchises.bulkGet([...new Set(entries.map((e) => e.franchiseId))])).filter((f): f is Franchise => !!f)
  const exclusions = buildExclusions(entries, franchises, hidden.map((h) => h.mediaId))
  const cached = new Map((await cacheDb.media.bulkGet(entries.map((e) => e.mediaId))).filter((m): m is Media => !!m).map((m) => [m.id, m]))
  const cold = knownAnimeCount(entries, cached) < COLD_START_RATINGS

  let items: Suggestion[]
  if (cold) {
    const { season, year } = seasonOf(new Date(now))
    const { media } = await fetchSeasonPage(season, year, 1)
    items = coldSuggestions(media, exclusions, STORED_SUGGESTIONS, await fetchRoots(media))
  } else {
    // Genres, tags et studios changent à peine : le cache de 30 j suffit, même avec des centaines d'animes vus.
    const media = await fetchMediaByIds(entries.map((e) => e.mediaId), { maxAge: ROOT_MAX_AGE })
    const rated: RatedAnime[] = [
      ...realRatings(entries, media),
      ...implicitRatings(entries, media, franchises),
    ]
    const liked = pickLiked(rated)
    const recommendations = await fetchRecommendations(liked.map((r) => r.media.id), opts)
    const discovery = await fetchDiscovery(topGenres(buildProfile(rated)), opts)
    const input = { rated, recommendations, discovery, exclusions }
    // On ne remonte les préquels que des mieux classés : les autres n'atteindraient pas l'écran.
    const shortlist = rankSuggestions({ ...input, limit: SHORTLIST }).map((s) => s.media)
    const sourceTitles = await animeTitles(liked.map((r) => r.media.id), franchises)
    items = rankSuggestions({ ...input, limit: STORED_SUGGESTIONS, roots: await fetchRoots(shortlist), sourceTitles })
  }

  const set: SuggestionSet = { signature: ratingsSignature(entries), cold, items }
  await cacheDb.kv.put({ key: SUGGESTIONS_KEY, value: set, fetchedAt: now })
  return set
}
