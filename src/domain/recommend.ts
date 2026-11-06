/**
 * Algorithme de « Pour toi » : module pur, aucun appel réseau ni accès à la base.
 * Les données (notes, recommandations AniList, découverte) lui sont passées en entrée.
 */
import { displayTitle, genreLabel } from './format'
import type { RootInfo } from './franchise'
import { animeState } from './listModel'
import { isReleased } from './progress'
import { hasTicked, timesSeen } from './viewings'
import type { Entry, Franchise, Media } from './types'

export const LIKED_SCORE = 4
export const MIN_LIKED = 3
export const FALLBACK_LIKED = 5
export const MIN_TAG_RANK = 60
export const COLD_START_RATINGS = 3
export const MAX_SUGGESTIONS = 20
export const COLD_REASON = 'Populaire cette saison'
export const COLD_SEQUEL_REASON = 'Nouvelle saison en ce moment'
const FALLBACK_REASON = 'Très bien noté sur AniList'
export const IMPLICIT_WEIGHT = 0.5
export const IMPLICIT_ARCHIVED = 2
/** Terminé sans note, selon le nombre de visionnages : note implicite et poids. */
export function implicitTier(viewings: number): { score: number; weight: number } {
  if (viewings >= 3) return { score: 4.5, weight: 1 }
  if (viewings === 2) return { score: 4.5, weight: 0.75 }
  return { score: 4, weight: IMPLICIT_WEIGHT }
}
const REWATCH_BONUS = 0.25
const REWATCH_CAP = 1.75
/** Multiplicateur d'un anime noté et revu : 1 + 0,25 × (visionnages - 1), plafonné à 1,75. */
export const rewatchMultiplier = (viewings: number): number => Math.min(REWATCH_CAP, 1 + REWATCH_BONUS * (Math.max(1, viewings) - 1))
/** Sans vraie note, ma moyenne n'existe pas : on prend le milieu de l'échelle. */
const NEUTRAL_MEAN = 3
/**
 * Terminés sans note utilisés comme sources de recommandations : les plus récents. Rattraper 200 animes vus
 * coûterait sinon 25 requêtes par jour ; les autres comptent quand même dans le profil.
 */
export const MAX_IMPLICIT_SOURCES = 40

/** Ma note moyenne : mes vraies notes seulement. */
function realMean(rated: RatedAnime[]): number {
  const real = rated.filter((r) => !r.implicit)
  return real.length > 0 ? real.reduce((sum, r) => sum + r.score, 0) / real.length : NEUTRAL_MEAN
}

/**
 * Poids d'une note dans le calcul (la note elle-même ne change pas). Le multiplicateur ne s'applique que si l'anime
 * et cette saison sont notés au moins à ma moyenne : un anime mal noté mais revu ne renforce pas un signal négatif.
 */
function weightOf(r: RatedAnime, mean: number): number {
  if (r.implicit) return r.weight ?? IMPLICIT_WEIGHT
  return (r.animeScore ?? r.score) >= mean && r.score >= mean ? rewatchMultiplier(r.viewings ?? 1) : 1
}

const groupByFranchise = (entries: Entry[]) => {
  const groups = new Map<number, Entry[]>()
  for (const e of entries) groups.set(e.franchiseId, [...(groups.get(e.franchiseId) ?? []), e])
  return groups
}

/** Visionnages d'un anime : le plus grand nombre de visionnages terminés parmi ses saisons. Les interrompus ne comptent pas. */
export const animeViewings = (group: Entry[]): number => Math.max(0, ...group.map(timesSeen))

/** Toutes les saisons sorties ont été vues, même si un revisionnage est en cours. */
function isAnimeSeen(group: Entry[], media: Map<number, Media>): boolean {
  const state = animeState(group, media)
  if (state.archived) return false
  if (state.complete || state.newSeason) return true
  const released = group.filter((e) => {
    const m = media.get(e.mediaId)
    return !!m && isReleased(m)
  })
  return released.length > 0 && released.every((e) => e.status === 'COMPLETED' || timesSeen(e) > 0)
}

