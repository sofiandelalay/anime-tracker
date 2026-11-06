import { useEffect, useState } from 'react'
import { addAnime, type Undo } from '../../domain/actions'
import { displayTitle } from '../../domain/format'
import { maxEpisode } from '../../domain/progress'
import { defaultSeason, type Where } from '../../domain/tracking'
import type { Media } from '../../domain/types'
import { IconMinus, IconPlus } from '../components/Icons'
import { Sheet } from '../components/Sheet'
import { useToast } from '../components/Toast'
import { useAnimeData } from '../hooks/anime'

const MAX_TIMES = 20

/** « Tu en es où ? » : la seule question posée à l'ajout d'un anime entier. */
export function WhereSheet({ media, onClose, onSeenAll }: { media: Media | null; onClose: () => void; onSeenAll: (media: Media, undo: Undo) => void }) {
  const [last, setLast] = useState(media)
  useEffect(() => {
    if (media) setLast(media)
  }, [media])
  const m = media ?? last
  return (
    <Sheet open={!!media} onClose={onClose} label="Tu en es où ?">
      {m && <Content key={m.id} media={m} onClose={onClose} onSeenAll={onSeenAll} />}
    </Sheet>
  )
}

function Content({ media, onClose, onSeenAll }: { media: Media; onClose: () => void; onSeenAll: (media: Media, undo: Undo) => void }) {
  const toast = useToast()
  const data = useAnimeData(media.id)
  const [started, setStarted] = useState(false)
  const [seasonId, setSeasonId] = useState<number | null>(null)
  const [episode, setEpisode] = useState(1)
  const [busy, setBusy] = useState(false)
  const [times, setTimes] = useState(1)

  const seasons = (data?.seasons ?? [media])
  const available = seasons.filter((m) => maxEpisode(m) > 0)
  const chosen = available.find((m) => m.id === seasonId) ?? defaultSeason(seasons, media.id)
  const max = chosen ? maxEpisode(chosen) : 0

  const add = async (where: Where) => {
    setBusy(true)
    try {
      const undo = await addAnime(media, where)
      onClose()
      // La note d'abord, le toast « Marqué comme vu » ensuite.
      if (where && 'all' in where) {
        onSeenAll(media, undo)
        return
      }
      toast({ message: 'Ajouté à ma liste', action: { label: 'Annuler', onAction: undo }, duration: 5000 })
    } catch {
      setBusy(false)
      toast({ message: 'Impossible d’ajouter cet anime pour le moment.' })
    }
  }

  return (
    <div className="where">
      <h2 className="where__title">Tu en es où ?</h2>
      <p className="where__anime">{displayTitle(data?.root ?? media)}</p>

      {!started ? (
        <div className="where__choices">
          <button type="button" className="button button--primary" disabled={busy} onClick={() => add(null)}>Pas commencé</button>
          <button type="button" className="button button--plain" disabled={busy || !chosen} onClick={() => setStarted(true)}>Déjà commencé</button>
          <button type="button" className="button button--plain" disabled={busy} onClick={() => add({ all: true, times })}>J’ai tout vu</button>
          <div className="where__times">
            <span id="where-times">Combien de fois ?</span>
            <div className="where__counter" role="group" aria-labelledby="where-times">
              <button type="button" className="icon-button icon-button--filled" disabled={times <= 1} onClick={() => setTimes(times - 1)} aria-label="Une fois de moins"><IconMinus width={18} height={18} /></button>
              <span className="where__count" aria-live="polite">{times}</span>
              <button type="button" className="icon-button icon-button--filled" disabled={times >= MAX_TIMES} onClick={() => setTimes(times + 1)} aria-label="Une fois de plus"><IconPlus width={18} height={18} /></button>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="where__fields">
            {available.length > 1 && (
              <label className="field">
                <span>Saison</span>
                <select
                  value={chosen?.id}
                  onChange={(e) => {
                    setSeasonId(Number(e.target.value))
                    setEpisode(1)
                  }}
                >
                  {available.map((m) => <option key={m.id} value={m.id}>Saison {seasons.indexOf(m) + 1}</option>)}
                </select>
              </label>
            )}
            <label className="field">
              <span>Épisode</span>
              {Number.isFinite(max) ? (
                <select value={Math.min(episode, max)} onChange={(e) => setEpisode(Number(e.target.value))}>
                  {Array.from({ length: max }, (_, i) => <option key={i} value={i + 1}>Épisode {i + 1}</option>)}
                </select>
              ) : (
                <input type="number" inputMode="numeric" min={1} value={episode} onChange={(e) => setEpisode(Math.max(1, Number(e.target.value) || 1))} />
              )}
            </label>
          </div>
          <p className="where__hint">Les saisons d’avant seront cochées et terminées.</p>
          <button
            type="button"
            className="button button--primary"
            disabled={busy || !chosen}
            onClick={() => chosen && add({ seasonId: chosen.id, episode: Math.min(episode, max) })}
          >
            Ajouter à ma liste
          </button>
        </>
      )}
    </div>
  )
}
