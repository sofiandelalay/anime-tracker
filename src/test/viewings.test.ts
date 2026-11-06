import Dexie from 'dexie'
import { beforeEach, describe, expect, it } from 'vitest'
import { exportData, importData, parseBackup } from '../db/backup'
import { cacheDb } from '../db/cacheDb'
import { db, TrackerDB } from '../db/trackerDb'
import {
  addAnime, addPastWatch, archiveFranchise, checkEpisode, deleteViewing, incrementEpisode, setScore, startRewatch, stopRewatch, uncheckEpisode, unfollowAnime,
} from '../domain/actions'
import { buildListModel } from '../domain/listModel'
import { progressInfo } from '../domain/progress'
import { buildStats } from '../domain/stats'
import type { Media, Viewing } from '../domain/types'
import { animeTimesSeen, currentViewing, seasonViewsLine, timesSeen, watchedOf } from '../domain/viewings'
import { entry, media, rel } from './fixtures'

const now = Date.now()
const season = (id: number, over: Partial<Media> = {}) => media(id, { fetchedAt: now, genres: ['Drama'], ...over })
const s1 = season(1, { relations: [rel(2, 'SEQUEL')] })
const s2 = season(2, { relations: [rel(1, 'PREQUEL'), rel(3, 'SEQUEL', { status: 'NOT_YET_RELEASED' })] })
const s3 = season(3, { status: 'NOT_YET_RELEASED', relations: [rel(2, 'PREQUEL')] })
const solo = season(9)

const get = async (id: number) => (await db.entries.get(id))!
const states = async (id: number) => (await get(id)).viewings.map((v) => [v.number, v.state, v.watched])
const lib = async () => new Map((await cacheDb.media.toArray()).map((m) => [m.id, m]))
const modelOf = async () => buildListModel(
  await db.entries.toArray(),
  await lib(),
  new Map((await cacheDb.franchises.toArray()).map((f) => [f.id, f])),
)
const statsOf = async () => buildStats(await db.entries.toArray(), await lib(), await db.log.toArray(), now)

beforeEach(async () => {
  await Promise.all([db.entries.clear(), db.log.clear(), db.hidden.clear(), cacheDb.media.clear(), cacheDb.franchises.clear()])
  await cacheDb.media.bulkPut([s1, s2, s3, solo])
})

describe('migration vers les visionnages', () => {
  const legacy = (mediaId: number, status: string, watched: [number, number][], over = {}) => ({
    mediaId, franchiseId: mediaId, status, watched, followed: true, score: null, addedAt: 1, startedAt: 2, completedAt: status === 'COMPLETED' ? 3 : null, updatedAt: 4, ...over,
  })

  it('v4 → v5 : les cases deviennent le visionnage 1, avec les dates existantes', async () => {
    const name = 'test-migration-viewings'
    const old = new Dexie(name)
    old.version(4).stores({ entries: 'mediaId, franchiseId, status, updatedAt', log: '++id, mediaId, at', meta: 'key', hidden: 'mediaId' })
    await old.table('entries').bulkPut([
      legacy(1, 'COMPLETED', [[1, 12]], { score: 4 }),
      legacy(2, 'CURRENT', [[1, 3], [5, 5]]),
      legacy(3, 'PLANNING', []),
      legacy(4, 'DROPPED', [[1, 2]]),
      legacy(5, 'COMPLETED', [[1, 12]]),
    ])
    await old.table('log').bulkAdd([
      { mediaId: 1, episode: 12, at: 9 },
      { mediaId: 5, episode: 1, at: null },
    ])
    old.close()

    const tracker = new TrackerDB(name)
    const one = await tracker.entries.get(1)
    expect(one).not.toHaveProperty('watched')
    expect(one).toMatchObject({ status: 'COMPLETED', score: 4, viewings: [{ number: 1, watched: [[1, 12]], startedAt: 2, endedAt: 3, state: 'completed' }] })
    expect((await tracker.entries.get(2))!.viewings).toEqual([{ number: 1, watched: [[1, 3], [5, 5]], startedAt: 2, endedAt: null, state: 'current' }])
    expect((await tracker.entries.get(3))!.viewings).toEqual([])
    expect((await tracker.entries.get(4))!).toMatchObject({ status: 'DROPPED', viewings: [{ state: 'current', watched: [[1, 2]] }] })
    // Cochée uniquement en lot : la date reste inconnue.
    expect((await tracker.entries.get(5))!.viewings[0]).toMatchObject({ startedAt: null, endedAt: null, state: 'completed' })
    expect((await tracker.log.toArray()).every((l) => l.viewing === 1)).toBe(true)
    expect((await tracker.log.toArray()).map((l) => l.at)).toEqual([9, null])
    await tracker.delete()
  })

  it('un ancien export (v2) devient le visionnage 1', () => {
    const backup = parseBackup(JSON.stringify({ app: 'anime-tracker', version: 2, exportedAt: 1, entries: [legacy(1, 'CURRENT', [[1, 3]])], log: [{ mediaId: 1, episode: 3, at: 5 }] }))
    expect(backup.version).toBe(3)
    expect(backup.entries[0]!.viewings).toEqual([{ number: 1, watched: [[1, 3]], startedAt: 2, endedAt: null, state: 'current' }])
    expect(backup.log[0]).toEqual({ mediaId: 1, episode: 3, at: 5, viewing: 1 })
  })
})

