import Dexie from 'dexie'
import { afterAll, describe, expect, it } from 'vitest'
import { exportData, importData, parseBackup } from '../db/backup'
import { CacheDB } from '../db/cacheDb'
import { CACHE_MAX_AGE, purgeCache } from '../db/maintenance'
import { db, TrackerDB } from '../db/trackerDb'
import { entry, media } from './fixtures'

describe('migration des bases existantes', () => {
  it('cache v1 → v2 : fiches périmées (tags à recharger), requêtes vidées, franchises gardées', async () => {
    const name = 'test-migration-cache'
    const old = new Dexie(name)
    old.version(1).stores({ media: 'id, fetchedAt', queries: 'key, fetchedAt', franchises: 'id, *mediaIds, computedAt' })
    await old.table('media').put(media(1, { fetchedAt: 999 }))
    await old.table('queries').put({ key: 'search:x', results: [], fetchedAt: 999 })
    await old.table('franchises').put({ id: 1, mediaIds: [1], computedAt: 999 })
    old.close()

    const cache = new CacheDB(name)
    expect((await cache.media.get(1))!.fetchedAt).toBe(0)
    expect(await cache.queries.count()).toBe(0)
    expect(await cache.franchises.count()).toBe(1)
    expect(await cache.kv.count()).toBe(0)
    await cache.delete()
  })

  it('mes données v1 → v2 : entrées et journal intacts', async () => {
    const name = 'test-migration-tracker'
    const old = new Dexie(name)
    old.version(1).stores({ entries: 'mediaId, franchiseId, status, updatedAt', log: '++id, mediaId, at', meta: 'key' })
    const { viewings: _w, followed: _f, ...v1 } = entry(1, { score: 4 })
    await old.table('entries').put({ ...v1, progress: 5 })
    await old.table('log').add({ mediaId: 1, episode: 5, at: 1 })
    old.close()

    const tracker = new TrackerDB(name)
    expect((await tracker.entries.get(1))!.score).toBe(4)
    expect(await tracker.log.count()).toBe(1)
    expect(await tracker.hidden.count()).toBe(0)
    await tracker.delete()
  })

  it('mes données v2 → v3 : N épisodes vus deviennent les épisodes 1 à N, sans perte', async () => {
    const name = 'test-migration-v3'
    const old = new Dexie(name)
    old.version(1).stores({ entries: 'mediaId, franchiseId, status, updatedAt', log: '++id, mediaId, at', meta: 'key' })
    old.version(2).stores({ hidden: 'mediaId' })
    await old.table('entries').bulkPut([
      { mediaId: 1, franchiseId: 1, status: 'CURRENT', progress: 7, score: 4.5, addedAt: 1, startedAt: 2, completedAt: null, updatedAt: 3 },
      { mediaId: 2, franchiseId: 2, status: 'PLANNING', progress: 0, score: null, addedAt: 1, startedAt: null, completedAt: null, updatedAt: 3 },
      { mediaId: 3, franchiseId: 3, status: 'COMPLETED', progress: 12, score: 5, addedAt: 1, startedAt: 2, completedAt: 9, updatedAt: 3 },
      { mediaId: 4, franchiseId: 4, status: 'DROPPED', progress: 2, score: null, addedAt: 1, startedAt: 2, completedAt: null, updatedAt: 3 },
    ])
    await old.table('log').add({ mediaId: 1, episode: 7, at: 5 })
    await old.table('hidden').put({ mediaId: 99, at: 1 })
    old.close()

    const tracker = new TrackerDB(name)
    const one = await tracker.entries.get(1)
    expect(one).toEqual({ mediaId: 1, franchiseId: 1, status: 'CURRENT', viewings: [{ number: 1, watched: [[1, 7]], startedAt: 2, endedAt: null, state: 'current' }], followed: true, score: 4.5, addedAt: 1, startedAt: 2, completedAt: null, updatedAt: 3 })
    expect(one).not.toHaveProperty('progress')
    expect((await tracker.entries.get(2))!.viewings).toEqual([])
    expect(await tracker.entries.get(3)).toMatchObject({ status: 'COMPLETED', completedAt: 9, viewings: [{ watched: [[1, 12]], endedAt: 9, state: 'completed' }] })
    expect(await tracker.entries.get(4)).toMatchObject({ status: 'DROPPED', followed: true, viewings: [{ watched: [[1, 2]], state: 'current' }] })
    expect(await tracker.log.count()).toBe(1)
    expect(await tracker.hidden.count()).toBe(1)
    await tracker.delete()
  })
})

