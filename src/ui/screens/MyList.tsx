import { useCallback, useState } from 'react'
import { archiveFranchise, incrementEpisode, unfollowAnime } from '../../domain/actions'
import type { CardModel } from '../../domain/listModel'
import { AnimeCard } from '../components/AnimeCard'
import { EmptyState, OfflinePill, Segmented, SkeletonCards } from '../components/Bits'
import { IconSearch } from '../components/Icons'
import { SwipeRow } from '../components/SwipeRow'
import { useToast } from '../components/Toast'
import { useLibrary } from '../hooks/hooks'
import { useAnimeFlow } from './AnimeFlow'

type View = 'toWatch' | 'completed' | 'shelved' | 'archived'
const VIEWS: { value: View; label: string }[] = [
  { value: 'toWatch', label: 'À suivre' },
  { value: 'completed', label: 'Terminés' },
  { value: 'shelved', label: 'Mis de côté' },
  { value: 'archived', label: 'Archivés' },
]

export function MyList({ onSearch }: { onSearch: () => void }) {
  const library = useLibrary()
  const toast = useToast()
  const { openPage, handleOutcome, follow } = useAnimeFlow()
  const [view, setView] = useState<View>('toWatch')

  const onIncrement = useCallback(
    async (card: CardModel) => handleOutcome(await incrementEpisode(card.media)),
    [handleOutcome],
  )
  const onOpen = useCallback((card: CardModel) => openPage({ franchiseId: card.franchiseId, mediaId: card.media.id }), [openPage])
  const onFollow = useCallback((card: CardModel) => void follow(card.franchiseId), [follow])

  const archive = async (card: CardModel) => {
    const undo = await archiveFranchise(card.franchiseId)
    toast({ message: 'Archivé', action: { label: 'Annuler', onAction: undo }, duration: 5000 })
  }
  const unfollow = async (card: CardModel) => {
    const undo = await unfollowAnime(card.franchiseId)
    toast({ message: 'Retiré de À suivre', action: { label: 'Annuler', onAction: undo }, duration: 5000 })
  }

  const cards = library?.model[view]

  return (
    <div className="screen">
      <header className="bar">
        <div className="bar__row">
          <Segmented label="Filtrer ma liste" options={VIEWS} value={view} onChange={setView} />
        </div>
        <OfflinePill />
      </header>

      <main className="screen__content">
        {!cards ? (
          <SkeletonCards />
        ) : cards.length === 0 ? (
          <Empty view={view} hasEntries={(library?.entries.length ?? 0) > 0} onSearch={onSearch} />
        ) : (
          <div className="card-list" key={view}>
            {cards.map((c) => {
              const card = <AnimeCard key={c.key} card={c} onOpen={onOpen} onIncrement={onIncrement} onFollow={onFollow} />
              return view === 'toWatch' ? (
                <SwipeRow
                  key={c.key}
                  actions={[
                    { label: 'Archiver', tone: 'danger', onAction: () => void archive(c) },
                    { label: 'Ne plus suivre', onAction: () => void unfollow(c) },
                  ]}
                >
                  {card}
                </SwipeRow>
              ) : card
            })}
          </div>
        )}
      </main>
    </div>
  )
}

function Empty({ view, hasEntries, onSearch }: { view: View; hasEntries: boolean; onSearch: () => void }) {
  if (view === 'completed') return <EmptyState title="Rien de terminé pour l’instant" text="Les séries que tu finis viendront se ranger ici." />
  if (view === 'shelved') return <EmptyState title="Rien de mis de côté" text="Ce que tu commences sans le suivre t’attendra ici, sans pression." />
  if (view === 'archived') return <EmptyState title="Aucune archive" text="Ce que tu abandonnes se retrouve ici, au calme." />
  return (
    <EmptyState
      title={hasEntries ? 'Tu es à jour' : 'Ajoute ton premier anime'}
      text={hasEntries ? 'Rien en attente. Une petite recherche ?' : 'Cherche une série que tu regardes ou que tu veux voir.'}
      action={
        <button type="button" className="button button--primary" onClick={onSearch}>
          <IconSearch width={20} height={20} /> Rechercher
        </button>
      }
    />
  )
}
