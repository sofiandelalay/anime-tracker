import { useEffect, useRef, useState } from 'react'
import { episodeKey, loadEpisodeDetails, loadEpisodeTitles } from '../../api/episodes'
import { cacheDb } from '../../db/cacheDb'
import { hasEpisode } from '../../domain/episodes'
import { episodeScore, seasonEpisodeLabel } from '../../domain/format'
import { episodeDateLine, episodeRowCount, isEpisodeAired } from '../../domain/progress'
import type { Media } from '../../domain/types'
import { watchedOf } from '../../domain/viewings'
import { IconCheck, IconChevronLeft } from '../components/Icons'
import { goBack, PushedPage } from '../components/PushedPage'
import { useAnimeData } from '../hooks/anime'
import { useMinuteText } from '../hooks/clock'
import { useLive } from '../hooks/hooks'
import { useEpisodeToggle } from './AnimeParts'

export interface EpisodeTarget {
  mediaId: number
  episode: number
}

/** Déplacement horizontal à partir duquel on change d'épisode. */
const SWIPE = 60

export function EpisodePage({ target, onClose }: { target: EpisodeTarget; onClose: () => void }) {
  return (
    <PushedPage label="Page de l’épisode" onClose={onClose}>
      <EpisodeLoader target={target} />
    </PushedPage>
  )
}

function EpisodeLoader({ target }: { target: EpisodeTarget }) {
  const data = useAnimeData(target.mediaId)
  const [episode, setEpisode] = useState(target.episode)
  const [direction, setDirection] = useState<'next' | 'prev' | null>(null)
  const gesture = useRef<{ x: number; y: number } | null>(null)
  const media = data?.seasons.find((m) => m.id === target.mediaId) ?? data?.touched
  const entry = data?.entries.get(target.mediaId) ?? null

  if (!data || !media) return <main className="screen__content" aria-busy="true" />
  const total = episodeRowCount(media, watchedOf(entry))
  const go = (to: number) => {
    if (to < 1 || to > total) return
    setDirection(to > episode ? 'next' : 'prev')
    setEpisode(to)
  }
  const at = data.seasonIds.indexOf(media.id)

  return (
    <div
      className="episode-page"
      onPointerDown={(e) => {
        gesture.current = { x: e.clientX, y: e.clientY }
      }}
      onPointerUp={(e) => {
        const g = gesture.current
        gesture.current = null
        if (!g) return
        const dx = e.clientX - g.x
        if (Math.abs(dx) > SWIPE && Math.abs(dx) > 2 * Math.abs(e.clientY - g.y)) go(episode + (dx < 0 ? 1 : -1))
      }}
      onPointerCancel={() => {
        gesture.current = null
      }}
    >
      <button type="button" className="episode-page__back" onClick={goBack} aria-label="Retour">
        <IconChevronLeft width={22} height={22} />
      </button>
      <EpisodeContent
        key={episode}
        media={media}
        seasonNumber={at >= 0 ? at + 1 : 1}
        episode={episode}
        watched={watchedOf(entry)}
        direction={direction}
      />
      <div className="episode-page__nav">
        <button type="button" className="text-button" onClick={() => go(episode - 1)} disabled={episode <= 1}>Précédent</button>
        <button type="button" className="text-button" onClick={() => go(episode + 1)} disabled={episode >= total}>Suivant</button>
      </div>
    </div>
  )
}

function EpisodeContent({ media, seasonNumber, episode, watched, direction }: {
  media: Media
  seasonNumber: number
  episode: number
  watched: [number, number][]
  direction: 'next' | 'prev' | null
}) {
  const aired = isEpisodeAired(media, episode)
  const [loading, setLoading] = useState(aired)
  const details = useLive(async () => (await cacheDb.episodes.get(episodeKey(media.id, episode))) ?? null, [media.id, episode])
  const seasonTitles = useLive(async () => (await cacheDb.titles.get(media.id))?.titles ?? [], [media.id])
  const { toggle, confirm } = useEpisodeToggle(media, watched)
  const checked = hasEpisode(watched, episode)
  const dateLine = useMinuteText(() => episodeDateLine(media, episode, details?.aired ?? null, Date.now()))

  // Rien n'attend ces données : l'en-tête et la case sont déjà là, le reste arrive ensuite.
  useEffect(() => {
    void loadEpisodeTitles(media)
    if (!aired) return
    let stale = false
    void loadEpisodeDetails(media, episode).finally(() => !stale && setLoading(false))
    return () => {
      stale = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [media.id, episode, aired])

  const title = seasonTitles?.[episode - 1] ?? details?.title ?? `Épisode ${episode}`
  const score = episodeScore(details?.score)

  return (
    <main className={`screen__content episode-content${direction ? ` episode-content--${direction}` : ''}`}>
      <EpisodeHero media={media} thumbnail={details?.thumbnail ?? null}>
        <p className="episode-hero__label">{seasonEpisodeLabel(seasonNumber, episode)}</p>
        <h1 className="episode-hero__title">{title}</h1>
      </EpisodeHero>

      <div className="episode-info">
        <div className="episode-info__line">
          <p className="episode-info__date">{dateLine}</p>
          <button
            type="button"
            className="episode__toggle"
            role="checkbox"
            aria-checked={checked}
            aria-label={`Épisode ${episode} vu`}
            disabled={!aired && !checked}
            onClick={() => toggle(episode)}
          >
            <span className={`episode__check${checked ? ' is-checked' : ''}`}><IconCheck width={16} height={16} /></span>
          </button>
        </div>

        {(score || details?.filler || details?.recap) && (
          <div className="episode-info__meta">
            {score && <span className="community"><span className="global__star" aria-hidden="true">★</span> {score}</span>}
            {details?.filler && <span className="pill pill--quiet">Filler</span>}
            {details?.recap && <span className="pill pill--quiet">Récap</span>}
          </div>
        )}

        {details?.synopsis ? (
          <p className="episode-info__synopsis">{details.synopsis}</p>
        ) : loading && aired ? (
          <div aria-busy="true" aria-label="Chargement du résumé">
            <span className="skeleton skeleton--line" />
            <span className="skeleton skeleton--line" />
            <span className="skeleton skeleton--line" style={{ width: '60%' }} />
          </div>
        ) : (
          <p className="episode-info__empty">Pas encore de résumé pour cet épisode.</p>
        )}
      </div>
      {confirm}
    </main>
  )
}

/** Vignette de l'épisode, sinon bannière de l'anime, sinon jaquette floue. Une image qui échoue passe à la suivante. */
function EpisodeHero({ media, thumbnail, children }: { media: Media; thumbnail: string | null; children: React.ReactNode }) {
  const candidates = [thumbnail, media.banner ?? null].filter((s): s is string => !!s)
  const [failed, setFailed] = useState<string[]>([])
  const src = candidates.find((s) => !failed.includes(s))
  return (
    <div className="episode-hero">
      {src ? (
        <img key={src} className="episode-hero__image" src={src} alt="" onError={() => setFailed((f) => [...f, src])} />
      ) : media.cover ? (
        <img className="episode-hero__image episode-hero__image--blurred" src={media.cover} alt="" />
      ) : null}
      <div className="episode-hero__fade" aria-hidden="true" />
      <div className="episode-hero__text">{children}</div>
    </div>
  )
}