/** Mes vraies notes, avec ce qu'il faut pour calculer leur poids : les visionnages et la note de l'anime. */
export function realRatings(entries: Entry[], media: Map<number, Media>): RatedAnime[] {
  return [...groupByFranchise(entries).values()].flatMap((group) => {
    const scored = group.filter((e) => e.score !== null)
    const animeScore = scored.reduce((sum, e) => sum + e.score!, 0) / Math.max(1, scored.length)
    const viewings = animeViewings(group)
    return scored.flatMap((e) => {
      const m = media.get(e.mediaId)
      return m ? [{ media: m, score: e.score!, viewings, animeScore }] : []
    })
  })
}

/**
 * Notes implicites, à l'échelle de l'anime (représenté par sa première saison). Terminé sans aucune note : selon ses
 * visionnages (`implicitTier`). Archivé sans aucune note : 2, profil seulement. En cours ou mis de côté : rien.
 * Une vraie note les remplace.
 */
export function implicitRatings(entries: Entry[], media: Map<number, Media>, franchises: Iterable<Franchise>): RatedAnime[] {
  const known = new Map([...franchises].map((f) => [f.id, f]))
  const done: { rating: RatedAnime; at: number }[] = []
  const archived: RatedAnime[] = []
  for (const [franchiseId, group] of groupByFranchise(entries)) {
    if (group.some((e) => e.score !== null)) continue
    const state = animeState(group, media)
    if (!state.archived && !isAnimeSeen(group, media)) continue
    const root = known.get(franchiseId)?.mediaIds.map((id) => media.get(id)).find(Boolean)
      ?? group.map((e) => media.get(e.mediaId)).find(Boolean)
    if (!root) continue
    if (state.archived) archived.push({ media: root, score: IMPLICIT_ARCHIVED, implicit: true, profileOnly: true })
    else {
      const viewings = Math.max(1, animeViewings(group))
      done.push({
        rating: { media: root, ...implicitTier(viewings), implicit: true, viewings },
        at: Math.max(...group.map((e) => e.completedAt ?? e.updatedAt)),
      })
    }
  }
  // Un anime revu passe avant les autres, puis les plus récents.
  done.sort((x, y) => (y.rating.viewings ?? 1) - (x.rating.viewings ?? 1) || y.at - x.at)
  return [
    ...done.map(({ rating }, i) => (i < MAX_IMPLICIT_SOURCES ? rating : { ...rating, profileOnly: true })),
    ...archived,
  ]
}

/** Démarrage à froid : combien d'animes sont notés ou terminés. */
export function knownAnimeCount(entries: Entry[], media: Map<number, Media>): number {
  return [...groupByFranchise(entries).values()].filter((group) => {
    return group.some((e) => e.score !== null) || isAnimeSeen(group, media)
  }).length
}

const WEIGHT_A = 0.55
const WEIGHT_B = 0.35
const WEIGHT_AVERAGE = 0.1
const WEIGHT_GENRES = 0.4
const WEIGHT_TAGS = 0.35
const WEIGHT_STUDIOS = 0.25

export interface RatedAnime {
  media: Media
  score: number
  /** Note implicite, jamais affichée : déduite d'un anime terminé ou archivé sans note. */
  implicit?: boolean
  /** Poids d'une note implicite (0,5 par défaut). */
  weight?: number
  /** Visionnages de l'anime (1 par défaut). */
  viewings?: number
  /** Note de l'anime entier : la moyenne de ses saisons notées. */
  animeScore?: number
  /** Ne sert qu'au profil maison (source B), pas aux recommandations (source A). */
  profileOnly?: boolean
}

export interface Recommendation {
  media: Media
  rating: number
}

export interface Profile {
  genres: Map<string, number>
  tags: Map<string, number>
  studios: Map<string, number>
  /** Nombre de mes animes notés par genre, pour départager des poids égaux. */
  genreCounts: Map<string, number>
}

export interface Exclusions {
  /** Ma liste (tous statuts) et toutes les saisons des franchises que je suis. */
  followed: Set<number>
  hidden: Set<number>
}

export interface Suggestion {
  media: Media
  reason: string
  score: number
}

