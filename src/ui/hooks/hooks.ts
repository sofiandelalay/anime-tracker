import { liveQuery } from 'dexie'
import { useEffect, useState, type DependencyList } from 'react'
import { cacheDb } from '../../db/cacheDb'
import { db } from '../../db/trackerDb'
import { buildListModel, type ListModel } from '../../domain/listModel'
import type { Entry, Franchise, Media } from '../../domain/types'

/** Requête Dexie réactive (se met à jour à chaque écriture). undefined = chargement. */
export function useLive<T>(query: () => Promise<T>, deps: DependencyList): T | undefined {
  const [value, setValue] = useState<T>()
  useEffect(() => {
    const sub = liveQuery(query).subscribe({ next: setValue, error: (e) => console.error(e) })
    return () => sub.unsubscribe()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return value
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine)
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  return online
}

export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

export interface Library {
  entries: Entry[]
  media: Map<number, Media>
  franchises: Map<number, Franchise>
  model: ListModel
}

/** Ma liste complète, lue depuis IndexedDB (fonctionne hors ligne). */
export function useLibrary(): Library | undefined {
  return useLive(async () => {
    const entries = await db.entries.toArray()
    const fids = [...new Set(entries.map((e) => e.franchiseId))]
    const franchiseList = (await cacheDb.franchises.bulkGet(fids)).filter((f): f is Franchise => !!f)
    const ids = new Set(entries.map((e) => e.mediaId))
    for (const f of franchiseList) f.mediaIds.forEach((id) => ids.add(id))
    const first = (await cacheDb.media.bulkGet([...ids])).filter((m): m is Media => !!m)
    const sequels = first.flatMap((m) => m.relations.filter((r) => r.relationType === 'SEQUEL').map((r) => r.id))
    const extra = (await cacheDb.media.bulkGet(sequels.filter((id) => !ids.has(id)))).filter((m): m is Media => !!m)
    const media = new Map([...first, ...extra].map((m) => [m.id, m]))
    const franchises = new Map(franchiseList.map((f) => [f.id, f]))
    return { entries, media, franchises, model: buildListModel(entries, media, franchises) }
  }, [])
}
