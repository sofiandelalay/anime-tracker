import { useEffect, useState } from 'react'
import { displayTitle, formatLabel, genreLabel, mediaYear } from '../../domain/format'
import { animeStatusLabel } from '../../domain/listModel'
import { Cover } from '../components/Bits'
import { Sheet } from '../components/Sheet'
import { useAnimeData } from '../hooks/anime'
import { useAnimeFlow } from './AnimeFlow'
import { AnimeActions, GlobalProgress, MyRating, SeasonAccordion, Synopsis } from './AnimeParts'

export interface SheetTarget {
  mediaId: number
  /** Connue depuis Ma liste ; sinon déduite de mes entrées ou du cache. */
  franchiseId?: number
}

interface Props {
  target: SheetTarget | null
  onClose: () => void
}

export function AnimeSheet({ target, onClose }: Props) {
  // Garde la dernière cible pendant l'animation de fermeture.
  const [last, setLast] = useState(target)
  useEffect(() => {
    if (target) setLast(target)
  }, [target])
  const t = target ?? last

  return (
    <Sheet open={!!target} onClose={onClose} label="Détails de l’anime">
      {t && <AnimeSheetContent key={t.mediaId} target={t} onClose={onClose} />}
    </Sheet>
  )
}

function AnimeSheetContent({ target, onClose }: { target: SheetTarget; onClose: () => void }) {
  const flow = useAnimeFlow()
  const data = useAnimeData(target.mediaId, target.franchiseId)
  const shown = data?.root ?? data?.touched
  if (!data || !shown) return <div className="sheet-loading" aria-busy="true" />

  const seasonCount = data.seasonIds.length
  const meta = [
    seasonCount > 1 ? `${seasonCount} saisons` : formatLabel(shown.format),
    mediaYear(shown),
    data.hasEntries ? animeStatusLabel(data.state) : null,
  ].filter(Boolean).join(' · ')
  const seeMore = () => {
    onClose()
    flow.openPage({ mediaId: target.mediaId, franchiseId: data.franchiseId })
  }

  return (
    <div className="detail">
      <header className="detail__header">
        <Cover src={shown.cover} size="l" />
        <div className="detail__heading">
          <h2 className="detail__title">{displayTitle(shown)}</h2>
          <p className="detail__meta">{meta}</p>
        </div>
      </header>

      {data.hasEntries ? (
        <>
          <GlobalProgress data={data} />
          <MyRating data={data} />
          <SeasonAccordion data={data} />
          {!data.state.followed && !data.state.archived && (
            <section className="detail__section">
              <button type="button" className="button button--primary" onClick={() => data.touched && flow.askAdd(data.touched)}>Suivre</button>
            </section>
          )}
          <section className="detail__section">
            <button type="button" className="button button--outline" onClick={seeMore}>Voir plus</button>
          </section>
          <AnimeActions data={data} onDone={onClose} />
        </>
      ) : (
        <>
          <Synopsis mediaId={shown.id} />
          {(shown.genres.length > 0 || shown.studios.length > 0) && (
            <section className="detail__section detail__facts">
              {shown.genres.length > 0 && <p>{shown.genres.map(genreLabel).join(' · ')}</p>}
              {shown.studios.length > 0 && <p>Studio : {shown.studios.join(', ')}</p>}
            </section>
          )}
          <section className="detail__section detail__buttons">
            <button type="button" className="button button--primary" onClick={() => data.touched && flow.askAdd(data.touched)}>Ajouter à ma liste</button>
            <button type="button" className="button button--outline" onClick={seeMore}>Voir plus</button>
          </section>
        </>
      )}
    </div>
  )
}
