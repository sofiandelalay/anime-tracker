import { useEffect, useMemo, useState, type Ref } from 'react'
import { fetchChainSummaries, searchAnime } from '../../api/media'
import { displayTitle, formatLabel, mediaYear } from '../../domain/format'
import { countsForProgress, PROGRESS_FORMATS, type ChainSummary } from '../../domain/franchise'
import { animeBadges, type AnimeBadge } from '../../domain/listModel'
import { clearRecents, forgetSearch, readRecents, rememberSearch } from '../../domain/recents'
import type { Media } from '../../domain/types'
import { Cover, EmptyState, OfflinePill } from '../components/Bits'
import { IconClose, IconSearch } from '../components/Icons'
import { useAutoRetry, useDebounced, useLibrary, useLive, useOnline } from '../hooks/hooks'
import { useAnimeFlow } from './AnimeFlow'

const MIN_CHARS = 2
/** Les premiers résultats, ceux qui sont visibles. */
const SUMMARIZED_RESULTS = 10

/**
 * Onglet Rechercher. Le focus est donné par la barre d'onglets, pendant le toucher : c'est la seule façon
 * pour qu'iOS accepte d'ouvrir le clavier. L'écran reste monté, la recherche en cours est donc conservée.
 */
export function Search({ inputRef }: { inputRef: Ref<HTMLInputElement> }) {
  const [query, setQuery] = useState('')
  const trimmed = query.trim()
  const debounced = useDebounced(trimmed, 400)
  const [results, setResults] = useState<Media[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [summaries, setSummaries] = useState<Map<number, ChainSummary>>(new Map())
  const [attempt, setAttempt] = useState(0)
  const online = useOnline()
  const library = useLibrary()
  const recents = useLive(readRecents, []) ?? []
  const badges = useMemo(
    () => (library ? animeBadges(library.entries, library.media) : new Map<number, AnimeBadge>()),
    [library],
  )

  // Saisons et épisodes au total : complétés après l'affichage, sans le bloquer ; abandonnés si la recherche change.
  useEffect(() => {
    if (!results) return
    let stale = false
    const series = results.filter(countsForProgress).slice(0, SUMMARIZED_RESULTS)
    void fetchChainSummaries(series, () => stale)
      .then((s) => !stale && setSummaries(s))
      .catch(() => undefined)
    return () => {
      stale = true
    }
  }, [results])

  useEffect(() => {
    if (debounced.length < MIN_CHARS) {
      setResults(null)
      setError(null)
      setLoading(false)
      return
    }
    let stale = false
    setLoading(true)
    setError(null)
    searchAnime(debounced)
      .then((r) => !stale && setResults(r))
      .catch(() => !stale && setError('AniList ne répond pas pour le moment. On réessaie tout seul.'))
      .finally(() => !stale && setLoading(false))
    return () => {
      stale = true
    }
  }, [debounced, attempt])
  useAutoRetry(!!error, () => setAttempt((n) => n + 1))

  const clear = () => {
    setQuery('')
    if (inputRef && typeof inputRef === 'object') inputRef.current?.focus()
  }
  const remember = () => void rememberSearch(trimmed)

  return (
    <div className="screen">
      <header className="bar">
        <form
          className="search__field"
          role="search"
          onSubmit={(e) => {
            e.preventDefault()
            remember()
            // Valider range le clavier : les résultats se lisent mieux.
            if (inputRef && typeof inputRef === 'object') inputRef.current?.blur()
          }}
        >
          <IconSearch width={20} height={20} />
          <input
            ref={inputRef}
            type="search"
            inputMode="search"
            enterKeyHint="search"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            aria-label="Rechercher un anime"
            placeholder="Titre d’un anime"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button
              type="button"
              className="search__clear"
              aria-label="Effacer la recherche"
              // Garde le clavier ouvert : le champ ne perd pas le focus au toucher.
              onPointerDown={(e) => e.preventDefault()}
              onClick={clear}
            >
              <span className="search__clear-dot"><IconClose width={12} height={12} /></span>
            </button>
          )}
        </form>
        <OfflinePill />
      </header>

      <main className="screen__content">
        {!trimmed ? (
          <Recents recents={recents} onPick={(q) => {
            setQuery(q)
            void rememberSearch(q)
          }} />
        ) : trimmed.length < MIN_CHARS ? null : !online ? (
          <EmptyState title="Tu es hors ligne" text="La recherche reviendra avec le réseau. Ta liste, elle, reste là." />
        ) : error ? (
          <EmptyState title="Un instant" text={error} />
        ) : !results ? (
          <SearchSkeleton />
        ) : results.length === 0 ? (
          !loading && <EmptyState title="Aucun résultat" text="Essaie le titre japonais ou anglais." />
        ) : (
          <ul className="result-list" aria-busy={loading}>
            {results.map((m) => (
              <ResultRow key={m.id} media={m} badge={badges.get(m.id) ?? null} summary={summaries.get(m.id)} onUse={remember} />
            ))}
          </ul>
        )}
      </main>
    </div>
  )
}

