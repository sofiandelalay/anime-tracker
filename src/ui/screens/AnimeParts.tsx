import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { loadEpisodeTitles } from '../../api/episodes'
import { fetchSynopsis } from '../../api/media'
import { cacheDb } from '../../db/cacheDb'
import {
  archiveFranchise, checkEpisode, checkThrough, markSeasonWatched, setScore, stopRewatch, unarchiveFranchise, uncheckEpisode, unfollowAnime,
  type EpisodeOutcome,
} from '../../domain/actions'
import { countWatched, episodeSlices, firstUnwatched, hasEpisode, planToggle } from '../../domain/episodes'
import { formatCountdown, formatStartDate } from '../../domain/format'
import { currentSeason } from '../../domain/listModel'
import { episodeRowCount, globalProgress, globalScore, isEpisodeAired, isReleased, maxEpisode, progressInfo } from '../../domain/progress'
import type { Entry, EpisodeRanges, Media } from '../../domain/types'
import { isRewatching, seasonViewsLine, watchedOf } from '../../domain/viewings'
import { ProgressBar, Stars, StarsDisplay } from '../components/Bits'
import { IconCheck, IconChevronDown } from '../components/Icons'
import { useToast } from '../components/Toast'
import type { AnimeData } from '../hooks/anime'
import { useMinuteText } from '../hooks/clock'
import { useLive } from '../hooks/hooks'
import { useAnimeFlow } from './AnimeFlow'

/** Synopsis replié au-delà de 5 lignes, chargé à la demande. Absent (hors ligne, pas de texte) : rien du tout. */
export function Synopsis({ mediaId }: { mediaId: number }) {
  const [text, setText] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [overflows, setOverflows] = useState(false)
  const paragraph = useRef<HTMLParagraphElement>(null)

  useEffect(() => {
    let stale = false
    setText(null)
    fetchSynopsis(mediaId)
      .then((t) => !stale && setText(t))
      .catch(() => !stale && setText(''))
    return () => {
      stale = true
    }
  }, [mediaId])

  // Mesuré replié : un texte de 5 lignes ou moins n'a pas besoin de « Lire plus ».
  useLayoutEffect(() => {
    const el = paragraph.current
    if (el && !open) setOverflows(el.scrollHeight > el.clientHeight + 1)
  }, [text, open])

  if (text === null) {
    return (
      <section className="detail__section" aria-busy="true" aria-label="Chargement du synopsis">
        <span className="skeleton skeleton--line" />
        <span className="skeleton skeleton--line" />
        <span className="skeleton skeleton--line" style={{ width: '60%' }} />
      </section>
    )
  }
  if (!text) return null
  return (
    <section className="detail__section">
      <p ref={paragraph} className={`synopsis${open ? '' : ' synopsis--folded'}`}>{text}</p>
      {(overflows || open) && (
        <button type="button" className="text-button" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? 'Lire moins' : 'Lire plus'}
        </button>
      )}
    </section>
  )
}

/** Progression de l'anime entier et note globale. */
export function GlobalProgress({ data }: { data: AnimeData }) {
  // Une seule saison : sa ligne porte déjà la barre, avec le repère des épisodes sortis.
  const showBar = data.seasonIds.length > 1
  const progress = globalProgress(data.seasons, data.entries)
  return (
    <section className="detail__section global">
      <div className="global__head">
        <span className="global__count">
          <strong>{progress.watched}</strong> / {progress.total} épisodes
        </span>
      </div>
      {showBar && (
        <div className="progress" role="progressbar" aria-label="Progression de l’anime" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.watched}>
          <span className="progress__fill" style={{ width: `${progress.ratio * 100}%` }} />
        </div>
      )}
    </section>
  )
}

