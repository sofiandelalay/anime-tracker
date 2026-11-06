import { describe, expect, it } from 'vitest'
import { parseRecommendations } from '../api/queries'
import {
  animeViewings, buildExclusions, buildProfile, realRatings, rewatchMultiplier, implicitRatings, knownAnimeCount, MAX_IMPLICIT_SOURCES, coldSuggestions, COLD_REASON, COLD_SEQUEL_REASON, isExcluded, MAX_SUGGESTIONS, pickLiked, rankSuggestions,
  ratingsSignature, topGenres, type RatedAnime, type RankInput,
} from '../domain/recommend'
import type { Viewing } from '../domain/types'
import { entry, media, raw, rel } from './fixtures'

const named = (id: number, name: string, over = {}) => media(id, { title: { english: name, romaji: null }, ...over })
const noExclusions = () => ({ followed: new Set<number>(), hidden: new Set<number>() })

function input(over: Partial<RankInput> = {}): RankInput {
  return { rated: [], recommendations: new Map(), discovery: [], exclusions: noExclusions(), ...over }
}

describe('animes aimés', () => {
  const rated = (scores: number[]): RatedAnime[] => scores.map((score, i) => ({ media: media(i + 1), score }))

  it('garde les notes de 4 étoiles ou plus', () => {
    expect(pickLiked(rated([5, 4, 4, 3, 2])).map((r) => r.score)).toEqual([5, 4, 4])
  })

  it('moins de 3 aimés : prend mes 5 mieux notés', () => {
    expect(pickLiked(rated([5, 3, 2, 3.5, 1, 2.5, 4])).map((r) => r.score)).toEqual([5, 4, 3.5, 3, 2.5])
  })
})

describe('profil maison', () => {
  const rated: RatedAnime[] = [
    { media: media(1, { genres: ['Drama'], tags: [{ name: 'Tragédie', rank: 90 }, { name: 'Faible', rank: 40 }], studios: ['Bones'] }), score: 5 },
    { media: media(2, { genres: ['Comedy'], tags: [{ name: 'Gags', rank: 70 }], studios: ['Trigger'] }), score: 1 },
    { media: media(3, { genres: ['Drama', 'Comedy'], studios: ['Bones'] }), score: 3 },
  ]

  it('pèse chaque élément par (note - moyenne), normalisé entre -1 et 1', () => {
    const p = buildProfile(rated)
    // Moyenne 3 : Drama = +2 + 0, Comedy = -2 + 0.
    expect(p.genres.get('Drama')).toBe(1)
    expect(p.genres.get('Comedy')).toBe(-1)
    expect(p.studios.get('Bones')).toBe(1)
    expect(p.studios.get('Trigger')).toBe(-1)
  })

  it('ignore les tags de rang inférieur à 60', () => {
    const p = buildProfile(rated)
    expect(p.tags.has('Tragédie')).toBe(true)
    expect(p.tags.has('Faible')).toBe(false)
  })

  it('les genres préférés excluent les poids négatifs', () => {
    expect(topGenres(buildProfile(rated))).toEqual(['Drama'])
  })

  it('notes toutes identiques : poids nuls, sans division par zéro', () => {
    const p = buildProfile(rated.map((r) => ({ ...r, score: 4 })))
    expect(p.genres.get('Drama')).toBe(0)
    expect(topGenres(p)[0]).toBeDefined()
  })
})

