import { useState } from 'react'
import { markAllWatched } from '../../domain/actions'
import { countWatched } from '../../domain/episodes'
import { animeAiringLabel, communityScore, displayTitle, formatLabel, genreLabel } from '../../domain/format'
import { globalProgress, maxEpisode } from '../../domain/progress'
import { animeTimesSeen, hasTicked, watchedOf } from '../../domain/viewings'
import { Cover, Segmented } from '../components/Bits'
import { IconCheck, IconChevronLeft } from '../components/Icons'
import { goBack, PushedPage } from '../components/PushedPage'
import { useToast } from '../components/Toast'
import { useAnimeData, type AnimeData } from '../hooks/anime'
import { useAnimeFlow } from './AnimeFlow'
import { AnimeActions, GlobalProgress, MyRating, SeasonAccordion, Synopsis } from './AnimeParts'
import type { SheetTarget } from './AnimeSheet'
import { RewatchSheet, ViewingHistory } from './ViewingParts'

type PageTab = 'about' | 'episodes'
const TABS: { value: PageTab; label: string }[] = [
  { value: 'about', label: 'À propos' },
  { value: 'episodes', label: 'Épisodes' },
]

/** La vue détaillée unique d'un anime, suivi ou non. */
export function AnimePage({ target, onClose }: { target: SheetTarget; onClose: () => void }) {
  return (
    <PushedPage label="Page de l’anime" onClose={onClose}>
      <header className="bar">
        <div className="bar__row">
          <button type="button" className="back-button" onClick={goBack}>
            <IconChevronLeft width={22} height={22} /> Retour
          </button>
        </div>
      </header>
      <PageLoader target={target} />
    </PushedPage>
  )
}

function PageLoader({ target }: { target: SheetTarget }) {
  const data = useAnimeData(target.mediaId, target.franchiseId)
  if (!data || !(data.root ?? data.touched)) return <main className="screen__content" aria-busy="true" />
  return <PageContent data={data} />
}

function PageContent({ data }: { data: AnimeData }) {
  const flow = useAnimeFlow()
  // Décidé une fois à l'ouverture : cocher le premier épisode ne doit pas faire changer d'onglet.
  const [tab, setTab] = useState<PageTab>(() =>
    [...data.entries.values()].some(hasTicked) ? 'episodes' : 'about',
  )
  const shown = (data.root ?? data.touched)!
  const following = data.state.followed && !data.state.archived

  return (
    <>
      <main className="screen__content page-content">
        <div className="page-hero">
          <Cover src={shown.cover} size="xl" />
          <h1 className="page-hero__title">{displayTitle(shown)}</h1>
        </div>
        <div className="page-tabs">
          <Segmented label="Contenu de la page" options={TABS} value={tab} onChange={setTab} />
        </div>
        {tab === 'about' ? <AboutTab data={data} /> : <EpisodesTab data={data} />}
        <AnimeActions data={data} />
      </main>
      <footer className="page-footer">
        {following ? (
          <button type="button" className="button button--plain" disabled>
            <IconCheck width={20} height={20} /> Suivi
          </button>
        ) : data.state.archived ? (
          <button type="button" className="button button--plain" disabled>Archivé</button>
        ) : (
          <button type="button" className="button button--primary" onClick={() => data.touched && flow.askAdd(data.touched)}>
            Ajouter à ma liste
          </button>
        )}
      </footer>
    </>
  )
}

function AboutTab({ data }: { data: AnimeData }) {
  const shown = (data.root ?? data.touched)!
  const seasons = data.seasonIds.length
  const { total } = globalProgress(data.seasons, data.entries)
  const score = communityScore(shown.averageScore)
  const rows: [string, string | null][] = [
    ['Studio', shown.studios.join(', ') || null],
    ['Format', formatLabel(shown.format) || null],
    ['Saisons', seasons > 1 ? String(seasons) : null],
    ['Épisodes', total > 0 ? String(total) : null],
    ['Diffusion', animeAiringLabel(data.seasons)],
  ]
  return (
    <>
      <Synopsis mediaId={shown.id} />
      {shown.genres.length > 0 && (
        <section className="detail__section pills">
          {shown.genres.map((g) => <span key={g} className="pill">{genreLabel(g)}</span>)}
        </section>
      )}
      {score && <p className="detail__section community"><span className="global__star" aria-hidden="true">★</span> {score}</p>}
      <section className="detail__section">
        <div className="group">
          {rows.flatMap(([label, value]) => (value ? [
            <div className="row" key={label}>
              <span>{label}</span>
              <span className="row__value">{value}</span>
            </div>,
          ] : []))}
        </div>
      </section>
    </>
  )
}

function EpisodesTab({ data }: { data: AnimeData }) {
  const toast = useToast()
  const [rewatch, setRewatch] = useState(false)
  const shown = (data.root ?? data.touched)!
  const seen = animeTimesSeen(data.seasons, data.entries)
  const canRewatch = [...data.entries.values()].some(hasTicked)
  const hasMore = data.seasons.some((m) => {
    const max = maxEpisode(m)
    return Number.isFinite(max) && max > countWatched(watchedOf(data.entries.get(m.id)))
  })
  const seenAll = async () => {
    const { undo } = await markAllWatched(data.touched ?? shown)
    toast({ message: 'Tout est marqué comme vu', action: { label: 'Annuler', onAction: undo }, duration: 5000 })
  }
  return (
    <>
      {seen >= 2 && <p className="anime-seen">Vu {seen} fois</p>}
      <GlobalProgress data={data} />
      <MyRating data={data} />
      <section className="detail__section episodes-actions">
        <button type="button" className="button button--plain" onClick={seenAll} disabled={!hasMore}>J’ai tout vu</button>
        {canRewatch && <button type="button" className="button button--plain" onClick={() => setRewatch(true)}>Revoir</button>}
      </section>
      <SeasonAccordion data={data} />
      <ViewingHistory data={data} />
      <RewatchSheet open={rewatch} data={data} onClose={() => setRewatch(false)} />
    </>
  )
}
