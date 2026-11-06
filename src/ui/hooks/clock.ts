import { useSyncExternalStore } from 'react'
import { airingLabel } from '../../domain/format'
import type { Media } from '../../domain/types'

const listeners = new Set<() => void>()
let timer: ReturnType<typeof setInterval> | undefined

const emit = () => listeners.forEach((l) => l())
// iOS suspend les minuteries en arrière-plan : on se recale au retour dans l'appli.
const onVisible = () => {
  if (document.visibilityState === 'visible') emit()
}

/** Une seule minuterie pour tous les comptes à rebours, même avec une grille entière à l'écran. */
export function subscribeMinute(listener: () => void): () => void {
  listeners.add(listener)
  if (listeners.size === 1) {
    timer = setInterval(emit, 60_000)
    document.addEventListener('visibilitychange', onVisible)
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }
}

/** Un texte qui dépend de l'heure, recalculé chaque minute. */
export function useMinuteText(compute: () => string | null): string | null {
  return useSyncExternalStore(subscribeMinute, compute)
}

/** Texte du compte à rebours, actualisé chaque minute (le composant ne se redessine que s'il change). */
export function useAiringLabel(next: Media['nextAiring'] | undefined): string | null {
  return useSyncExternalStore(subscribeMinute, () => (next ? airingLabel(next, Date.now()) : null))
}