export interface RankInput {
  rated: RatedAnime[]
  /** Par anime aimé (id), ses recommandations AniList. */
  recommendations: Map<number, Recommendation[]>
  /** Candidats supplémentaires : populaires de mes genres préférés. */
  discovery: Media[]
  exclusions: Exclusions
  limit?: number
  /**
   * L'anime global de chaque candidat : les saisons d'un même anime fusionnent en une seule suggestion.
   * Un candidat absent de cette table est ignoré.
   */
  roots?: Map<number, RootInfo>
  /** Titre à citer pour un anime aimé (celui de l'anime, pas de sa saison 3). */
  sourceTitles?: Map<number, string>
}

/** Animes « aimés » : notés 4 étoiles ou plus ; s'il y en a moins de 3, mes 5 mieux notés. */
export function pickLiked(rated: RatedAnime[]): RatedAnime[] {
  const usable = rated.filter((r) => !r.profileOnly)
  const liked = usable.filter((r) => r.score >= LIKED_SCORE)
  if (liked.length >= MIN_LIKED) return liked
  const mean = realMean(rated)
  return [...usable].sort((a, b) => b.score - a.score || weightOf(b, mean) - weightOf(a, mean) || a.media.id - b.media.id).slice(0, FALLBACK_LIKED)
}

const relevantTags = (m: Media): string[] => m.tags.filter((t) => t.rank >= MIN_TAG_RANK).map((t) => t.name)

/** Ramène les poids d'une famille entre -1 et 1. */
function normalizeWeights(weights: Map<string, number>): Map<string, number> {
  const max = Math.max(0, ...[...weights.values()].map(Math.abs))
  return new Map([...weights].map(([k, v]) => [k, max > 0 ? v / max : 0]))
}

/** Profil maison : poids de chaque élément = somme de (ma note - ma note moyenne). */
export function buildProfile(rated: RatedAnime[]): Profile {
  const mean = realMean(rated)
  const genres = new Map<string, number>()
  const tags = new Map<string, number>()
  const studios = new Map<string, number>()
  const genreCounts = new Map<string, number>()
  const add = (family: Map<string, number>, name: string, delta: number) => family.set(name, (family.get(name) ?? 0) + delta)
  for (const r of rated) {
    const { media, score } = r
    const delta = weightOf(r, mean) * (score - mean)
    for (const g of media.genres) {
      add(genres, g, delta)
      add(genreCounts, g, 1)
    }
    for (const t of relevantTags(media)) add(tags, t, delta)
    for (const s of media.studios) add(studios, s, delta)
  }
  return { genres: normalizeWeights(genres), tags: normalizeWeights(tags), studios: normalizeWeights(studios), genreCounts }
}

/** Mes genres préférés (jamais un genre de poids négatif). */
export function topGenres(profile: Profile, count = 3): string[] {
  return [...profile.genres]
    .filter(([, w]) => w >= 0)
    .sort((a, b) => b[1] - a[1] || (profile.genreCounts.get(b[0]) ?? 0) - (profile.genreCounts.get(a[0]) ?? 0) || a[0].localeCompare(b[0]))
    .slice(0, count)
    .map(([g]) => g)
}

/** Somme des poids des éléments, divisée par la racine de leur nombre. */
function familyScore(items: string[], weights: Map<string, number>): number {
  if (items.length === 0) return 0
  return items.reduce((sum, item) => sum + (weights.get(item) ?? 0), 0) / Math.sqrt(items.length)
}

export function buildExclusions(entries: Entry[], franchises: Iterable<Franchise>, hiddenIds: Iterable<number>): Exclusions {
  const followed = new Set(entries.map((e) => e.mediaId))
  const mine = new Set(entries.map((e) => e.franchiseId))
  for (const f of franchises) {
    if (mine.has(f.id) || f.mediaIds.some((id) => followed.has(id))) f.mediaIds.forEach((id) => followed.add(id))
  }
  return { followed, hidden: new Set(hiddenIds) }
}

const CHAIN = new Set(['SEQUEL', 'PREQUEL'])

