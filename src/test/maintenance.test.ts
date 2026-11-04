import { afterAll, describe, expect, it } from 'vitest'
import { CacheDB } from '../db/cacheDb'
import { CACHE_MAX_AGE, purgeCache } from '../db/maintenance'
import { TrackerDB } from '../db/trackerDb'
import { entry, media } from './fixtures'

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

    await purgeCache(now, { tracker, cache })

    expect((await cache.media.toArray()).map((m) => m.id).sort()).toEqual([1, 2, 4])
    expect(await cache.queries.count()).toBe(0)
    expect(await cache.franchises.count()).toBe(1)
    expect(await tracker.entries.count()).toBe(1)
  })
})
