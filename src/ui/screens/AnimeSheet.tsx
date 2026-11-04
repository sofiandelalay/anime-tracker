import { useEffect, useState } from 'react'
import { fetchMediaByIds } from '../../api/media'
import { cacheDb } from '../../db/cacheDb'
import { db } from '../../db/trackerDb'
import { addAnime, archiveFranchise, setProgress, setScore, setStatus, type ProgressOutcome } from '../../domain/actions'
import { displayTitle, formatLabel, mediaYear } from '../../domain/format'
import { seasonNumber } from '../../domain/franchise'
import { maxEpisode, progressInfo } from '../../domain/progress'
import { STATUS_LABEL, type Entry, type Media, type WatchStatus } from '../../domain/types'
import { Cover, ProgressBar, Segmented, Stars } from '../components/Bits'
import { IconMinus, IconPlus } from '../components/Icons'
import { Sheet } from '../components/Sheet'
import { useToast } from '../components/Toast'
import { useLive } from '../hooks/hooks'

export interface SheetTarget {
  franchiseId: number
  mediaId: number
}

interface Props {
  target: SheetTarget | null
  onClose: () => void
  onProgress: (outcome: ProgressOutcome) => void
}

const STATUS_OPTIONS = (Object.keys(STATUS_LABEL) as WatchStatus[]).map((s) => ({ value: s, label: STATUS_LABEL[s] }))

export function AnimeSheet({ target, onClose, onProgress }: Props) {
  // Garde la dernière cible pendant l'animation de fermeture.
  const [last, setLast] = useState(target)
  useEffect(() => {
    if (target) setLast(target)
  }, [target])
  const t = target ?? last

  return (
    <Sheet open={!!target} onClose={onClose} label="Détails de l’anime">
      {t && <AnimeSheetContent key={`${t.franchiseId}-${t.mediaId}`} target={t} onClose={onClose} onProgress={onProgress} />}
    </Sheet>
  )
}

function AnimeSheetContent({ target, onClose, onProgress }: { target: SheetTarget } & Omit<Props, 'target'>) {
  const toast = useToast()
  const [selected, setSelected] = useState(target.mediaId)

  const data = useLive(async () => {
    const entries = await db.entries.where('franchiseId').equals(target.franchiseId).toArray()
    const franchise = await cacheDb.franchises.get(target.franchiseId)
    const ids = new Set<number>([target.mediaId, ...entries.map((e) => e.mediaId), ...(franchise?.mediaIds ?? [])])
    const media = new Map(
      (await cacheDb.media.bulkGet([...ids])).filter((m): m is Media => !!m).map((m) => [m.id, m]),
    )
    return { entries: new Map(entries.map((e) => [e.mediaId, e])), seasons: franchise?.mediaIds ?? [], media }
  }, [target.franchiseId, target.mediaId])

  // Saisons non encore en cache (ex. nouvelle saison) : on les récupère.
  useEffect(() => {
    if (!data) return
    const missing = [...data.seasons, target.mediaId].filter((id) => !data.media.has(id))
    if (missing.length && navigator.onLine) void fetchMediaByIds(missing).catch(() => undefined)
  }, [data, target.mediaId])

  if (!data) return <div className="sheet-loading" aria-busy="true" />
  const media = data.media.get(selected)
  if (!media) return <div className="sheet-loading" aria-busy="true" />

  const entry = data.entries.get(selected) ?? null
  const title = displayTitle(media)
  const info = progressInfo(entry, media)
  const max = maxEpisode(media)
  const seasonNo = seasonNumber(data.seasons, selected)
  const meta = [seasonNo ? `Saison ${seasonNo}` : null, mediaYear(media), formatLabel(media.format), media.episodes ? `${media.episodes} ép.` : null]
    .filter(Boolean)
    .join(' · ')
  const canArchive = [...data.entries.values()].some((e) => e.status === 'CURRENT' || e.status === 'PLANNING')

  const change = async (delta: number) => {
    const out = await setProgress(selected, (p) => p + delta)
    if (out.changed) onProgress(out)
  }
  const changeStatus = async (s: WatchStatus) => {
    const undo = await setStatus(selected, s)
    toast({ message: `Statut : ${STATUS_LABEL[s]}`, action: { label: 'Annuler', onAction: undo }, duration: 5000 })
  }
  const archive = async () => {
    const undo = await archiveFranchise(target.franchiseId)
    onClose()
    toast({ message: 'Archivé', action: { label: 'Annuler', onAction: undo }, duration: 5000 })
  }

  return (
    <div className="detail">
      <header className="detail__header">
        <Cover src={media.cover} size="l" />
        <div className="detail__heading">
          <h2 className="detail__title">{title}</h2>
          <p className="detail__meta">{meta}</p>
        </div>
      </header>

      {entry ? (
        <>
          <section className="detail__section" aria-label="Épisodes vus">
            <div className="stepper">
              <button type="button" className="icon-button icon-button--large" onClick={() => change(-1)} disabled={info.watched <= 0} aria-label="Retirer un épisode">
                <IconMinus />
              </button>
              <div className="stepper__value" aria-live="polite">
                <span className="stepper__number">{info.watched}</span>
                <span className="stepper__total">
                  {info.total ? `sur ${info.total}` : 'épisodes'}
                  {info.airedRatio !== null && info.aired !== null ? ` · ${info.aired} sortis` : ''}
                </span>
              </div>
              <button type="button" className="icon-button icon-button--large icon-button--filled" onClick={() => change(1)} disabled={info.watched >= max} aria-label="Ajouter un épisode">
                <IconPlus />
              </button>
            </div>
            <ProgressBar info={info} label="Progression de la saison" />
          </section>

          <section className="detail__section">
            <Segmented small label="Statut" options={STATUS_OPTIONS} value={entry.status} onChange={changeStatus} />
          </section>

          <section className="detail__section detail__rating">
            <Stars value={entry.score} onChange={(v) => setScore(selected, v)} />
          </section>
        </>
      ) : (
        <section className="detail__section">
          <button type="button" className="button button--primary" onClick={() => addAnime(media).then(() => toast({ message: 'Ajouté à « À voir »' }))}>
            Ajouter à ma liste
          </button>
        </section>
      )}

      {data.seasons.length > 1 && (
        <section className="detail__section">
          <h3 className="section-title">Saisons</h3>
          <ul className="seasons">
            {data.seasons.map((id, i) => (
              <SeasonRow
                key={id}
                number={i + 1}
                media={data.media.get(id)}
                entry={data.entries.get(id) ?? null}
                selected={id === selected}
                onSelect={() => setSelected(id)}
              />
            ))}
          </ul>
        </section>
      )}

      {canArchive && (
        <section className="detail__section">
          <button type="button" className="button button--plain button--danger" onClick={archive}>
            Archiver
          </button>
        </section>
      )}
    </div>
  )
}

function SeasonRow({ number, media, entry, selected, onSelect }: {
  number: number
  media: Media | undefined
  entry: Entry | null
  selected: boolean
  onSelect: () => void
}) {
  const status = entry ? STATUS_LABEL[entry.status] : 'Pas dans ma liste'
  return (
    <li>
      <button type="button" className={`season${selected ? ' is-selected' : ''}`} onClick={onSelect} aria-current={selected}>
        <span className="season__head">
          <span className="season__name">Saison {number}</span>
          <span className="season__status">{status}</span>
        </span>
        {media ? (
          <ProgressBar info={progressInfo(entry, media)} label={`Progression de la saison ${number}`} />
        ) : (
          <span className="skeleton skeleton--bar" />
        )}
      </button>
    </li>
  )
}