describe('revoir', () => {
  it('revoir tout l’anime : toutes les saisons sorties, cases décochées, le passé conservé', async () => {
    await addAnime(s1, { all: true })
    await startRewatch(1, [s1, s2, s3])
    expect(await states(1)).toEqual([[1, 'completed', [[1, 12]]], [2, 'current', []]])
    expect(await states(2)).toEqual([[1, 'completed', [[1, 12]]], [2, 'current', []]])
    // La saison annoncée n'est pas relancée.
    expect((await get(3)).viewings).toEqual([])
    expect(progressInfo(await get(1), s1).watched).toBe(0)
    const card = (await modelOf()).toWatch[0]!
    expect(card).toMatchObject({ kind: 'current', followed: true, viewingBadge: '2e visionnage' })
    expect(card.media.id).toBe(1)
  })

  it('revoir une seule saison ne touche pas aux autres', async () => {
    await addAnime(s1, { all: true })
    await startRewatch(1, [s2])
    expect(await states(1)).toEqual([[1, 'completed', [[1, 12]]]])
    expect(await states(2)).toEqual([[1, 'completed', [[1, 12]]], [2, 'current', []]])
    expect((await get(1)).status).toBe('COMPLETED')
    expect((await modelOf()).toWatch[0]).toMatchObject({ viewingBadge: '2e visionnage', seasonNumber: 2 })
  })

  it('anime commencé mais pas fini : le visionnage interrompu est conservé et compte dans les stats', async () => {
    await addAnime(solo)
    await checkEpisode(solo, 1)
    await checkEpisode(solo, 2)
    await startRewatch(9, [solo])
    expect(await states(9)).toEqual([[1, 'interrupted', [[1, 2]]], [2, 'current', []]])
    expect((await statsOf()).episodes).toBe(2)
    await checkEpisode(solo, 1)
    expect(await states(9)).toEqual([[1, 'interrupted', [[1, 2]]], [2, 'current', [[1, 1]]]])
    expect((await statsOf()).episodes).toBe(3)
    expect((await db.log.toArray()).map((l) => [l.viewing, l.episode])).toEqual([[1, 1], [1, 2], [2, 1]])
  })

  it('revoir fait revenir un anime non suivi ou archivé', async () => {
    await addAnime(solo)
    await checkEpisode(solo, 1)
    await archiveFranchise(9)
    await startRewatch(9, [solo])
    expect((await modelOf()).toWatch).toHaveLength(1)

    await unfollowAnime(9)
    await startRewatch(9, [solo])
    expect((await get(9)).followed).toBe(true)
  })

  it('les cases, « +1 » et décocher n’agissent que sur le visionnage en cours', async () => {
    await addAnime(solo, { all: true })
    await startRewatch(9, [solo])
    await incrementEpisode(solo)
    await incrementEpisode(solo)
    await uncheckEpisode(solo, 1)
    expect(await states(9)).toEqual([[1, 'completed', [[1, 12]]], [2, 'current', [[2, 2]]]])
    // Décocher l'épisode 1 du visionnage 2 laisse celui du visionnage 1 au journal.
    const log = await db.log.where('mediaId').equals(9).toArray()
    expect(log.filter((l) => l.episode === 1).map((l) => l.viewing)).toEqual([1])
    await uncheckEpisode(solo, 2)
    expect((await get(9)).status).toBe('CURRENT')
  })

  it('fin d’un revisionnage : Terminé, pas de note redemandée, « vu N fois », annulable', async () => {
    await addAnime(solo, { all: true })
    await setScore(solo, 4)
    await startRewatch(9, [solo])
    for (let i = 0; i < 11; i++) await incrementEpisode(solo)
    const out = await incrementEpisode(solo)
    expect(out).toMatchObject({ completed: true, viewing: 2, seen: 2 })
    expect((await get(9))).toMatchObject({ status: 'COMPLETED', score: 4 })
    expect(timesSeen(await get(9))).toBe(2)
    await out.undo()
    expect((await get(9)).status).toBe('CURRENT')
    expect(await states(9)).toEqual([[1, 'completed', [[1, 12]]], [2, 'current', [[1, 11]]]])
  })

  it('la note reste unique : elle ne bouge pas pendant un revisionnage', async () => {
    await addAnime(solo, { all: true })
    await setScore(solo, 3.5)
    await startRewatch(9, [solo])
    expect((await get(9)).score).toBe(3.5)
  })
})