describe('exclusions', () => {
  const rated: RatedAnime[] = [
    { media: named(1, 'Aimé 1'), score: 5 },
    { media: named(2, 'Aimé 2'), score: 5 },
    { media: named(3, 'Aimé 3'), score: 4 },
  ]
  const entries = [entry(1, { franchiseId: 1, status: 'COMPLETED' }), entry(2, { franchiseId: 2, status: 'DROPPED' }), entry(3, { franchiseId: 3, status: 'PLANNING' })]

  it('écarte ma liste, ma franchise, les masqués, le non sorti', () => {
    const ok = media(50)
    const inList = media(1)
    const franchiseMember = media(20)
    const sequelOfMine = media(30, { relations: [rel(1, 'PREQUEL')] })
    const masked = media(40)
    const unreleased = media(41, { status: 'NOT_YET_RELEASED' })
    const exclusions = buildExclusions(entries, [{ id: 1, mediaIds: [1, 20], computedAt: 0 }], [40])

    const result = rankSuggestions(input({
      rated,
      exclusions,
      recommendations: new Map([[1, [inList, franchiseMember, sequelOfMine, masked, unreleased, ok].map((m) => ({ media: m, rating: 10 }))]]),
      discovery: [masked, unreleased, inList],
    }))
    expect(result.map((s) => s.media.id)).toEqual([50])
  })

  it('une relation autre que suite/préquel n’exclut pas', () => {
    const ex = buildExclusions(entries, [], [])
    expect(isExcluded(media(30, { relations: [rel(1, 'SIDE_STORY')] }), ex)).toBe(false)
  })

  it('contenu adulte : écarté dès la réception', () => {
    const parsed = parseRecommendations({
      m0: { id: 1, recommendations: { nodes: [
        { rating: 5, mediaRecommendation: raw(10, { isAdult: true }) },
        { rating: 5, mediaRecommendation: raw(11) },
        { rating: 5, mediaRecommendation: null },
      ] } },
    }, 0)
    expect(parsed.get(1)!.map((r) => r.media.id)).toEqual([11])
  })
})

describe('classement', () => {
  const rated: RatedAnime[] = [
    { media: named(1, 'Frieren', { genres: ['Fantasy'], studios: ['Madhouse'] }), score: 5 },
    { media: named(2, 'Monster', { genres: ['Drama'], studios: ['Madhouse'] }), score: 4 },
    { media: named(3, 'Raté', { genres: ['Sports'], studios: ['Nul'] }), score: 1 },
  ]

  it('additionne les recommandations de plusieurs animes aimés : (note - 3) × log(1 + rating)', () => {
    const both = media(10, { averageScore: 70 })
    const one = media(11, { averageScore: 70 })
    const result = rankSuggestions(input({
      rated,
      recommendations: new Map([
        [1, [{ media: both, rating: 10 }, { media: one, rating: 10 }]],
        [2, [{ media: both, rating: 10 }]],
      ]),
    }))
    expect(result.map((s) => s.media.id)).toEqual([10, 11])
    // A : 10 → 2·log(11) + 1·log(11) ; 11 → 2·log(11) ; normalisé min-max → 10 vaut 0,55 et 11 vaut 0.
    expect(result[0]!.score).toBeCloseTo(0.55)
    expect(result[1]!.score).toBeCloseTo(0)
  })

  it('respecte les poids 0,55 / 0,35 / 0,10', () => {
    const fromA = media(10, { averageScore: 50 })
    const fromB = media(11, { averageScore: 50, genres: ['Fantasy'], studios: ['Madhouse'] })
    const fromAverage = media(12, { averageScore: 90 })
    const result = rankSuggestions(input({
      rated,
      recommendations: new Map([[1, [{ media: fromA, rating: 50 }]]]),
      discovery: [fromB, fromAverage],
    }))
    expect(result.map((s) => s.media.id)).toEqual([10, 11, 12])
    expect(result[2]!.score).toBeCloseTo(0.1)
  })

  it('un rating négatif ne produit pas de NaN', () => {
    const result = rankSuggestions(input({ rated, recommendations: new Map([[1, [{ media: media(10), rating: -4 }]]]) }))
    expect(Number.isNaN(result[0]!.score)).toBe(false)
  })

  it('à score égal : le plus populaire d’abord', () => {
    const result = rankSuggestions(input({ rated, discovery: [media(10, { popularity: 5 }), media(11, { popularity: 50 })] }))
    expect(result.map((s) => s.media.id)).toEqual([11, 10])
  })

  it(`limite à ${MAX_SUGGESTIONS} suggestions`, () => {
    const discovery = Array.from({ length: 40 }, (_, i) => media(100 + i))
    expect(rankSuggestions(input({ rated, discovery }))).toHaveLength(MAX_SUGGESTIONS)
  })
})