/** Ma note : la globale (moyenne) et celle de chaque saison ; une seule ligne pour un anime à une saison. */
export function MyRating({ data }: { data: AnimeData }) {
  const flow = useAnimeFlow()
  const released = data.seasons.filter(isReleased)
  if (released.length === 0) return null
  const rate = async (media: Media, score: number | null) => {
    const out = await setScore(media, score)
    if (!out.followed) flow.recorded(out.franchiseId)
  }
  const single = data.seasonIds.length === 1
  const global = globalScore(data.entries.values())
  return (
    <section className="detail__section">
      <h3 className="section-title">Ma note</h3>
      <div className="group ratings">
        {!single && (
          <div className="rating" aria-label={global === null ? 'Note globale : pas encore notée' : `Note globale ${global.toLocaleString('fr-FR')} sur 5`}>
            <span className="rating__label">Globale</span>
            <span className="rating__value">{global === null ? '—' : global.toLocaleString('fr-FR')}</span>
            <StarsDisplay value={global} />
          </div>
        )}
        {released.map((m) => (
          <div className="rating" key={m.id}>
            <span className="rating__label">{single ? 'Ma note' : `Saison ${data.seasonIds.indexOf(m.id) + 1}`}</span>
            <Stars value={data.entries.get(m.id)?.score ?? null} onChange={(v) => rate(m, v)} size={24} />
          </div>
        ))}
      </div>
    </section>
  )
}

/** Archiver / Reprendre, puis « Ne plus suivre » en style discret : rien n'est supprimé. */
export function AnimeActions({ data, onDone }: { data: AnimeData; onDone?: () => void }) {
  const toast = useToast()
  const { state, franchiseId, entries } = data
  const canArchive = [...entries.values()].some((e) => e.status === 'CURRENT' || e.status === 'PLANNING')
  const rewatching = [...entries.values()].some(isRewatching)

  const archive = async () => {
    const undo = await archiveFranchise(franchiseId)
    onDone?.()
    toast({ message: 'Archivé', action: { label: 'Annuler', onAction: undo }, duration: 5000 })
  }
  const stop = async () => {
    const undo = await stopRewatch(franchiseId)
    toast({ message: 'Revisionnage arrêté', action: { label: 'Annuler', onAction: undo }, duration: 5000 })
  }
  const resume = async () => {
    const undo = await unarchiveFranchise(franchiseId)
    toast({ message: 'De retour dans ta liste', action: { label: 'Annuler', onAction: undo }, duration: 5000 })
  }
  const unfollow = async () => {
    const undo = await unfollowAnime(franchiseId)
    onDone?.()
    toast({ message: 'Retiré de À suivre', action: { label: 'Annuler', onAction: undo }, duration: 5000 })
  }

  if (!data.hasEntries) return null
  return (
    <section className="detail__section anime-actions">
      {state.archived ? (
        <button type="button" className="button button--plain" onClick={resume}>Reprendre</button>
      ) : rewatching ? (
        <button type="button" className="button button--plain" onClick={stop}>Arrêter le revisionnage</button>
      ) : canArchive ? (
        <button type="button" className="button button--plain button--danger" onClick={archive}>Archiver</button>
      ) : null}
      {state.followed && !state.archived && (
        <button type="button" className="quiet-button" onClick={unfollow}>Ne plus suivre</button>
      )}
    </section>
  )
}

/** Toutes les saisons en accordéon : une seule ouverte à la fois. */
export function SeasonAccordion({ data }: { data: AnimeData }) {
  const [openId, setOpenId] = useState<number | null>(() => {
    const media = new Map(data.seasons.map((m) => [m.id, m]))
    const opened = data.hasEntries ? currentSeason([...data.entries.values()], media, data.seasonIds)?.mediaId : undefined
    return opened ?? (data.seasons.length === 1 ? data.seasons[0]!.id : null)
  })
  const multiple = data.seasonIds.length > 1
  if (data.seasons.length === 0) return null

  return (
    <section className="detail__section">
      {multiple && <h3 className="section-title">Saisons</h3>}
      <ul className="seasons">
        {data.seasonIds.map((id, i) => {
          const media = data.seasons.find((m) => m.id === id)
          if (!media) {
            return <li key={id} className="season season--loading"><span className="skeleton skeleton--line" style={{ width: '50%' }} /><span className="skeleton skeleton--bar" /></li>
          }
          return (
            <SeasonItem
              key={id}
              media={media}
              number={multiple ? i + 1 : null}
              entry={data.entries.get(id) ?? null}
              open={openId === id}
              onToggle={() => setOpenId(openId === id ? null : id)}
            />
          )
        })}
      </ul>
    </section>
  )
}