describe('arrêter un revisionnage', () => {
  it('le visionnage passe en interrompu, la saison redevient Terminée', async () => {
    await addAnime(solo, { all: true })
    await startRewatch(9, [solo])
    await checkEpisode(solo, 1)
    const undo = await stopRewatch(9)
    expect(await states(9)).toEqual([[1, 'completed', [[1, 12]]], [2, 'interrupted', [[1, 1]]]])
    expect((await get(9)).status).toBe('COMPLETED')
    expect((await modelOf()).completed).toHaveLength(1)
    // Les cases montrent le visionnage terminé.
    expect(watchedOf(await get(9))).toEqual([[1, 12]])
    await undo()
    expect((await get(9)).status).toBe('CURRENT')
    expect(currentViewing(await get(9))?.number).toBe(2)
  })

  it('sans visionnage terminé : le précédent reprend là où il en était', async () => {
    await addAnime(solo)
    await checkEpisode(solo, 1)
    await startRewatch(9, [solo])
    await stopRewatch(9)
    expect(await states(9)).toEqual([[1, 'current', [[1, 1]]], [2, 'interrupted', []]])
    expect((await get(9)).status).toBe('CURRENT')
    expect((await modelOf()).toWatch[0]!.viewingBadge).toBeNull()
  })

  it('le numéro suivant ne réutilise jamais un numéro existant', async () => {
    await addAnime(solo, { all: true })
    await startRewatch(9, [solo])
    await stopRewatch(9)
    await startRewatch(9, [solo])
    expect((await get(9)).viewings.map((v) => v.number)).toEqual([1, 2, 3])
  })
})

