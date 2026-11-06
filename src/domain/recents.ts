/** Mes 10 dernières recherches, gardées sur l'appareil. */
import { db, getMeta, setMeta } from '../db/trackerDb'

export const MAX_RECENTS = 10
const KEY = 'recentSearches'

const clean = (query: string) => query.trim().replace(/\s+/g, ' ')

/** La plus récente d'abord, sans doublon (casse ignorée), 10 au plus. */
export function addRecent(list: string[], query: string): string[] {
  const q = clean(query)
  if (q.length < 2) return list
  return [q, ...list.filter((r) => r.toLowerCase() !== q.toLowerCase())].slice(0, MAX_RECENTS)
}

export const readRecents = async (): Promise<string[]> => (await getMeta<string[]>(KEY)) ?? []

export const rememberSearch = (query: string): Promise<void> =>
  db.transaction('rw', db.meta, async () => setMeta(KEY, addRecent(await readRecents(), query)))

export const forgetSearch = (query: string): Promise<void> =>
  db.transaction('rw', db.meta, async () => setMeta(KEY, (await readRecents()).filter((r) => r !== query)))

export const clearRecents = (): Promise<void> => setMeta(KEY, [])
