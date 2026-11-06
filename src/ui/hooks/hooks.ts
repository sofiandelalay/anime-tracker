import { liveQuery } from 'dexie'
import { useEffect, useRef, useState, type DependencyList } from 'react'
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
    const media = new Map((await cacheDb.media.bulkGet([...ids])).filter((m): m is Media => !!m).map((m) => [m.id, m]))
    const franchises = new Map(franchiseList.map((f) => [f.id, f]))
    return { entries, media, franchises, model: buildListModel(entries, media, franchises) }
  }, [])
}

/** Tant que `failed` : réessaie au retour du réseau, et de temps en temps si on est en ligne. */
export function useAutoRetry(failed: boolean, retry: () => void, everyMs = 20_000): void {
  const latest = useRef(retry)
  latest.current = retry
  useEffect(() => {
    if (!failed) return
    const run = () => {
      if (navigator.onLine) latest.current()
    }
    const timer = setInterval(run, everyMs)
    window.addEventListener('online', run)
    return () => {
      clearInterval(timer)
      window.removeEventListener('online', run)
    }
  }, [failed, everyMs])
}
