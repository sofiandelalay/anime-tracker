import { useCallback, useState } from 'react'
import { addAnime, incrementEpisode, type ProgressOutcome } from '../../domain/actions'
import type { CardModel } from '../../domain/listModel'
import { AnimeCard } from '../components/AnimeCard'
import { EmptyState, Segmented, SkeletonCards } from '../components/Bits'
import { IconCloudOff, IconSearch } from '../components/Icons'
import { useToast } from '../components/Toast'
import { useLibrary, useOnline } from '../hooks/hooks'
import { AnimeSheet, type SheetTarget } from './AnimeSheet'
import { CompletionSheet, type Completion } from './CompletionSheet'
import { SearchSheet } from './SearchSheet'

type View = 'toWatch' | 'completed' | 'archived'
const VIEWS: { value: View; label: string }[] = [
  { value: 'toWatch', label: 'À suivre' },
  { value: 'completed', label: 'Terminés' },
  { value: 'archived', label: 'Archivés' },
]

export function MyList() {
  const library = useLibrary()
  const online = useOnline()
  const toast = useToast()
  const [view, setView] = useState<View>('toWatch')
  const [searchOpen, setSearchOpen] = useState(false)
  const [sheet, setSheet] = useState<SheetTarget | null>(null)
  const [completion, setCompletion] = useState<Completion | null>(null)

  const handleOutcome = useCallback(
    (out: ProgressOutcome) => {
      if (!out.completed) return
      setCompletion({ mediaId: out.mediaId, nextSeasonId: out.nextSeasonId })
      toast({
        message: 'Saison terminée',
        action: {
          label: 'Annuler',
          onAction: async () => {
            setCompletion(null)
            await out.undo()
          },
        },
        duration: 5000,
      })
    },
    [toast],
  )

  const onIncrement = useCallback(
    async (card: CardModel) => {
      const out = await incrementEpisode(card.media.id)
      handleOutcome(out)
    },
    [handleOutcome],
  )
  const onOpen = useCallback((card: CardModel) => setSheet({ franchiseId: card.franchiseId, mediaId: card.media.id }), [])
  const onAddSeason = useCallback(
    async (card: CardModel) => {
      await addAnime(card.media)
      toast({ message: 'Nouvelle saison ajoutée' })
    },
    [toast],
  )

  const cards = library?.model[view]

  return (
    <div className="screen">
      <header className="bar">
        <div className="bar__row">
          <Segmented label="Filtrer ma liste" options={VIEWS} value={view} onChange={setView} />
          <button type="button" className="icon-button" onClick={() => setSearchOpen(true)} aria-label="Rechercher un anime">
            <IconSearch />
          </button>
        </div>
        {!online && (
          <p className="offline-pill" role="status">
            <IconCloudOff width={14} height={14} /> Hors ligne
          </p>
        )}
      </header>

      <main className="screen__content">
        {!cards ? (
          <SkeletonCards />
        ) : cards.length === 0 ? (
          <Empty view={view} hasEntries={(library?.entries.length ?? 0) > 0} onSearch={() => setSearchOpen(true)} />
        ) : (
          <div className="card-list" key={view}>
            {cards.map((c) => (
              <AnimeCard key={c.key} card={c} onOpen={onOpen} onIncrement={onIncrement} onAddSeason={onAddSeason} />
            ))}
          </div>
        )}
      </main>

      <SearchSheet open={searchOpen} onClose={() => setSearchOpen(false)} />
      <AnimeSheet target={sheet} onClose={() => setSheet(null)} onProgress={handleOutcome} />
      <CompletionSheet completion={completion} onClose={() => setCompletion(null)} />
    </div>
  )
}

function Empty({ view, hasEntries, onSearch }: { view: View; hasEntries: boolean; onSearch: () => void }) {
  if (view === 'completed') return <EmptyState title="Rien de terminé pour l’instant" text="Les séries que tu finis viendront se ranger ici." />
  if (view === 'archived') return <EmptyState title="Aucune archive" text="Ce que tu mets de côté se retrouve ici, au calme." />
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
