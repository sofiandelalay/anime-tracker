import { beforeEach, describe, expect, it } from 'vitest'
import { cacheDb } from '../db/cacheDb'
import { db } from '../db/trackerDb'
import {
  addAnime, archiveFranchise, attachSeasons, setAnimeScore, checkEpisode, checkThrough, followAnime, incrementEpisode, markAllWatched, markSeasonWatched, setScore,
  unarchiveFranchise, uncheckEpisode, unfollowAnime,
} from '../domain/actions'
import { buildListModel } from '../domain/listModel'
import { buildExclusions, isExcluded, rankSuggestions } from '../domain/recommend'
import { buildStats } from '../domain/stats'
import { attachKnownSeasons } from '../domain/sync'
import { defaultSeason } from '../domain/tracking'
import type { Entry, Franchise, Media } from '../domain/types'
import { watchedOf } from '../domain/viewings'
import { entry, media, rel } from './fixtures'

// Tout est en cache et récent : ces tests ne font aucun appel réseau.
const now = Date.now()
const season = (id: number, over: Partial<Media> = {}) => media(id, { fetchedAt: now, genres: ['Drama'], studios: ['Bones'], ...over })
const s1 = season(1, { relations: [rel(2, 'SEQUEL')] })
const s2 = season(2, { relations: [rel(1, 'PREQUEL'), rel(3, 'SEQUEL')] })
const s3 = season(3, { relations: [rel(2, 'PREQUEL'), rel(4, 'SEQUEL', { status: 'NOT_YET_RELEASED' })] })
const s4 = season(4, { status: 'NOT_YET_RELEASED', episodes: 12, relations: [rel(3, 'PREQUEL')] })
const solo = season(9, { episodes: 12 })

const withWatched = (e: Entry) => ({ ...e, watched: watchedOf(e) })
const read = async (id: number) => {
  const e = await db.entries.get(id)
  return e && withWatched(e)
}
const entriesOf = async () => new Map((await db.entries.toArray()).map((e) => [e.mediaId, withWatched(e)]))
const modelOf = async () => {
  const entries = await db.entries.toArray()
  const franchises = new Map((await cacheDb.franchises.toArray()).map((f) => [f.id, f]))
  const all = new Map((await cacheDb.media.toArray()).map((m) => [m.id, m]))
  return buildListModel(entries, all, franchises)
}

beforeEach(async () => {
  await Promise.all([db.entries.clear(), db.log.clear(), db.hidden.clear(), cacheDb.media.clear(), cacheDb.franchises.clear()])
  await cacheDb.media.bulkPut([s1, s2, s3, s4, solo])
})

describe('ajouter un anime entier', () => {
  it('pas commencé : une entrée À voir par saison, y compris l’annoncée', async () => {
    await addAnime(s1)
    const e = await entriesOf()
    expect([...e.keys()].sort()).toEqual([1, 2, 3, 4])
    expect([...e.values()].every((x) => x.status === 'PLANNING' && x.followed && x.franchiseId === 1 && x.watched.length === 0)).toBe(true)
  })

  it('déjà commencé en saison 3 : avant Terminé, saison choisie En cours, après À voir', async () => {
    await addAnime(s1, { seasonId: 3, episode: 5 })
    const e = await entriesOf()
    expect(e.get(1)).toMatchObject({ status: 'COMPLETED', watched: [[1, 12]] })
    expect(e.get(2)).toMatchObject({ status: 'COMPLETED', watched: [[1, 12]] })
    expect(e.get(3)).toMatchObject({ status: 'CURRENT', watched: [[1, 5]] })
    expect(e.get(4)).toMatchObject({ status: 'PLANNING', watched: [] })
    // Une ligne de journal par case, à date inconnue : pas dans « ce mois-ci ».
    expect(await db.log.count()).toBe(12 + 12 + 5)
    expect((await db.log.toArray()).every((l) => l.at === null)).toBe(true)
  })

  it('depuis une saison du milieu : c’est l’anime entier, et la question propose cette saison', async () => {
    await addAnime(s3)
    expect((await db.entries.count())).toBe(4)
    expect((await read(3))!.franchiseId).toBe(1)
    expect(defaultSeason([s1, s2, s3, s4], 3)?.id).toBe(3)
    expect(defaultSeason([s1, s2, s3, s4], 4)?.id).toBe(3)
  })

  it('« déjà commencé » jusqu’au dernier épisode : la saison est Terminée', async () => {
    await addAnime(s1, { seasonId: 1, episode: 12 })
    expect((await read(1))!.status).toBe('COMPLETED')
  })

  it('Annuler retire tout', async () => {
    const undo = await addAnime(s1, { seasonId: 2, episode: 3 })
    await undo()
    expect(await db.entries.count()).toBe(0)
    expect(await db.log.count()).toBe(0)
  })
})