function SeasonItem({ media, number, entry, open, onToggle }: {
  media: Media
  number: number | null
  entry: Entry | null
  open: boolean
  onToggle: () => void
}) {
  const info = progressInfo(entry, media)
  const name = number ? `Saison ${number}` : 'Épisodes'
  const start = !isReleased(media) ? formatStartDate(media.startDate) : null
  const right = isReleased(media) ? (info.total ? `${info.watched} / ${info.total}` : `${info.watched}`) : start ?? 'À venir'
  return (
    <li className="season-item">
      <button type="button" className="season" onClick={onToggle} aria-expanded={open}>
        <span className="season__head">
          <span className="season__name">{name}</span>
          {(number !== null || !isReleased(media)) && <span className="season__status">{right}</span>}
          <IconChevronDown width={18} height={18} className={`season__chevron${open ? ' is-open' : ''}`} />
        </span>
        {number !== null && <span className="season__title">{media.title.english || media.title.romaji}</span>}
        {seasonViewsLine(entry) && <span className="season__views">{seasonViewsLine(entry)}</span>}
        {isReleased(media) && <ProgressBar info={info} label={`Progression de ${name}`} />}
      </button>
      <Accordion open={open}>
        <SeasonPanel media={media} entry={entry} />
      </Accordion>
    </li>
  )
}

const ACCORDION_MS = 240

/** Dépliage animé (hauteur automatique) ; le contenu n'existe que tant qu'il est ouvert. */
function Accordion({ open, children }: { open: boolean; children: React.ReactNode }) {
  const [rendered, setRendered] = useState(open)
  const [expanded, setExpanded] = useState(open)
  useEffect(() => {
    if (open) {
      setRendered(true)
      const frame = requestAnimationFrame(() => setExpanded(true))
      return () => cancelAnimationFrame(frame)
    }
    setExpanded(false)
    const timer = setTimeout(() => setRendered(false), ACCORDION_MS)
    return () => clearTimeout(timer)
  }, [open])
  if (!rendered) return null
  return (
    <div className={`accordion${expanded ? ' is-open' : ''}`}>
      <div className="accordion__inner">{children}</div>
    </div>
  )
}

/** Cocher ou décocher un épisode, avec la confirmation pour les précédents : même règle partout. */
export function useEpisodeToggle(media: Media, watched: EpisodeRanges) {
  const flow = useAnimeFlow()
  const [pending, setPending] = useState<{ episode: number; missing: number } | null>(null)
  const run = useCallback(async (action: Promise<EpisodeOutcome>) => flow.handleOutcome(await action), [flow])
  const toggle = useCallback((episode: number) => {
    const plan = planToggle(watched, episode)
    if (plan.kind === 'uncheck') void run(uncheckEpisode(media, episode))
    else if (plan.kind === 'check') void run(checkEpisode(media, episode))
    else setPending({ episode, missing: plan.missing })
  }, [watched, media, run])
  const confirm = pending && (
    <ConfirmPrevious
      episode={pending.episode}
      missing={pending.missing}
      onAll={() => void run(checkThrough(media, pending.episode))}
      onOnly={() => void run(checkEpisode(media, pending.episode))}
      onClose={() => setPending(null)}
    />
  )
  return { toggle, confirm }
}