describe('compteurs « vu N fois »', () => {
  const v = (number: number, state: Viewing['state']): Viewing => ({ number, watched: [[1, 12]], startedAt: null, endedAt: null, state })

  it('ligne d’une saison : seulement si elle apporte une info', () => {
    expect(seasonViewsLine(null)).toBeNull()
    expect(seasonViewsLine({ viewings: [] })).toBeNull()
    expect(seasonViewsLine({ viewings: [v(1, 'completed')] })).toBeNull()
    expect(seasonViewsLine({ viewings: [v(1, 'current')] })).toBeNull()
    expect(seasonViewsLine({ viewings: [v(1, 'completed'), v(2, 'completed')] })).toBe('Vue 2 fois')
    expect(seasonViewsLine({ viewings: [v(1, 'completed'), v(2, 'completed'), v(3, 'current')] })).toBe('Vue 2 fois · 3e visionnage en cours')
    expect(seasonViewsLine({ viewings: [v(1, 'completed'), v(2, 'current')] })).toBe('Vue 1 fois · 2e visionnage en cours')
    expect(seasonViewsLine({ viewings: [v(1, 'interrupted'), v(2, 'current')] })).toBe('2e visionnage en cours')
  })

  it('un visionnage interrompu ne compte pas comme vu', () => {
    expect(timesSeen({ viewings: [v(1, 'completed'), v(2, 'interrupted')] })).toBe(1)
  })

  it('anime entier : le minimum des saisons sorties, sans les annoncées', () => {
    const seasons = [s1, s2, s3]
    const entries = new Map([
      [1, { viewings: [v(1, 'completed'), v(2, 'completed'), v(3, 'completed')] }],
      [2, { viewings: [v(1, 'completed'), v(2, 'completed')] }],
    ])
    expect(animeTimesSeen(seasons, entries)).toBe(2)
    expect(animeTimesSeen([s1, s2], new Map([[1, { viewings: [v(1, 'completed')] }]]))).toBe(0)
  })
})

describe('stats avec revisionnages', () => {
  it('heures et épisodes incluent tout ; revisionnages terminés et le plus revu', async () => {
    await addAnime(solo, { all: true, times: 4 })
    const s = await statsOf()
    expect(s.episodes).toBe(48)
    expect(s.totalMinutes).toBe(48 * 24)
    expect(s.rewatchMinutes).toBe(36 * 24)
    expect(s.rewatches).toBe(3)
    expect(s.mostRewatched).toMatchObject({ times: 4 })
    expect(s.mostRewatched!.media.id).toBe(9)
    expect(s.completed).toBe(1)
  })

  it('rien de revu : pas de bloc à afficher', async () => {
    await addAnime(solo, { all: true })
    expect(await statsOf()).toMatchObject({ rewatches: 0, rewatchMinutes: 0, mostRewatched: null })
  })

  it('un revisionnage en cours compte dans les heures, pas dans les revisionnages terminés', async () => {
    await addAnime(solo, { all: true })
    await startRewatch(9, [solo])
    await checkEpisode(solo, 1)
    expect(await statsOf()).toMatchObject({ episodes: 13, rewatchMinutes: 24, rewatches: 0 })
  })
})

describe('visionnages passés', () => {
  it('ajouter sans date : terminé, date inconnue, tous les épisodes cochés', async () => {
    await addAnime(solo, { all: true })
    const undo = await addPastWatch(solo, null)
    expect((await get(9)).viewings[1]).toEqual({ number: 2, watched: [[1, 12]], startedAt: null, endedAt: null, state: 'completed' })
    expect(timesSeen(await get(9))).toBe(2)
    expect((await statsOf()).monthMinutes).toBe(0)
    await undo()
    expect(timesSeen(await get(9))).toBe(1)
  })

  it('avec un revisionnage en cours : il se place avant, et le journal suit', async () => {
    await addAnime(solo)
    await checkEpisode(solo, 1)
    await addPastWatch(solo, Date.UTC(2020, 0, 1))
    expect(await states(9)).toEqual([[1, 'completed', [[1, 12]]], [2, 'current', [[1, 1]]]])
    expect((await get(9)).viewings[0]!.endedAt).toBe(Date.UTC(2020, 0, 1))
    expect((await db.log.toArray()).filter((l) => l.at !== Date.UTC(2020, 0, 1)).map((l) => l.viewing)).toEqual([2])
    expect(seasonViewsLine(await get(9))).toBe('Vue 1 fois · 2e visionnage en cours')
    // Pas de ligne « ce mois-ci » pour une date ancienne.
    expect((await statsOf()).monthMinutes).toBe(24)
  })

  it('sur un anime jamais touché : enregistré sans le suivre', async () => {
    await addPastWatch(solo, null)
    expect(await get(9)).toMatchObject({ followed: false, status: 'COMPLETED' })
  })

  it('supprimer un visionnage : ses lignes de journal aussi, annulable', async () => {
    await addAnime(solo, { all: true, times: 2 })
    expect(await db.log.count()).toBe(24)
    const undo = await deleteViewing(9, 9, 2)
    expect(await states(9)).toEqual([[1, 'completed', [[1, 12]]]])
    expect(await db.log.count()).toBe(12)
    await undo()
    expect(timesSeen(await get(9))).toBe(2)
    expect(await db.log.count()).toBe(24)
  })

  it('supprimer le seul visionnage ramène la saison à À voir', async () => {
    await addAnime(solo, { all: true })
    await deleteViewing(9, 9, 1)
    expect(await get(9)).toMatchObject({ status: 'PLANNING', viewings: [] })
  })
})

