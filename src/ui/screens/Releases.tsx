import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetchSeasonPage } from '../../api/media'
import { displayTitle, formatStartDate } from '../../domain/format'
import { buildSeasonGrid, nextSeason, seasonKey, seasonLabel, seasonOf, type SeasonRef } from '../../domain/seasons'
import type { Media } from '../../domain/types'
import { Cover, EmptyState, OfflinePill, Segmented } from '../components/Bits'
import { IconCheck } from '../components/Icons'
import { useAiringLabel } from '../hooks/clock'
import { useAutoRetry, useLibrary, useOnline } from '../hooks/hooks'
import { useAnimeFlow } from './AnimeFlow'

export function Releases() {
  const [current, next] = useMemo(() => {
    const c = seasonOf(new Date())
    return [c, nextSeason(c)] as const
  }, [])
  const [selected, setSelected] = useState(seasonKey(current))
  const [onlyFollowed, setOnlyFollowed] = useState(false)
  const isCurrent = selected === seasonKey(current)
  const options = [current, next].map((s) => ({ value: seasonKey(s), label: seasonLabel(s) }))

  return (
    <div className="screen">
      <header className="bar">
        <h1 className="bar__title">Sorties</h1>
        <div className="bar__row">
          <Segmented label="Choisir la période des sorties" options={options} value={selected} onChange={setSelected} />
        </div>
        <div className="bar__filters">
          <button
            type="button"
            className={`chip${onlyFollowed ? ' is-active' : ''}`}
            aria-pressed={onlyFollowed}
            onClick={() => setOnlyFollowed(!onlyFollowed)}
          >
            Ceux que je suis
          </button>
          <OfflinePill />
        </div>
      </header>
      <SeasonContent key={selected} season={isCurrent ? current : next} isCurrent={isCurrent} onlyFollowed={onlyFollowed} />
    </div>
  )
}

interface Pages {
  media: Media[]
  /** Prochaine page à charger ; null quand tout est là. */
  next: number | null
  loading: boolean
  error: boolean
}

function SeasonContent({ season, isCurrent, onlyFollowed }: { season: SeasonRef; isCurrent: boolean; onlyFollowed: boolean }) {
  const library = useLibrary()
  const online = useOnline()
  const { openMedia } = useAnimeFlow()
  const [pages, setPages] = useState<Pages>({ media: [], next: 1, loading: false, error: false })
  const busy = useRef(false)
  const scroller = useRef<HTMLElement>(null)
  const sentinel = useRef<HTMLDivElement>(null)

  const loadMore = useCallback(async (page: number) => {
    if (busy.current) return
    busy.current = true
    setPages((p) => ({ ...p, loading: true, error: false }))
    try {
      const res = await fetchSeasonPage(season.season, season.year, page)
      setPages((p) => {
        const byId = new Map(p.media.map((m) => [m.id, m]))
        for (const m of res.media) if (!byId.has(m.id)) byId.set(m.id, m)
        return { media: [...byId.values()], next: res.hasNext ? page + 1 : null, loading: false, error: false }
      })
    } catch {
      setPages((p) => ({ ...p, loading: false, error: true }))
    } finally {
      busy.current = false
    }
  }, [season.season, season.year])

  // Pages de 50 au défilement : une requête à la fois, seulement quand le bas de la grille approche.
  const canLoad = !onlyFollowed && pages.next !== null && !pages.error
  useEffect(() => {
    if (!canLoad || !sentinel.current || pages.loading) return
    const page = pages.next!
    const io = new IntersectionObserver(
      (items) => {
        if (items.some((i) => i.isIntersecting)) void loadMore(page)
      },
      { root: scroller.current, rootMargin: '600px 0px' },
    )
    io.observe(sentinel.current)
    return () => io.disconnect()
  }, [canLoad, pages.next, pages.loading, loadMore])

  useAutoRetry(pages.error, () => void loadMore(pages.next ?? 1))

  const grid = useMemo(
    () => buildSeasonGrid(pages.media, library?.entries ?? [], library?.media ?? new Map<number, Media>(), season, isCurrent),
    [pages.media, library, season, isCurrent],
  )
  const others = onlyFollowed ? [] : grid.others
  const isEmpty = grid.followed.length === 0 && others.length === 0
  const showNextDates = !isCurrent

  return (
    <main className="screen__content" ref={scroller}>
      {library && isEmpty && !canLoad && !pages.loading && (
        onlyFollowed ? (
          <EmptyState title="Rien de suivi ici" text="Touche une jaquette pour ajouter un anime de cette saison à ta liste." />
        ) : pages.error ? (
          <EmptyState
            title={online ? 'Un instant' : 'Tu es hors ligne'}
            text={online ? 'AniList ne répond pas pour le moment. On réessaie tout seul.' : 'Cette saison reviendra avec le réseau.'}
            action={<button type="button" className="button button--plain" onClick={() => void loadMore(pages.next ?? 1)}>Réessayer</button>}
          />
        ) : (
          <EmptyState title="Rien d’annoncé pour l’instant" text="Repasse un peu plus tard, la liste se remplit vite." />
        )
      )}

      {!isEmpty && (
        <ul className="grid" aria-label={seasonLabel(season)}>
          {grid.followed.map((m) => <Tile key={m.id} media={m} followed showStart={showNextDates} onOpen={openMedia} />)}
          {others.map((m) => <Tile key={m.id} media={m} followed={false} showStart={showNextDates} onOpen={openMedia} />)}
        </ul>
      )}

      {canLoad && (
        <>
          <div ref={sentinel} className="grid-sentinel" aria-hidden="true" />
          <SkeletonTiles />
        </>
      )}
      {!isEmpty && pages.error && !onlyFollowed && (
        <div className="grid-retry">
          <button type="button" className="button button--plain button--small" onClick={() => void loadMore(pages.next ?? 1)}>
            Charger la suite
          </button>
        </div>
      )}
    </main>
  )
}

const Tile = memo(function Tile({ media, followed, showStart, onOpen }: {
  media: Media
  followed: boolean
  showStart: boolean
  onOpen: (m: Media) => void
}) {
  const title = displayTitle(media)
  const countdown = useAiringLabel(followed ? media.nextAiring : null)
  const start = showStart && !countdown ? formatStartDate(media.startDate) : null
  const label = [title, followed ? 'suivi' : null, countdown, start ? `début ${start}` : null].filter(Boolean).join(', ')

  return (
    <li>
      <button type="button" className="tile" onClick={() => onOpen(media)} aria-label={label}>
        <Cover src={media.cover} size="fill">
          {countdown && <span className="tile__badge">{countdown}</span>}
          {followed && !countdown && <span className="tile__followed" aria-hidden="true"><IconCheck width={12} height={12} /></span>}
        </Cover>
        <span className="tile__title">{title}</span>
        {start && <span className="tile__date">{start}</span>}
      </button>
    </li>
  )
})

function SkeletonTiles() {
  return (
    <div className="grid grid--skeleton" aria-busy="true" aria-label="Chargement">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} aria-hidden="true">
          <div className="cover cover--fill skeleton" />
          <span className="skeleton skeleton--line" style={{ width: '85%' }} />
        </div>
      ))}
    </div>
  )
}