describe('migration du journal', () => {
  it('v3 → v4 : les coches en lot passent en date inconnue, les autres ne bougent pas', async () => {
    const name = 'test-migration-v4'
    const old = new Dexie(name)
    old.version(3).stores({ entries: 'mediaId, franchiseId, status, updatedAt', log: '++id, mediaId, at', meta: 'key', hidden: 'mediaId' })
    await old.table('log').bulkAdd([{ mediaId: 1, episode: 1, at: 5, bulk: true }, { mediaId: 1, episode: 2, at: 6 }])
    old.close()
    const tracker = new TrackerDB(name)
    const log = await tracker.log.toArray()
    expect(log.map(({ episode, at }) => [episode, at])).toEqual([[1, null], [2, 6]])
    expect(log[0]).not.toHaveProperty('bulk')
    await tracker.delete()
  })
})

describe('sauvegarde des animes masqués', () => {
  it('export → import conserve les masqués ; un ancien export ne les efface pas', async () => {
    await db.hidden.put({ mediaId: 42, at: 1 })
    const backup = parseBackup(JSON.stringify(await exportData(1)))
    expect(backup.hidden).toEqual([{ mediaId: 42, at: 1 }])

    await db.hidden.clear()
    await importData(backup)
    expect(await db.hidden.count()).toBe(1)

    const { hidden: _hidden, ...legacy } = backup
    await importData(parseBackup(JSON.stringify(legacy)))
    expect(await db.hidden.count()).toBe(1)
    await db.hidden.clear()
  })

  it('refuse une liste de masqués invalide', () => {
    expect(() => parseBackup(JSON.stringify({ app: 'anime-tracker', version: 2, entries: [], log: [], hidden: [{ mediaId: 'x' }] }))).toThrow()
  })

  it('un export marqué « bulk » passe en date inconnue', () => {
    const backup = parseBackup(JSON.stringify({ app: 'anime-tracker', version: 2, exportedAt: 1, entries: [], log: [{ mediaId: 1, episode: 1, at: 5, bulk: true }, { mediaId: 1, episode: 2, at: 6 }] }))
    expect(backup.log).toEqual([{ mediaId: 1, episode: 1, at: null, viewing: 1 }, { mediaId: 1, episode: 2, at: 6, viewing: 1 }])
  })

  it('un ancien export (v1, compteur) reste importable', () => {
    const { viewings: _w, followed: _f, ...v1 } = entry(1)
    const backup = parseBackup(JSON.stringify({ app: 'anime-tracker', version: 1, exportedAt: 1, entries: [{ ...v1, progress: 3 }], log: [] }))
    expect(backup.version).toBe(3)
    expect(backup.entries[0]).toMatchObject({ followed: true, viewings: [{ number: 1, watched: [[1, 3]], state: 'current' }] })
    expect(backup.entries[0]).not.toHaveProperty('progress')
  })

  it('l’export garde les cases, le suivi et les dates inconnues', async () => {
    await db.entries.put(entry(5, { watched: [[1, 2], [5, 5]], followed: false }))
    await db.log.add({ mediaId: 5, episode: 1, at: null, viewing: 1 })
    const backup = parseBackup(JSON.stringify(await exportData(1)))
    await db.entries.clear()
    await db.log.clear()
    await importData(backup)
    expect(await db.entries.get(5)).toMatchObject({ followed: false, viewings: [{ watched: [[1, 2], [5, 5]] }] })
    expect((await db.log.toArray())[0]!.at).toBeNull()
    await db.entries.clear()
    await db.log.clear()
  })
})

describe('purge du cache', () => {
  const tracker = new TrackerDB('test-tracker')
  const cache = new CacheDB('test-cache-purge')
  afterAll(async () => {
    await tracker.delete()
    await cache.delete()
  })

  it('supprime ce qui a plus de 30 jours, sauf les fiches de ma liste', async () => {
    const now = CACHE_MAX_AGE * 2
    await tracker.entries.put(entry(1, { franchiseId: 1 }))
    await cache.franchises.put({ id: 1, mediaIds: [1, 2], computedAt: 0 })
    await cache.media.bulkPut([media(1), media(2), media(3), media(4, { fetchedAt: now })])
    await cache.queries.put({ key: 'search:x', results: [], fetchedAt: 0 })
    await cache.kv.bulkPut([{ key: 'synopsis:3', value: 'vieux', fetchedAt: 0 }, { key: 'synopsis:4', value: 'récent', fetchedAt: now }])

    await purgeCache(now, { tracker, cache })

    expect((await cache.media.toArray()).map((m) => m.id).sort()).toEqual([1, 2, 4])
    expect(await cache.queries.count()).toBe(0)
    expect((await cache.kv.toArray()).map((k) => k.key)).toEqual(['synopsis:4'])
    expect(await cache.franchises.count()).toBe(1)
    expect(await tracker.entries.count()).toBe(1)
  })
})