describe('explication', () => {
  const rated: RatedAnime[] = [
    { media: named(1, 'Frieren', { genres: ['Fantasy', 'Adventure'], studios: ['Madhouse'] }), score: 5 },
    { media: named(2, 'Monster', { genres: ['Drama'], studios: ['Madhouse'] }), score: 4 },
    { media: named(3, 'Raté', { genres: ['Sports'], studios: ['Nul'] }), score: 1 },
  ]
  const reasonOf = (over: Partial<RankInput>, id: number) =>
    rankSuggestions(input({ rated, ...over })).find((s) => s.media.id === id)!.reason

  it('recommandation dominante : « Parce que tu as aimé X », avec le meilleur contributeur', () => {
    const c = media(10)
    const reason = reasonOf({
      recommendations: new Map([
        [2, [{ media: c, rating: 500 }]],
        [1, [{ media: c, rating: 500 }]],
      ]),
      discovery: [media(11)],
    }, 10)
    expect(reason).toBe('Parce que tu as aimé Frieren')
  })

  it('genres dominants : « Genres que tu aimes : A, B », traduits, les mieux pesés d’abord', () => {
    const reason = reasonOf({ discovery: [media(10, { genres: ['Adventure', 'Fantasy', 'Sports'] }), media(11)] }, 10)
    expect(reason).toBe('Genres que tu aimes : Aventure, Fantasy')
  })

  it('studio dominant : « Du studio Y, que tu notes bien »', () => {
    // Genre faiblement positif dilué (√4) face à un studio bien noté et seul de sa famille.
    const reason = reasonOf({ discovery: [media(10, { studios: ['Madhouse'], genres: ['Drama', 'X', 'Y', 'Z'] }), media(11)] }, 10)
    expect(reason).toBe('Du studio Madhouse, que tu notes bien')
  })

  it('n’invoque jamais un élément mal noté', () => {
    const reason = reasonOf({ discovery: [media(10, { genres: ['Sports'], studios: ['Nul'] }), media(11)] }, 10)
    expect(reason).toBe('Très bien noté sur AniList')
  })
})

describe('anime global', () => {
  const rated: RatedAnime[] = [
    { media: named(1, 'Frieren'), score: 5 },
    { media: named(2, 'Monster'), score: 5 },
    { media: named(3, 'Mushishi'), score: 5 },
  ]
  const s1 = named(10, 'Titans')
  const s2 = named(11, 'Titans Saison 2', { relations: [rel(10, 'PREQUEL')] })
  const s3 = named(12, 'Titans Saison 3', { relations: [rel(11, 'PREQUEL')] })
  const info = (root: typeof s1, ...chain: number[]) => ({ root, chain })
  const roots = new Map([[10, info(s1, 10)], [11, info(s1, 11, 10)], [12, info(s1, 12, 11, 10)]])

  it('propose la première saison à la place d’une suite, une seule fois', () => {
    const result = rankSuggestions(input({
      rated,
      roots,
      recommendations: new Map([[1, [{ media: s3, rating: 10 }, { media: s2, rating: 5 }]]]),
      discovery: [s2],
    }))
    expect(result.map((s) => s.media.id)).toEqual([10])
    expect(result[0]!.media.title.english).toBe('Titans')
  })

  it('deux saisons recommandées par le même anime aimé ne s’additionnent pas ; deux animes aimés, si', () => {
    const other = media(20)
    const sameSource = rankSuggestions(input({
      rated,
      roots: new Map([...roots, [20, info(other, 20)]]),
      recommendations: new Map([[1, [{ media: s2, rating: 10 }, { media: s3, rating: 10 }, { media: other, rating: 10 }]]]),
    }))
    // Même A pour les deux : aucune inflation due aux deux saisons.
    expect(sameSource.find((s) => s.media.id === 10)!.score).toBeCloseTo(sameSource.find((s) => s.media.id === 20)!.score)

    const twoSources = rankSuggestions(input({
      rated,
      roots: new Map([...roots, [20, info(other, 20)]]),
      recommendations: new Map([[1, [{ media: s2, rating: 10 }, { media: other, rating: 10 }]], [2, [{ media: s3, rating: 10 }]]]),
    }))
    expect(twoSources[0]!.media.id).toBe(10)
  })

  it('exclu si un préquel est suivi ou masqué, ou si la première saison l’est', () => {
    const run = (followed: number[], hidden: number[]) => rankSuggestions(input({
      rated, roots, discovery: [s3], exclusions: { followed: new Set(followed), hidden: new Set(hidden) },
    }))
    expect(run([], [])).toHaveLength(1)
    expect(run([11], [])).toHaveLength(0)
    expect(run([], [10])).toHaveLength(0)
    expect(run([10], [])).toHaveLength(0)
  })

  it('cite le titre de l’anime aimé, pas celui de sa saison', () => {
    const result = rankSuggestions(input({
      rated,
      roots: new Map([...roots, [20, info(media(20), 20)]]),
      recommendations: new Map([[1, [{ media: s1, rating: 10 }]]]),
      discovery: [media(20)],
      sourceTitles: new Map([[1, 'Frieren, tout entier']]),
    }))
    expect(result.find((s) => s.media.id === 10)!.reason).toBe('Parce que tu as aimé Frieren, tout entier')
  })

  it('démarrage à froid : une suite populaire est présentée par sa première saison', () => {
    const fresh = media(30, { popularity: 1 })
    const list = [{ ...s3, popularity: 100 }, { ...s2, popularity: 90 }, fresh]
    const result = coldSuggestions(list, noExclusions(), 20, new Map([...roots, [30, info(fresh, 30)]]))
    expect(result.map((s) => s.media.id)).toEqual([10, 30])
    expect(result[0]!.reason).toBe(COLD_SEQUEL_REASON)
    expect(result[1]!.reason).toBe(COLD_REASON)
  })
})