/**
 * Déjà suivi (même si la franchise n'est pas encore en cache : une relation directe suffit),
 * masqué ou pas encore sorti. Le contenu adulte est écarté dès la réception (`toMedia`).
 */
export function isExcluded(m: Media, ex: Exclusions): boolean {
  return (
    ex.followed.has(m.id) ||
    ex.hidden.has(m.id) ||
    m.status === 'NOT_YET_RELEASED' ||
    m.relations.some((r) => CHAIN.has(r.relationType) && ex.followed.has(r.id))
  )
}

/** L'anime à proposer pour ce candidat, ou null s'il est exclu (lui, un de ses préquels ou l'anime lui-même). */
function globalAnime(m: Media, ex: Exclusions, roots?: Map<number, RootInfo>): Media | null {
  if (isExcluded(m, ex)) return null
  if (!roots) return m
  const info = roots.get(m.id)
  if (!info || info.chain.some((id) => ex.followed.has(id) || ex.hidden.has(id))) return null
  return isExcluded(info.root, ex) ? null : info.root
}

interface Candidate {
  media: Media
  a: number
  bestSource: { title: string; contribution: number; verb: 'aimé' | 'vu' | 'revu' } | null
  genres: number
  tags: number
  studios: number
  b: number
}

function minMax(values: number[]) {
  const min = Math.min(...values)
  const range = Math.max(...values) - min
  return { range, norm: (v: number) => (range > 0 ? (v - min) / range : 0) }
}

const positives = (items: string[], weights: Map<string, number>) =>
  items
    .filter((i) => (weights.get(i) ?? 0) > 0)
    .sort((x, y) => (weights.get(y) ?? 0) - (weights.get(x) ?? 0) || x.localeCompare(y))

/** Revu dès 2 visionnages ; sans note, on ne prête pas d'avis : « vu » et non « aimé ». */
const sourceVerb = (r: RatedAnime): 'aimé' | 'vu' | 'revu' => ((r.viewings ?? 1) >= 2 ? 'revu' : r.implicit ? 'vu' : 'aimé')

/** La raison la plus forte : chaque piste est comparée selon sa part réelle dans le score final. */
function explain(c: Candidate, rangeA: number, rangeB: number, profile: Profile): string {
  const options: { strength: number; text: string }[] = []
  if (c.bestSource && c.bestSource.contribution > 0) {
    const strength = rangeA > 0 ? (WEIGHT_A * c.bestSource.contribution) / rangeA : 0
    options.push({ strength, text: `Parce que tu as ${c.bestSource.verb} ${c.bestSource.title}` })
  }
  const studios = positives(c.media.studios, profile.studios)
  if (studios[0] && c.studios > 0) {
    const strength = rangeB > 0 ? (WEIGHT_B * WEIGHT_STUDIOS * c.studios) / rangeB : 0
    options.push({ strength, text: `Du studio ${studios[0]}, que tu notes bien` })
  }
  const genres = positives(c.media.genres, profile.genres)
  if (genres[0] && c.genres > 0) {
    const strength = rangeB > 0 ? (WEIGHT_B * WEIGHT_GENRES * c.genres) / rangeB : 0
    options.push({ strength, text: `Genres que tu aimes : ${genres.slice(0, 2).map(genreLabel).join(', ')}` })
  }
  // À égalité (ou scores tous identiques), la recommandation d'un anime aimé reste la plus parlante.
  return options.reduce<(typeof options)[number] | null>((best, o) => (!best || o.strength > best.strength ? o : best), null)?.text ?? FALLBACK_REASON
}