describe('cases à cocher et journal', () => {
  beforeEach(() => addAnime(solo))

  it('cocher ajoute une ligne au journal, décocher la retire', async () => {
    await checkEpisode(solo, 1)
    await checkEpisode(solo, 2)
    expect((await db.log.toArray()).map((l) => [l.episode, l.at === null])).toEqual([[1, false], [2, false]])
    await uncheckEpisode(solo, 1)
    expect((await db.log.toArray()).map((l) => l.episode)).toEqual([2])
    expect((await read(9))!.watched).toEqual([[2, 2]])
  })

  it('« +1 épisode » coche le premier non vu', async () => {
    await checkEpisode(solo, 1)
    await checkEpisode(solo, 3)
    await incrementEpisode(solo)
    expect((await read(9))!.watched).toEqual([[1, 3]])
  })

  it('« Oui, tout marquer » : les précédents en lot, l’épisode K compte normalement', async () => {
    await checkThrough(solo, 3)
    const log = await db.log.toArray()
    expect(log.map((l) => [l.episode, l.at === null])).toEqual([[1, true], [2, true], [3, false]])
  })

  it('dernière case : Terminé, avec Annuler', async () => {
    await checkThrough(solo, 11)
    const out = await incrementEpisode(solo)
    expect(out).toMatchObject({ completed: true, followed: true })
    expect((await read(9))!.status).toBe('COMPLETED')
    await out.undo()
    expect((await read(9))!).toMatchObject({ status: 'CURRENT', watched: [[1, 11]] })
    expect(await db.log.count()).toBe(11)
  })

  it('impossible de cocher un épisode pas encore sorti', async () => {
    const airing = season(20, { status: 'RELEASING', nextAiring: { episode: 3, airingAt: 9e9 } })
    await cacheDb.media.put(airing)
    await addAnime(airing)
    await checkEpisode(airing, 5)
    await checkThrough(airing, 5)
    expect((await read(20))!.watched).toEqual([[1, 2]])
  })

  it('« Tout marquer comme vu » et « J’ai tout vu » s’annulent, sans dépasser les épisodes sortis', async () => {
    await addAnime(s1)
    const season1 = await markSeasonWatched(s1)
    expect((await read(1))!.status).toBe('COMPLETED')
    await season1.undo()
    expect((await read(1))!.watched).toEqual([])

    const { undo } = await markAllWatched(s2)
    const e = await entriesOf()
    expect([1, 2, 3].every((id) => e.get(id)!.status === 'COMPLETED')).toBe(true)
    expect(e.get(4)!.watched).toEqual([])
    await undo()
    expect((await read(2))!.watched).toEqual([])
    expect(await db.log.where('mediaId').equals(3).count()).toBe(0)
  })
})