function Recents({ recents, onPick }: { recents: string[]; onPick: (query: string) => void }) {
  if (recents.length === 0) return null
  return (
    <section aria-label="Recherches récentes">
      <div className="recents__head">
        <h2 className="section-title recents__title">Récentes</h2>
        <button type="button" className="text-button recents__clear" onClick={() => void clearRecents()}>Tout effacer</button>
      </div>
      <ul className="recents">
        {recents.map((r) => (
          <li key={r} className="recent">
            <button type="button" className="recent__text" onClick={() => onPick(r)}>{r}</button>
            <button type="button" className="icon-button icon-button--muted" onClick={() => void forgetSearch(r)} aria-label={`Supprimer ${r} des recherches récentes`}>
              <IconClose width={16} height={16} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

function ResultRow({ media, badge, summary, onUse }: { media: Media; badge: AnimeBadge | null; summary?: ChainSummary; onUse: () => void }) {
  const { openMedia, askAdd } = useAnimeFlow()
  const title = displayTitle(media)
  const hasSequel = countsForProgress(media) && media.relations.some((r) => r.relationType === 'SEQUEL' && r.format && PROGRESS_FORMATS.has(r.format))
  const size = summary && summary.seasons > 1
    ? `${summary.seasons} saisons · ${summary.episodes} ép.`
    : hasSequel ? 'Plusieurs saisons' : media.episodes ? `${media.episodes} ép.` : null
  const meta = [mediaYear(media), hasSequel ? null : formatLabel(media.format), size].filter(Boolean).join(' · ')
  // Suivi ou archivé : rien à ajouter. Terminé ou mis de côté sans suivi : on peut encore le suivre.
  const canAdd = !badge || !badge.followed

  return (
    <li className="result">
      <div className="result__row">
        <button
          type="button"
          className="result__main"
          onClick={() => {
            onUse()
            openMedia(media)
          }}
          aria-label={`${title}, ${meta}${badge ? `, ${badge.label}` : ''}. Ouvrir`}
        >
          <Cover src={media.cover} size="s" />
          <span className="result__text">
            <span className="result__title">{title}</span>
            <span className="result__meta">{meta}</span>
            {badge && <span className="result__state">{badge.label}</span>}
          </span>
        </button>
        {canAdd && (
          <button
            type="button"
            className="result__add"
            onClick={() => {
              onUse()
              askAdd(media)
            }}
            aria-label={`Ajouter ${title} à ma liste`}
          >
            Ajouter
          </button>
        )}
      </div>
    </li>
  )
}

function SearchSkeleton() {
  return (
    <ul className="result-list" aria-busy="true" aria-label="Recherche en cours">
      {[0, 1, 2, 3].map((i) => (
        <li className="result" key={i} aria-hidden="true">
          <div className="result__row">
            <div className="cover cover--s skeleton" />
            <span className="result__text">
              <span className="skeleton skeleton--line" style={{ width: '65%' }} />
              <span className="skeleton skeleton--line" style={{ width: '35%' }} />
            </span>
          </div>
        </li>
      ))}
    </ul>
  )
}
