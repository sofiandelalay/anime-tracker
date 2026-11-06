import { useEffect, useState } from 'react'
import { addPastWatch, deleteViewing, startRewatch } from '../../domain/actions'
import { countWatched } from '../../domain/episodes'
import { viewingDates } from '../../domain/format'
import { isReleased } from '../../domain/progress'
import { VIEWING_STATE_LABEL } from '../../domain/viewings'
import type { Media, Viewing } from '../../domain/types'
import { IconChevronDown, IconClose } from '../components/Icons'
import { Sheet } from '../components/Sheet'
import { useToast } from '../components/Toast'
import type { AnimeData } from '../hooks/anime'
import { ActionSheet } from './AnimeParts'

/** « Revoir » : tout l'anime ou une saison. */
export function RewatchSheet({ open, data, onClose }: { open: boolean; data: AnimeData; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} label="Revoir cet anime">
      {open && <RewatchChoices data={data} onClose={onClose} />}
    </Sheet>
  )
}

function RewatchChoices({ data, onClose }: { data: AnimeData; onClose: () => void }) {
  const toast = useToast()
  const seasons = data.seasons.filter(isReleased)
  const [choosing, setChoosing] = useState(false)
  const [seasonId, setSeasonId] = useState(seasons[0]?.id)
  const start = async (list: Media[]) => {
    const undo = await startRewatch(data.franchiseId, list)
    onClose()
    toast({ message: 'Revisionnage lancé', action: { label: 'Annuler', onAction: undo }, duration: 5000 })
  }
  const chosen = seasons.find((m) => m.id === seasonId)
  return (
    <div className="where">
      <h2 className="where__title">Revoir</h2>
      <p className="where__hint">Un nouveau visionnage démarre, cases décochées. Le précédent est conservé.</p>
      {!choosing ? (
        <div className="where__choices">
          <button type="button" className="button button--primary" onClick={() => void start(seasons)}>Revoir tout l’anime</button>
          {seasons.length > 1 && (
            <button type="button" className="button button--plain" onClick={() => setChoosing(true)}>Revoir une saison</button>
          )}
        </div>
      ) : (
        <>
          <label className="field">
            <span>Saison</span>
            <select value={seasonId} onChange={(e) => setSeasonId(Number(e.target.value))}>
              {seasons.map((m) => <option key={m.id} value={m.id}>Saison {data.seasonIds.indexOf(m.id) + 1}</option>)}
            </select>
          </label>
          <button type="button" className="button button--primary" disabled={!chosen} onClick={() => chosen && void start([chosen])}>Revoir cette saison</button>
        </>
      )}
    </div>
  )
}

/** Section repliée : chaque visionnage, l'ajout d'une fois passée, et la seule suppression possible. */
export function ViewingHistory({ data }: { data: AnimeData }) {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState<{ media: Media; viewing: Viewing } | null>(null)
  const released = data.seasons.filter(isReleased)
  const multiple = data.seasonIds.length > 1
  if (released.length === 0) return null

  const remove = async () => {
    if (!removing) return
    const undo = await deleteViewing(data.franchiseId, removing.media.id, removing.viewing.number)
    toast({ message: 'Visionnage supprimé', action: { label: 'Annuler', onAction: undo }, duration: 5000 })
  }

  return (
    <section className="detail__section">
      <button type="button" className="history__toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span>Historique des visionnages</span>
        <IconChevronDown width={18} height={18} className={`season__chevron${open ? ' is-open' : ''}`} />
      </button>
      {open && (
        <div className="history">
          {released.map((m) => {
            const viewings = [...(data.entries.get(m.id)?.viewings ?? [])].sort((a, b) => b.number - a.number)
            if (viewings.length === 0) return null
            return (
              <div key={m.id}>
                {multiple && <h4 className="history__season">Saison {data.seasonIds.indexOf(m.id) + 1}</h4>}
                <ul className="history__list">
                  {viewings.map((v) => (
                    <li key={v.number} className="history__row">
                      <div className="history__text">
                        <span className="history__name">Visionnage {v.number} · {VIEWING_STATE_LABEL[v.state]}</span>
                        <span className="history__meta">{viewingDates(v)} · {countWatched(v.watched)}{m.episodes ? ` / ${m.episodes}` : ''} ép.</span>
                      </div>
                      <button
                        type="button"
                        className="icon-button icon-button--muted"
                        onClick={() => setRemoving({ media: m, viewing: v })}
                        aria-label={`Supprimer le visionnage ${v.number}${multiple ? ` de la saison ${data.seasonIds.indexOf(m.id) + 1}` : ''}`}
                      >
                        <IconClose width={16} height={16} />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
          {adding ? (
            <PastViewingForm data={data} seasons={released} onDone={() => setAdding(false)} />
          ) : (
            <button type="button" className="text-button history__add" onClick={() => setAdding(true)}>Ajouter un visionnage passé</button>
          )}
        </div>
      )}
      {removing && (
        <ActionSheet
          message={`Supprimer le visionnage ${removing.viewing.number} ? Ses épisodes ne compteront plus dans les stats.`}
          actions={[{ label: 'Supprimer', danger: true, onAction: () => void remove() }]}
          onClose={() => setRemoving(null)}
        />
      )}
    </section>
  )
}

function PastViewingForm({ data, seasons, onDone }: { data: AnimeData; seasons: Media[]; onDone: () => void }) {
  const toast = useToast()
  const [seasonId, setSeasonId] = useState(seasons[0]!.id)
  const [date, setDate] = useState('')
  useEffect(() => {
    if (!seasons.some((m) => m.id === seasonId)) setSeasonId(seasons[0]!.id)
  }, [seasons, seasonId])
  const add = async () => {
    const media = seasons.find((m) => m.id === seasonId)
    if (!media) return
    const undo = await addPastWatch(media, date ? new Date(`${date}T12:00:00`).getTime() : null)
    onDone()
    toast({ message: 'Visionnage ajouté', action: { label: 'Annuler', onAction: undo }, duration: 5000 })
  }
  return (
    <div className="history__form">
      <div className="where__fields">
        {seasons.length > 1 && (
          <label className="field">
            <span>Saison</span>
            <select value={seasonId} onChange={(e) => setSeasonId(Number(e.target.value))}>
              {seasons.map((m) => <option key={m.id} value={m.id}>Saison {data.seasonIds.indexOf(m.id) + 1}</option>)}
            </select>
          </label>
        )}
        <label className="field">
          <span>Date (facultative)</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
      </div>
      <div className="history__form-actions">
        <button type="button" className="button button--plain button--small" onClick={onDone}>Annuler</button>
        <button type="button" className="button button--primary button--small" onClick={() => void add()}>Ajouter</button>
      </div>
    </div>
  )
}