describe('notes implicites', () => {
  const lib = (...list: ReturnType<typeof media>[]) => new Map(list.map((m) => [m.id, m]))
  const done = (id: number, over = {}) => entry(id, { status: 'COMPLETED', watched: [[1, 12]], ...over })
  const dropped = (id: number, over = {}) => entry(id, { status: 'DROPPED', watched: [[1, 2]], ...over })
  const a = named(1, 'Vu', { genres: ['Drama'], studios: ['Bones'] })
  const b = named(2, 'Abandonné', { genres: ['Horror'], studios: ['Nul'] })

  it('anime terminé sans note : 4, poids 0,5, sources A et B', () => {
    expect(implicitRatings([done(1)], lib(a), [])).toEqual([{ media: a, score: 4, weight: 0.5, implicit: true, viewings: 1 }])
  })

  it('archivé sans note : 2, poids 0,5, source B seulement', () => {
    expect(implicitRatings([dropped(2)], lib(b), [])).toEqual([{ media: b, score: 2, implicit: true, profileOnly: true }])
  })

  it('en cours ou mis de côté sans note : ignoré', () => {
    expect(implicitRatings([entry(1, { status: 'CURRENT', watched: [[1, 2]] })], lib(a), [])).toEqual([])
    expect(implicitRatings([entry(1, { status: 'CURRENT', watched: [[1, 2]], followed: false })], lib(a), [])).toEqual([])
    expect(implicitRatings([entry(1)], lib(a), [])).toEqual([])
  })

  it('une vraie note remplace la note implicite, même sur une seule saison', () => {
    const s2 = media(3)
    const f = [{ id: 1, mediaIds: [1, 3], computedAt: 0 }]
    expect(implicitRatings([done(1), done(3, { franchiseId: 1 })], lib(a, s2), f)).toHaveLength(1)
    expect(implicitRatings([done(1), done(3, { franchiseId: 1, score: 2 })], lib(a, s2), f)).toEqual([])
  })

  it('un anime à plusieurs saisons compte une fois, par sa première saison', () => {
    const s2 = media(3)
    const out = implicitRatings([done(3, { franchiseId: 1 }), done(1)], lib(a, s2), [{ id: 1, mediaIds: [1, 3], computedAt: 0 }])
    expect(out.map((r) => r.media.id)).toEqual([1])
  })

  it('au-delà de 40 terminés, seuls les plus récents servent de sources ; tous comptent au profil', () => {
    const list = Array.from({ length: 45 }, (_, i) => media(100 + i))
    const entries = list.map((m, i) => done(m.id, { completedAt: i }))
    const out = implicitRatings(entries, lib(...list), [])
    expect(out).toHaveLength(45)
    expect(pickLiked(out)).toHaveLength(MAX_IMPLICIT_SOURCES)
    expect(pickLiked(out).some((r) => r.media.id === 144)).toBe(true)
    expect(pickLiked(out).some((r) => r.media.id === 100)).toBe(false)
  })

  it('la moyenne ne prend en compte que mes vraies notes', () => {
    const real = (id: number, score: number, genres: string[]) => ({ media: media(id, { genres }), score })
    const p = buildProfile([
      real(1, 5, ['Drama']),
      real(2, 3, ['Comedy']),
      { media: media(3, { genres: ['Sports'] }), score: 2, implicit: true, profileOnly: true },
    ])
    // Moyenne 4 (et non 3,33) : Drama +1, Comedy -1, Sports 0,5 × (2 - 4) = -1.
    expect(p.genres.get('Drama')).toBe(1)
    expect(p.genres.get('Comedy')).toBe(-1)
    expect(p.genres.get('Sports')).toBe(-1)
  })

  it('aucune vraie note : un terminé pèse pour, un archivé contre', () => {
    const p = buildProfile(implicitRatings([done(1), dropped(2)], lib(a, b), []))
    expect(p.genres.get('Drama')).toBe(1)
    expect(p.genres.get('Horror')).toBe(-1)
  })

  it('un anime terminé sans note influence le classement', () => {
    const rated = [
      { media: named(10, 'Noté 1', { genres: ['Comedy'] }), score: 3 },
      { media: named(11, 'Noté 2', { genres: ['Comedy'] }), score: 3 },
      { media: named(12, 'Noté 3', { genres: ['Comedy'] }), score: 3 },
    ]
    const sameGenre = media(20, { genres: ['Drama'], popularity: 1 })
    const other = media(21, { genres: ['Sports'], popularity: 2 })
    const discovery = [sameGenre, other]
    const without = rankSuggestions(input({ rated, discovery }))
    expect(without.map((s) => s.media.id)).toEqual([21, 20])
    const withSeen = rankSuggestions(input({ rated: [...rated, ...implicitRatings([done(1)], lib(a), [])], discovery }))
    expect(withSeen.map((s) => s.media.id)).toEqual([20, 21])
  })

  it('source A : la moitié d’une vraie note, et la raison dit « vu », pas « aimé »', () => {
    const c = media(20)
    const d = media(21)
    const recs = new Map([[1, [{ media: c, rating: 10 }]], [2, [{ media: d, rating: 10 }]], [3, [] as { media: typeof c; rating: number }[]]])
    const out = rankSuggestions(input({
      rated: [{ media: named(1, 'Sans note'), score: 4, implicit: true }, { media: named(2, 'Avec note'), score: 4 }, { media: named(3, 'Autre'), score: 4 }],
      recommendations: recs,
    }))
    expect(out.map((s) => s.media.id)).toEqual([21, 20])
    expect(out[0]!.reason).toBe('Parce que tu as aimé Avec note')
    expect(out[1]!.reason).toBe('Parce que tu as vu Sans note')
  })

  it('une vraie note remplace la note implicite dans le classement', () => {
    const rec = media(20)
    const others = [{ media: named(2, 'A'), score: 4 }, { media: named(3, 'B'), score: 4 }]
    const recs = new Map([[1, [{ media: rec, rating: 10 }]], [2, [{ media: media(21), rating: 10 }]]])
    const asImplicit = rankSuggestions(input({ rated: [{ media: named(1, 'X'), score: 4, implicit: true }, ...others], recommendations: recs }))
    const asReal = rankSuggestions(input({ rated: [{ media: named(1, 'X'), score: 5 }, ...others], recommendations: recs }))
    expect(asImplicit[0]!.media.id).toBe(21)
    expect(asReal[0]!.media.id).toBe(20)
    expect(asReal[0]!.reason).toBe('Parce que tu as aimé X')
  })

  it('un anime archivé sans note fait baisser les animes de mêmes genres, et n’est jamais une source', () => {
    const rated = [
      { media: named(10, 'Noté 1', { genres: ['Comedy'] }), score: 3 },
      { media: named(11, 'Noté 2', { genres: ['Comedy'] }), score: 3 },
      { media: named(12, 'Noté 3', { genres: ['Comedy'] }), score: 3 },
    ]
    const horror = media(20, { genres: ['Horror'], popularity: 50 })
    const other = media(21, { genres: ['Sports'], popularity: 1 })
    const discovery = [horror, other]
    expect(rankSuggestions(input({ rated, discovery })).map((s) => s.media.id)).toEqual([20, 21])
    const implicit = implicitRatings([dropped(2)], lib(b), [])
    expect(rankSuggestions(input({ rated: [...rated, ...implicit], discovery })).map((s) => s.media.id)).toEqual([21, 20])
    expect(pickLiked([...rated, ...implicit]).some((r) => r.media.id === 2)).toBe(false)
  })

  it('démarrage à froid : compte les animes notés ou terminés, pas les saisons', () => {
    const list = lib(media(1), media(2), media(3), media(4))
    expect(knownAnimeCount([done(1), entry(2, { score: 4 }), done(3)], list)).toBe(3)
    expect(knownAnimeCount([done(1), entry(2, { franchiseId: 1, score: 4 })], list)).toBe(1)
    expect(knownAnimeCount([dropped(1), entry(2, { status: 'CURRENT', watched: [[1, 1]] })], list)).toBe(0)
  })

  it('terminer ou archiver un anime déclenche le recalcul', () => {
    const base = ratingsSignature([entry(1, { status: 'CURRENT', watched: [[1, 2]] })])
    expect(ratingsSignature([done(1)])).not.toBe(base)
    expect(ratingsSignature([dropped(1)])).not.toBe(base)
    // Une simple coche, non.
    expect(ratingsSignature([entry(1, { status: 'CURRENT', watched: [[1, 3]] })])).toBe(base)
  })
})

