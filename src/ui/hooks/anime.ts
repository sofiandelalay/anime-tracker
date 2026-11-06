import { useEffect, useRef } from 'react'
import { fetchMediaByIds } from '../../api/media'
import { cacheDb } from '../../db/cacheDb'
import { db } from '../../db/trackerDb'
import { computeFranchise } from '../../domain/actions'
import { compareByStart } from '../../domain/format'
import { animeState, type AnimeState } from '../../domain/listModel'
import type { Entry, Media } from '../../domain/types'
import { useLive } from './hooks'

export interface AnimeData {
  franchiseId: number
  /** Saisons connues de l'anime, dans l'ordre. */
  seasonIds: number[]
  seasons: Media[]
  entries: Map<number, Entry>
  /** Première saison : l'anime dans son ensemble. */
  root: Media | undefined
  /** La fiche d'où l'on vient (peut être une saison du milieu). */
  touched: Media | undefined
  state: AnimeState
  hasEntries: boolean
}

/** Tout ce qu'il faut pour afficher un anime, suivi ou non. Le détail des saisons est calculé ici, à l'ouverture. */
export function useAnimeData(mediaId: number, franchiseHint?: number): AnimeData | undefined {
  const data = useLive(async (): Promise<AnimeData> => {
    // Relu à chaque écriture : ajouter une S2 peut rattacher la fiche à la franchise de sa S1.
    const franchiseId =
      (await db.entries.get(mediaId))?.franchiseId ??
      (await cacheDb.franchises.where('mediaIds').equals(mediaId).first())?.id ??
      franchiseHint ??
      mediaId
    const group = await db.entries.where('franchiseId').equals(franchiseId).toArray()
    const franchise = await cacheDb.franchises.get(franchiseId)
    const ids = new Set<number>([mediaId, ...group.map((e) => e.mediaId), ...(franchise?.mediaIds ?? [])])
    const media = new Map((await cacheDb.media.bulkGet([...ids])).filter((m): m is Media => !!m).map((m) => [m.id, m]))
    const known = [...ids].flatMap((id) => {
      const m = media.get(id)
      return m ? [m] : []
    })
    const seasonIds = franchise?.mediaIds ?? [...known].sort(compareByStart).map((m) => m.id)
    const seasons = seasonIds.flatMap((id) => {
      const m = media.get(id)
      return m ? [m] : []
    })
    return {
      franchiseId,
      seasonIds,
      seasons,
      entries: new Map(group.map((e) => [e.mediaId, e])),
      root: media.get(seasonIds[0] ?? mediaId) ?? media.get(mediaId),
      touched: media.get(mediaId),
      state: animeState(group, media),
      hasEntries: group.length > 0,
    }
  }, [mediaId, franchiseHint])

  const asked = useRef(false)
  useEffect(() => {
    if (!data || !navigator.onLine) return
    const missing = data.seasonIds.filter((id) => !data.seasons.some((m) => m.id === id))
    if (!data.touched) missing.push(mediaId)
    if (missing.length > 0) void fetchMediaByIds(missing).catch(() => undefined)
    if (data.touched && !asked.current) {
      asked.current = true
      // Hors de ma liste, ou franchise inconnue : on calcule (gardé en cache ensuite).
      void cacheDb.franchises.where('mediaIds').equals(mediaId).first().then((f) => {
        if (!f) return computeFranchise(data.touched!).catch(() => undefined)
      })
    }
  }, [data, mediaId])

  return data
}
