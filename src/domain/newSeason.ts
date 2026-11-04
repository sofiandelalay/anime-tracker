import { compareByStart } from './format'
import { PROGRESS_FORMATS } from './franchise'
import type { Entry, Media } from './types'

const ANNOUNCED = new Set(['NOT_YET_RELEASED', 'RELEASING'])

/**
 * Détecte une nouvelle saison pour une franchise entièrement Terminée :
 * un SEQUEL (TV / TV_SHORT / ONA) annoncé ou en diffusion, pas encore dans ma liste.
 * Une franchise contenant une saison Abandonnée (ou encore à suivre) ne revient jamais ici.
 * Renvoie l'id de la saison annoncée la plus proche, ou null.
 */
export function detectNewSeason(
  entries: Entry[],
  media: Map<number, Media>,
  franchiseMediaIds: number[] = [],
): number | null {
  if (entries.length === 0 || !entries.every((e) => e.status === 'COMPLETED')) return null
  const tracked = new Set(entries.map((e) => e.mediaId))
  const candidates = new Set<number>()

  for (const e of entries) {
    for (const r of media.get(e.mediaId)?.relations ?? []) {
      if (
        r.relationType === 'SEQUEL' &&
        r.format && PROGRESS_FORMATS.has(r.format) &&
        r.status && ANNOUNCED.has(r.status) &&
        !tracked.has(r.id)
      ) candidates.add(r.id)
    }
  }
  // Saisons de la franchise reliées via un film (S1 → film → S2) : on regarde aussi les membres.
  for (const id of franchiseMediaIds) {
    const m = media.get(id)
    if (!tracked.has(id) && m?.status && ANNOUNCED.has(m.status)) candidates.add(id)
  }
  if (candidates.size === 0) return null

  const known = [...candidates].map((id) => media.get(id)).filter((m): m is Media => !!m)
  if (known.length > 0) return known.sort(compareByStart)[0]!.id
  return Math.min(...candidates)
}