describe('« J’ai tout vu » à l’ajout', () => {
  const NOW = Date.now()
  const inMonth = async () => buildStats(await db.entries.toArray(), new Map((await cacheDb.media.toArray()).map((m) => [m.id, m])), await db.log.toArray(), NOW)

  it('anime terminé de diffusion : tout coché, Terminé, Terminés et toujours suivi', async () => {
    const a = season(50, { relations: [rel(51, 'SEQUEL')] })
    const b = season(51, { relations: [rel(50, 'PREQUEL')] })
    await cacheDb.media.bulkPut([a, b])
    await addAnime(a, { all: true })
    const e = await entriesOf()
    expect(e.get(50)).toMatchObject({ status: 'COMPLETED', watched: [[1, 12]], followed: true })
    expect(e.get(51)).toMatchObject({ status: 'COMPLETED', watched: [[1, 12]], followed: true })
    const model = await modelOf()
    expect(model.completed.map((c) => c.franchiseId)).toEqual([50])
    expect(model.completed[0]!.followed).toBe(true)
    expect(model.toWatch).toHaveLength(0)
  })

  it('anime encore en diffusion : les épisodes sortis seulement, reste dans À suivre, à jour', async () => {
    const a = season(60, { relations: [rel(61, 'SEQUEL', { status: 'RELEASING' })] })
    const b = season(61, { status: 'RELEASING', episodes: 12, nextAiring: { episode: 5, airingAt: 9e9 }, relations: [rel(60, 'PREQUEL')] })
    await cacheDb.media.bulkPut([a, b])
    await addAnime(a, { all: true })
    const e = await entriesOf()
    expect(e.get(60)).toMatchObject({ status: 'COMPLETED', watched: [[1, 12]] })
    expect(e.get(61)).toMatchObject({ status: 'CURRENT', watched: [[1, 4]] })
    const model = await modelOf()
    expect(model.toWatch.map((c) => [c.kind, c.media.id])).toEqual([['current', 61]])
    expect(model.completed).toHaveLength(0)
  })

  it('une saison annoncée reste non cochée ; une fois annoncée, elle ramène l’anime dans À suivre', async () => {
    await addAnime(s1, { all: true })
    const e = await entriesOf()
    expect([1, 2, 3].every((id) => e.get(id)!.status === 'COMPLETED')).toBe(true)
    expect(e.get(4)).toMatchObject({ status: 'PLANNING', watched: [] })
    expect((await modelOf()).toWatch[0]).toMatchObject({ kind: 'newSeason', followed: true })
  })

  it('Annuler retire tout, même la note', async () => {
    const undo = await addAnime(solo, { all: true })
    await setAnimeScore(9, 4.5)
    expect((await read(9))!.score).toBe(4.5)
    await undo()
    expect(await db.entries.count()).toBe(0)
    expect(await db.log.count()).toBe(0)
  })

  it('« ce mois-ci » inchangé après une coche en masse, totaux à jour', async () => {
    await addAnime(solo)
    await checkEpisode(solo, 1)
    const before = await inMonth()
    expect(before.monthMinutes).toBe(24)
    await markSeasonWatched(solo)
    const after = await inMonth()
    expect(after.monthMinutes).toBe(24)
    expect(after.totalMinutes).toBe(12 * 24)
    expect(await db.log.where('mediaId').equals(9).count()).toBe(12)
    expect((await db.log.toArray()).filter((l) => l.at === null)).toHaveLength(11)
  })

  it('« J’ai tout vu » de la page et l’ajout : aucune date, totaux comptés', async () => {
    await addAnime(s1)
    await markAllWatched(s1)
    expect((await db.log.toArray()).every((l) => l.at === null)).toBe(true)
    const s = await inMonth()
    expect(s.monthMinutes).toBe(0)
    expect(s.totalMinutes).toBe(36 * 24)
  })

  it('noter l’anime pose la note sur ses saisons commencées, pas sur l’annoncée', async () => {
    await addAnime(s1, { all: true })
    await setAnimeScore(1, 4)
    const e = await entriesOf()
    expect(e.get(1)!.score).toBe(4)
    expect(e.get(3)!.score).toBe(4)
    expect(e.get(4)!.score).toBeNull()
  })
})

describe('anime non suivi', () => {
  it('cocher l’enregistre sans le suivre : toutes les saisons existent, rien dans À suivre', async () => {
    const out = await checkEpisode(s2, 1)
    expect(out).toMatchObject({ followed: false, changed: true, franchiseId: 1 })
    const e = await entriesOf()
    expect(e.size).toBe(4)
    expect([...e.values()].every((x) => !x.followed)).toBe(true)
    const model = await modelOf()
    expect(model.toWatch).toHaveLength(0)
    expect(model.shelved).toHaveLength(1)
  })

  it('une saison manquante hérite du suivi de l’anime, sans le faire suivre', async () => {
    await checkEpisode(s2, 1)
    await db.entries.delete(3)
    await checkEpisode(s3, 1)
    expect((await read(3))!.followed).toBe(false)
  })

  it('noter l’enregistre aussi', async () => {
    expect((await setScore(solo, 4)).followed).toBe(false)
    expect((await modelOf()).shelved).toHaveLength(1)
  })

  it('Suivre en un tap le ramène dans À suivre, données intactes', async () => {
    await checkEpisode(s1, 1)
    await followAnime(1)
    expect((await modelOf()).toWatch).toHaveLength(1)
    expect((await read(1))!.watched).toEqual([[1, 1]])
  })
})