describe('revisionnages', () => {
  const lib = (...list: ReturnType<typeof media>[]) => new Map(list.map((m) => [m.id, m]))
  const view = (number: number, state: Viewing['state'] = 'completed'): Viewing => ({ number, watched: [[1, 12]], startedAt: null, endedAt: null, state })
  const seen = (id: number, times: number, over = {}) => entry(id, {
    status: 'COMPLETED',
    viewings: Array.from({ length: times }, (_, i) => view(i + 1)),
    ...over,
  })
  const rec = (id: number) => [{ media: media(id), rating: 10 }]

  it('multiplicateur : +0,25 par visionnage, plafonné à 1,75 dès 4', () => {
    expect([1, 2, 3, 4, 5, 20].map(rewatchMultiplier)).toEqual([1, 1.25, 1.5, 1.75, 1.75, 1.75])
  })

  it('visionnages d’un anime : le plus grand nombre parmi ses saisons', () => {
    expect(animeViewings([seen(1, 3), seen(2, 1, { franchiseId: 1 })])).toBe(3)
  })

  it('les visionnages interrompus ne comptent pas', () => {
    expect(animeViewings([entry(1, { viewings: [view(1), view(2, 'interrupted'), view(3, 'interrupted'), view(4, 'current')] })])).toBe(1)
    const rated = realRatings([entry(1, { score: 5, viewings: [view(1, 'interrupted'), view(2, 'interrupted')] })], lib(media(1)))
    expect(rated[0]!.viewings).toBe(0)
    expect(rewatchMultiplier(rated[0]!.viewings!)).toBe(1)
  })

  it('un anime revu 3 fois pèse plus qu’un anime de même note vu une fois, sources A et B', () => {
    const entries = [seen(1, 3, { score: 5 }), seen(2, 1, { score: 5 }), seen(3, 1, { score: 3 })]
    const films = lib(
      media(1, { genres: ['Drama'], title: { english: 'Revu', romaji: null } }),
      media(2, { genres: ['Comedy'], title: { english: 'Vu une fois', romaji: null } }),
      media(3, { genres: ['Sports'] }),
    )
    const rated = realRatings(entries, films)
    const p = buildProfile(rated)
    expect(p.genres.get('Drama')).toBeGreaterThan(p.genres.get('Comedy')!)
    expect(p.genres.get('Comedy')! / p.genres.get('Drama')!).toBeCloseTo(1 / 1.5)
    const out = rankSuggestions(input({ rated, recommendations: new Map([[1, rec(10)], [2, rec(11)]]) }))
    expect(out.map((s) => s.media.id)).toEqual([10, 11])
  })

  it('plafond : 4 ou 8 visionnages pèsent autant', () => {
    const profile = (times: number) => buildProfile(realRatings(
      [seen(1, times, { score: 5 }), seen(2, 1, { score: 5 }), seen(3, 1, { score: 3 })],
      lib(media(1, { genres: ['Drama'] }), media(2, { genres: ['Comedy'] }), media(3, { genres: ['Sports'] })),
    ))
    expect(profile(8).genres.get('Comedy')).toBeCloseTo(profile(4).genres.get('Comedy')!)
    expect(profile(4).genres.get('Comedy')! / profile(4).genres.get('Drama')!).toBeCloseTo(1 / 1.75)
  })

  it('pas de multiplicateur pour une note sous la moyenne', () => {
    const profile = (times: number) => buildProfile(realRatings(
      [seen(1, times, { score: 2 }), seen(2, 1, { score: 5 }), seen(3, 1, { score: 5 })],
      lib(media(1, { genres: ['Horror'] }), media(2, { genres: ['Drama'] }), media(3, { genres: ['Comedy'] })),
    ))
    expect(profile(4).genres.get('Horror')).toBeCloseTo(profile(1).genres.get('Horror')!)
  })

  it('une note égale à la moyenne a droit au multiplicateur ; une saison sous la moyenne d’un anime bien noté, non', () => {
    const ratedEqual = realRatings([seen(1, 4, { score: 4 }), seen(2, 1, { score: 4 })], lib(media(1), media(2)))
    expect(ratedEqual.map((r) => r.viewings)).toEqual([4, 1])
    const twoSeasons = [seen(1, 4, { score: 5 }), seen(2, 4, { franchiseId: 1, score: 2 }), seen(3, 1, { score: 5 })]
    const p = buildProfile(realRatings(twoSeasons, lib(media(1), media(2, { genres: ['Horror'] }), media(3, { genres: ['Drama'] }))))
    // Moyenne 4 : -2 sans multiplicateur, +1 pour Drama.
    expect(p.genres.get('Horror')).toBe(-1)
    expect(p.genres.get('Drama')).toBeCloseTo(0.5)
  })

  it('note implicite : paliers selon les visionnages', () => {
    const tier = (times: number) => implicitRatings([seen(1, times)], lib(media(1)), [])[0]
    expect(tier(1)).toMatchObject({ score: 4, weight: 0.5 })
    expect(tier(2)).toMatchObject({ score: 4.5, weight: 0.75 })
    expect(tier(3)).toMatchObject({ score: 4.5, weight: 1 })
    expect(tier(7)).toMatchObject({ score: 4.5, weight: 1 })
  })

  it('note implicite : les interrompus ne comptent pas', () => {
    const e = entry(1, { status: 'COMPLETED', viewings: [view(1), view(2, 'interrupted')] })
    expect(implicitRatings([e], lib(media(1)), [])[0]).toMatchObject({ score: 4, weight: 0.5 })
  })

  it('un anime revu sans note est aimé, et pèse selon son palier', () => {
    const a = named(1, 'Revu 2 fois')
    const b = named(2, 'Revu 3 fois')
    const rated = implicitRatings([seen(1, 2), seen(2, 3)], lib(a, b), [])
    expect(pickLiked(rated).map((r) => r.media.id).sort()).toEqual([1, 2])
    const out = rankSuggestions(input({ rated, recommendations: new Map([[1, rec(10)], [2, rec(11)]]) }))
    expect(out.map((s) => s.media.id)).toEqual([11, 10])
  })

  it('une vraie note remplace le palier implicite', () => {
    const list = lib(media(1))
    expect(implicitRatings([seen(1, 3, { score: 2 })], list, [])).toEqual([])
    expect(realRatings([seen(1, 3, { score: 2 })], list)[0]).toMatchObject({ score: 2, viewings: 3 })
  })

  it('un revisionnage en cours ne fait pas perdre la note implicite', () => {
    const rewatching = entry(1, { status: 'CURRENT', viewings: [view(1), view(2), { ...view(3, 'current'), watched: [] }] })
    expect(implicitRatings([rewatching], lib(media(1)), [])[0]).toMatchObject({ score: 4.5, weight: 0.75 })
    expect(knownAnimeCount([rewatching], lib(media(1)))).toBe(1)
  })

  it('un anime commencé mais jamais fini reste ignoré, même avec plusieurs interrompus', () => {
    const e = entry(1, { status: 'CURRENT', viewings: [view(1, 'interrupted'), view(2, 'current')] })
    expect(implicitRatings([e], lib(media(1)), [])).toEqual([])
  })

  it('les revus passent en tête des sources plafonnées', () => {
    const list = Array.from({ length: 45 }, (_, i) => media(100 + i))
    const entries = list.map((m, i) => (i === 0 ? seen(m.id, 2, { completedAt: 0 }) : seen(m.id, 1, { completedAt: i })))
    const usable = implicitRatings(entries, lib(...list), []).filter((r) => !r.profileOnly)
    expect(usable).toHaveLength(MAX_IMPLICIT_SOURCES)
    expect(usable[0]!.media.id).toBe(100)
  })

  describe('explication', () => {
    const others = [seen(2, 1, { score: 4 }), seen(3, 1, { score: 4 })]
    const films = lib(named(1, 'Le revu'), named(2, 'Deux'), named(3, 'Trois'))
    const reasonOf = (first: ReturnType<typeof entry>) => {
      const rated = [...realRatings([first, ...others], films), ...implicitRatings([first], films, [])]
      return rankSuggestions(input({ rated, recommendations: new Map([[1, [{ media: media(10), rating: 500 }]]]), discovery: [media(11)] }))
        .find((s) => s.media.id === 10)!.reason
    }

    it('vu au moins 2 fois et noté : « Parce que tu as revu X »', () => {
      expect(reasonOf(seen(1, 2, { score: 5 }))).toBe('Parce que tu as revu Le revu')
    })

    it('vu une fois et noté : « Parce que tu as aimé X »', () => {
      expect(reasonOf(seen(1, 1, { score: 5 }))).toBe('Parce que tu as aimé Le revu')
    })

    it('revu sans note : « revu » ; vu une fois sans note : « vu »', () => {
      expect(reasonOf(seen(1, 2))).toBe('Parce que tu as revu Le revu')
      expect(reasonOf(seen(1, 1))).toBe('Parce que tu as vu Le revu')
    })
  })

  it('un visionnage terminé de plus déclenche le recalcul', () => {
    expect(ratingsSignature([seen(1, 2)])).not.toBe(ratingsSignature([seen(1, 3)]))
  })
})

describe('démarrage à froid', () => {
  it('les plus populaires de la saison, sans ce que j’ai déjà', () => {
    const list = [media(1, { popularity: 10 }), media(2, { popularity: 30 }), media(3, { popularity: 20 })]
    const result = coldSuggestions(list, { followed: new Set([3]), hidden: new Set() })
    expect(result.map((s) => s.media.id)).toEqual([2, 1])
    expect(result[0]!.reason).toBe(COLD_REASON)
  })
})

describe('signature des notes', () => {
  it('ne change que si une note change', () => {
    const a = [entry(1, { score: 4 }), entry(2, { score: null })]
    expect(ratingsSignature(a)).toBe(ratingsSignature([entry(2), entry(1, { score: 4, watched: [[1, 3]] })]))
    expect(ratingsSignature(a)).not.toBe(ratingsSignature([entry(1, { score: 4.5 })]))
  })
})