function SeasonPanel({ media, entry }: { media: Media; entry: Entry | null }) {
  const flow = useAnimeFlow()
  const toast = useToast()
  const watched = useMemo(() => watchedOf(entry), [entry])
  const titles = useLive(async () => (await cacheDb.titles.get(media.id))?.titles ?? [], [media.id]) ?? []
  const { toggle, confirm } = useEpisodeToggle(media, watched)
  const open = useCallback((episode: number) => flow.openEpisode({ mediaId: media.id, episode }), [flow, media.id])

  // Titres chargés seulement à l'ouverture de la saison, jamais en attendant pour afficher.
  useEffect(() => {
    void loadEpisodeTitles(media)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [media.id])

  const markAll = async () => {
    const out = await markSeasonWatched(media)
    if (out.changed) toast({ message: 'Saison marquée comme vue', action: { label: 'Annuler', onAction: out.undo }, duration: 5000 })
  }
  const max = maxEpisode(media)
  const canMarkAll = Number.isFinite(max) && max > countWatched(watched)

  return (
    <div className="season-panel">
      {isReleased(media) && (
        <div className="season-panel__tools">
          <button type="button" className="text-button season-panel__all" onClick={markAll} disabled={!canMarkAll}>
            Tout marquer comme vu
          </button>
        </div>
      )}
      <EpisodeList media={media} watched={watched} titles={titles} onToggle={toggle} onOpen={open} />
      {confirm}
    </div>
  )
}

const SLICE = 100

/** Saison longue : tranches « 1-100, 101-200 », pour rester fluide. */
function EpisodeList({ media, watched, titles, onToggle, onOpen }: {
  media: Media
  watched: EpisodeRanges
  titles: (string | null)[]
  onToggle: (episode: number) => void
  onOpen: (episode: number) => void
}) {
  const total = episodeRowCount(media, watched)
  const slices = useMemo(() => (total > SLICE ? episodeSlices(total, SLICE) : []), [total])
  const next = firstUnwatched(watched)
  const [sliceAt, setSliceAt] = useState(() => Math.max(0, Math.min(Math.floor((next - 1) / SLICE), Math.max(slices.length - 1, 0))))
  const slice = slices[sliceAt] ?? { from: 1, to: total }
  const nextRow = useRef<HTMLLIElement>(null)

  // Défilement automatique jusqu'au premier épisode non vu, une fois le dépliage fini.
  const scrolled = useRef(false)
  useEffect(() => {
    if (scrolled.current || next <= 1) return
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
    const timer = setTimeout(() => {
      scrolled.current = true
      nextRow.current?.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' })
    }, ACCORDION_MS + 20)
    return () => clearTimeout(timer)
  }, [next])

  if (total === 0) {
    return <p className="episodes-empty">{isReleased(media) ? 'Pas encore d’épisode répertorié.' : 'Les épisodes arriveront avec la diffusion.'}</p>
  }

  const rows = []
  for (let n = slice.from; n <= slice.to; n++) {
    rows.push(
      <EpisodeRow
        key={n}
        ref={n === next ? nextRow : undefined}
        number={n}
        title={titles[n - 1] ?? null}
        checked={hasEpisode(watched, n)}
        aired={isEpisodeAired(media, n)}
        media={media}
        onToggle={onToggle}
        onOpen={onOpen}
      />,
    )
  }

  return (
    <>
      {slices.length > 0 && (
        <div className="slices" role="group" aria-label="Tranches d’épisodes">
          {slices.map((s, i) => (
            <button key={s.from} type="button" className={`chip${i === sliceAt ? ' is-active' : ''}`} aria-pressed={i === sliceAt} onClick={() => setSliceAt(i)}>
              {s.from}-{s.to}
            </button>
          ))}
        </div>
      )}
      <ul className="episodes">{rows}</ul>
    </>
  )
}

/** La ligne ouvre la page de l'épisode ; seule la case coche. */
const EpisodeRow = memo(function EpisodeRow({ ref, number, title, checked, aired, media, onToggle, onOpen }: {
  ref?: React.Ref<HTMLLIElement>
  number: number
  title: string | null
  checked: boolean
  aired: boolean
  media: Media
  onToggle: (episode: number) => void
  onOpen: (episode: number) => void
}) {
  const shown = title ?? `Épisode ${number}`
  const future = !aired && !checked
  return (
    <li ref={ref} className={`episode${future ? ' is-future' : ''}`}>
      <div className="episode__row">
        <button type="button" className="episode__open" onClick={() => onOpen(number)} aria-label={`Épisode ${number}, ${shown}${future ? ', pas encore sorti' : ''}. Ouvrir`}>
          <span className="episode__number">{number}</span>
          <span className="episode__title">{shown}</span>
          {future && <FutureLabel media={media} episode={number} />}
        </button>
        <button
          type="button"
          className="episode__toggle"
          role="checkbox"
          aria-checked={checked}
          aria-label={`Épisode ${number} vu`}
          disabled={future}
          onClick={() => onToggle(number)}
        >
          <span className={`episode__check${checked ? ' is-checked' : ''}`}><IconCheck width={16} height={16} /></span>
        </button>
      </div>
    </li>
  )
})

/** À la place de la case : le compte à rebours du prochain épisode, la date du premier, sinon « À venir ». */
function FutureLabel({ media, episode }: { media: Media; episode: number }) {
  const airingAt = media.nextAiring?.episode === episode ? media.nextAiring.airingAt : null
  const countdown = useMinuteText(() => {
    if (airingAt === null) return null
    const ms = airingAt * 1000 - Date.now()
    return ms > 0 ? `dans ${formatCountdown(ms)}` : 'Bientôt'
  })
  const date = episode === 1 && !isReleased(media) ? formatStartDate(media.startDate) : null
  return <span className={`episode__when${countdown ? ' episode__when--soon' : ''}`}>{countdown ?? date ?? 'À venir'}</span>
}

/** Feuille d'action iOS. */
export function ActionSheet({ message, actions, onClose }: {
  message: string
  actions: { label: string; main?: boolean; danger?: boolean; onAction: () => void }[]
  onClose: () => void
}) {
  const panel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    panel.current?.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  return createPortal(
    <div className="action-sheet-root">
      <div className="sheet-backdrop" onClick={onClose} aria-hidden="true" />
      <div ref={panel} className="action-sheet" role="alertdialog" aria-modal="true" aria-label={message} tabIndex={-1}>
        <div className="action-sheet__group">
          <p className="action-sheet__message">{message}</p>
          {actions.map((a) => (
            <button
              key={a.label}
              type="button"
              className={`action-sheet__button${a.main ? ' action-sheet__button--main' : ''}${a.danger ? ' action-sheet__button--danger' : ''}`}
              onClick={() => {
                a.onAction()
                onClose()
              }}
            >
              {a.label}
            </button>
          ))}
        </div>
        <button type="button" className="action-sheet__button action-sheet__cancel" onClick={onClose}>Annuler</button>
      </div>
    </div>,
    document.body,
  )
}

/** Marquer aussi les épisodes précédents ? */
function ConfirmPrevious({ episode, missing, onAll, onOnly, onClose }: {
  episode: number
  missing: number
  onAll: () => void
  onOnly: () => void
  onClose: () => void
}) {
  const message = `Marquer aussi ${missing > 1 ? `les ${missing} épisodes précédents` : 'l’épisode précédent'} comme vu${missing > 1 ? 's' : ''} ?`
  return (
    <ActionSheet
      message={message}
      actions={[
        { label: 'Oui, tout marquer', main: true, onAction: onAll },
        { label: `Seulement l’épisode ${episode}`, onAction: onOnly },
      ]}
      onClose={onClose}
    />
  )
}