describe('Ne plus suivre', () => {
  beforeEach(async () => {
    await addAnime(s1, { seasonId: 2, episode: 4 })
    await setScore(s1, 5)
    await setScore(s2, 4)
  })

  it('conserve toutes les données et sort de À suivre', async () => {
    const before = await db.log.count()
    const undo = await unfollowAnime(1)
    const e = await entriesOf()
    expect(e.get(1)).toMatchObject({ followed: false, status: 'COMPLETED', score: 5, watched: [[1, 12]] })
    expect(e.get(2)).toMatchObject({ followed: false, status: 'CURRENT', score: 4, watched: [[1, 4]] })
    expect(await db.log.count()).toBe(before)
    const model = await modelOf()
    expect(model.toWatch).toHaveLength(0)
    expect(model.shelved).toHaveLength(1)
    await undo()
    expect((await read(2))!.followed).toBe(true)
    expect((await modelOf()).toWatch).toHaveLength(1)
  })

  it('un anime non suivi mais coché ou noté est exclu des suggestions, et compte dans le profil et les stats', async () => {
    await unfollowAnime(1)
    const entries = await db.entries.toArray()
    const franchises = await cacheDb.franchises.toArray()
    const ex = buildExclusions(entries, franchises, [])
    // Toutes ses saisons, et une suite qui n'y serait que liée.
    for (const m of [s1, s2, s3, s4]) expect(isExcluded(m, ex)).toBe(true)
    const list = await cacheDb.media.toArray()
    const lib = new Map(list.map((m) => [m.id, m]))
    const rated = entries.filter((e) => e.score !== null).map((e) => ({ media: lib.get(e.mediaId)!, score: e.score! }))
    const out = rankSuggestions({
      rated,
      recommendations: new Map([[1, [{ media: s3, rating: 50 }, { media: season(30, { genres: ['Drama'] }), rating: 50 }]]]),
      discovery: [s4],
      exclusions: ex,
    })
    expect(out.map((s) => s.media.id)).toEqual([30])
    expect(rated).toHaveLength(2)
    const stats = buildStats(entries, lib, await db.log.toArray(), Date.now())
    expect(stats.totalMinutes).toBe((12 + 4) * 24)
    expect(stats.favoriteStudio).toEqual({ name: 'Bones', episodes: 16 })
  })

  it('un anime coché puis entièrement décoché reste exclu des suggestions', async () => {
    await checkEpisode(solo, 1)
    await uncheckEpisode(solo, 1)
    const ex = buildExclusions(await db.entries.toArray(), [], [])
    expect(isExcluded(solo, ex)).toBe(true)
  })

  it('archiver garde les données ; reprendre recalcule depuis les cases', async () => {
    const undo = await archiveFranchise(1)
    expect((await read(2))!.status).toBe('DROPPED')
    expect((await read(1))!.status).toBe('COMPLETED')
    expect((await modelOf()).archived).toHaveLength(1)
    await undo()
    await archiveFranchise(1)
    await unarchiveFranchise(1)
    expect((await read(2))!).toMatchObject({ status: 'CURRENT', watched: [[1, 4]], followed: true })
    expect((await read(3))!.status).toBe('PLANNING')
  })
})

describe('nouvelle saison annoncée', () => {
  const f: Franchise = { id: 1, mediaIds: [1, 2, 3, 4], computedAt: 0 }
  const completeFirstThree = async () => {
    await addAnime(s1, { seasonId: 3, episode: 12 })
    await db.entries.delete(4)
    await cacheDb.franchises.put(f)
  }

  it('rattachée automatiquement ; l’anime suivi revient dans À suivre avec le badge', async () => {
    await completeFirstThree()
    await attachSeasons(1, f.mediaIds)
    expect((await read(4))).toMatchObject({ status: 'PLANNING', followed: true })
    const model = await modelOf()
    expect(model.toWatch[0]).toMatchObject({ kind: 'newSeason', newSeason: true })
    expect(model.completed).toHaveLength(0)
  })

  it('un anime non suivi ne revient pas : badge discret dans Terminés', async () => {
    await completeFirstThree()
    await unfollowAnime(1)
    await attachSeasons(1, f.mediaIds)
    expect((await read(4))!.followed).toBe(false)
    const model = await modelOf()
    expect(model.toWatch).toHaveLength(0)
    expect(model.completed[0]).toMatchObject({ newSeason: true, followed: false })
  })

  it('une franchise abandonnée ne revient pas', async () => {
    await addAnime(s1)
    await db.entries.delete(4)
    await archiveFranchise(1)
    await cacheDb.franchises.put(f)
    await attachSeasons(1, f.mediaIds)
    const model = await modelOf()
    expect(model.toWatch).toHaveLength(0)
    expect(model.archived).toHaveLength(1)
  })
})

describe('migration : rattachement au lancement', () => {
  it('les saisons suivies rejoignent leur franchise, les manquantes arrivent en À voir', async () => {
    await cacheDb.franchises.put({ id: 1, mediaIds: [1, 2, 3, 4], computedAt: 0 })
    await db.entries.bulkPut([
      entry(2, { franchiseId: 2, status: 'CURRENT', watched: [[1, 4]], score: 4 }),
    ])
    await attachKnownSeasons()
    const e = await entriesOf()
    expect(e.size).toBe(4)
    expect(e.get(2)).toMatchObject({ franchiseId: 1, watched: [[1, 4]], score: 4, status: 'CURRENT' })
    expect(e.get(1)).toMatchObject({ franchiseId: 1, status: 'PLANNING', followed: true })
    await attachKnownSeasons()
    expect(await db.entries.count()).toBe(4)
  })
})