/** Classement final : 0,55 × A + 0,35 × B + 0,10 × note moyenne AniList, chacun normalisé entre 0 et 1. */
export function rankSuggestions({ rated, recommendations, discovery, exclusions, limit = MAX_SUGGESTIONS, roots, sourceTitles }: RankInput): Suggestion[] {
  const profile = buildProfile(rated)
  const meanScore = realMean(rated)
  const shown = (m: Media) => globalAnime(m, exclusions, roots)
  const candidates = new Map<number, Candidate>()
  const candidate = (media: Media): Candidate => {
    let c = candidates.get(media.id)
    if (!c) {
      const genres = familyScore(media.genres, profile.genres)
      const tags = familyScore(relevantTags(media), profile.tags)
      const studios = familyScore(media.studios, profile.studios)
      c = {
        media, a: 0, bestSource: null, genres, tags, studios,
        b: WEIGHT_GENRES * genres + WEIGHT_TAGS * tags + WEIGHT_STUDIOS * studios,
      }
      candidates.set(media.id, c)
    }
    return c
  }

  for (const liked of pickLiked(rated)) {
    const { media: source, score } = liked
    // Un même anime aimé qui recommande deux saisons d'un même anime ne compte qu'une fois : la meilleure.
    const best = new Map<number, { media: Media; rating: number }>()
    for (const { media, rating } of recommendations.get(source.id) ?? []) {
      const target = shown(media)
      if (!target) continue
      const known = best.get(target.id)
      if (!known || rating > known.rating) best.set(target.id, { media: target, rating })
    }
    for (const { media, rating } of best.values()) {
      const c = candidate(media)
      // AniList peut renvoyer un rating négatif : log(1 + r) n'aurait alors plus de sens.
      // Une note sous 3 retire des points : le multiplicateur ne doit pas en retirer davantage.
      const contribution = (score > 3 ? weightOf(liked, meanScore) : 1) * (score - 3) * Math.log(1 + Math.max(0, rating))
      c.a += contribution
      if (!c.bestSource || contribution > c.bestSource.contribution) {
        c.bestSource = { title: sourceTitles?.get(source.id) ?? displayTitle(source), contribution, verb: sourceVerb(liked) }
      }
    }
  }
  for (const media of discovery) {
    const target = shown(media)
    if (target) candidate(target)
  }

  const list = [...candidates.values()]
  if (list.length === 0) return []
  const a = minMax(list.map((c) => c.a))
  const b = minMax(list.map((c) => c.b))
  const avg = minMax(list.map((c) => c.media.averageScore ?? 0))

  return list
    .map((c) => ({
      media: c.media,
      reason: explain(c, a.range, b.range, profile),
      score: WEIGHT_A * a.norm(c.a) + WEIGHT_B * b.norm(c.b) + WEIGHT_AVERAGE * avg.norm(c.media.averageScore ?? 0),
    }))
    .sort((x, y) => y.score - x.score || (y.media.popularity ?? 0) - (x.media.popularity ?? 0) || x.media.id - y.media.id)
    .slice(0, limit)
}

/** Démarrage à froid : les plus populaires de la saison, sans ce que j'ai déjà ou masqué. */
export function coldSuggestions(seasonMedia: Media[], exclusions: Exclusions, limit = MAX_SUGGESTIONS, roots?: Map<number, RootInfo>): Suggestion[] {
  const byId = new Map<number, Suggestion>()
  const sorted = [...seasonMedia].sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0))
  for (const m of sorted) {
    const media = globalAnime(m, exclusions, roots)
    if (media && !byId.has(media.id)) {
      byId.set(media.id, { media, reason: media.id === m.id ? COLD_REASON : COLD_SEQUEL_REASON, score: 0 })
    }
  }
  return [...byId.values()].slice(0, limit)
}

/** Change dès qu'une note change, qu'un anime est terminé ou archivé, ou revu une fois de plus : déclenche le recalcul. */
export function ratingsSignature(entries: Entry[]): string {
  const scores = entries.filter((e) => e.score !== null).map((e) => `${e.mediaId}:${e.score}`)
  const states = [...groupByFranchise(entries)].flatMap(([id, group]) => {
    if (group.some((e) => e.status === 'DROPPED')) return [`a${id}`]
    const done = group.filter((e) => e.status === 'COMPLETED').length
    if (done === 0) return []
    return group.every((e) => e.status === 'COMPLETED' || !hasTicked(e)) ? [`t${id}`] : []
  })
  // Un visionnage terminé de plus change le poids de l'anime.
  const seen = [...groupByFranchise(entries)].flatMap(([id, group]) => (animeViewings(group) >= 2 ? [`v${id}:${animeViewings(group)}`] : []))
  return [...scores, ...states, ...seen].sort().join('|')
}