describe('« J’ai tout vu » avec plusieurs fois', () => {
  it('3 fois : trois visionnages terminés à date inconnue', async () => {
    await addAnime(s1, { all: true, times: 3 })
    const e = await get(1)
    expect(e.viewings.map((v) => [v.number, v.state, v.startedAt, v.endedAt, v.watched])).toEqual([
      [1, 'completed', null, null, [[1, 12]]],
      [2, 'completed', null, null, [[1, 12]]],
      [3, 'completed', null, null, [[1, 12]]],
    ])
    expect(e.status).toBe('COMPLETED')
    expect(timesSeen(await get(2))).toBe(3)
    expect((await get(3)).viewings).toEqual([])
    expect(await db.log.where('mediaId').equals(1).count()).toBe(36)
    expect((await db.log.toArray()).every((l) => l.at === null)).toBe(true)
    expect(animeTimesSeen([s1, s2, s3], new Map((await db.entries.toArray()).map((x) => [x.mediaId, x])))).toBe(3)
  })

  it('saison encore en diffusion : les fois d’avant terminées, la dernière en cours et à jour', async () => {
    const airing = season(20, { status: 'RELEASING', nextAiring: { episode: 5, airingAt: 9e9 } })
    await cacheDb.media.put(airing)
    await addAnime(airing, { all: true, times: 2 })
    const e = await get(20)
    expect(e.viewings.map((v) => [v.state, v.watched])).toEqual([['completed', [[1, 4]]], ['current', [[1, 4]]]])
    expect(e.status).toBe('CURRENT')
  })

  it('annuler retire tous les visionnages', async () => {
    const undo = await addAnime(solo, { all: true, times: 3 })
    await undo()
    expect(await db.entries.count()).toBe(0)
    expect(await db.log.count()).toBe(0)
  })
})

describe('export et import', () => {
  it('export puis import : données identiques', async () => {
    await addAnime(s1, { all: true, times: 2 })
    await setScore(s1, 4.5)
    await startRewatch(1, [s2])
    await checkEpisode(s2, 1)
    await addPastWatch(solo, Date.UTC(2020, 0, 1))
    await db.hidden.put({ mediaId: 77, at: 5 })
    const strip = async () => ({
      entries: await db.entries.orderBy('mediaId').toArray(),
      log: (await db.log.toArray()).map(({ id: _id, ...l }) => l),
      hidden: await db.hidden.toArray(),
    })
    const before = await strip()
    const file = JSON.stringify(await exportData(1))
    await db.entries.clear()
    await db.log.clear()
    await db.hidden.clear()
    await importData(parseBackup(file))
    expect(await strip()).toEqual(before)
  })

  it('refuse un visionnage invalide', () => {
    const bad = { ...entry(1), viewings: [{ number: 0, watched: [], startedAt: null, endedAt: null, state: 'current' }] }
    expect(() => parseBackup(JSON.stringify({ app: 'anime-tracker', version: 3, entries: [bad], log: [] }))).toThrow()
  })
})
