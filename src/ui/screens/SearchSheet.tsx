import { useEffect, useRef, useState } from 'react'
import { searchAnime } from '../../api/media'
import { db } from '../../db/trackerDb'
import { addAnime } from '../../domain/actions'
import { displayTitle, formatLabel, mediaYear } from '../../domain/format'
import { maxEpisode } from '../../domain/progress'
import type { Media } from '../../domain/types'
import { Cover, EmptyState } from '../components/Bits'
import { IconCheck, IconMinus, IconPlus, IconSearch } from '../components/Icons'
import { Sheet } from '../components/Sheet'
import { useToast } from '../components/Toast'
import { useDebounced, useLive, useOnline } from '../hooks/hooks'

const MIN_CHARS = 2

export function SearchSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const debounced = useDebounced(query.trim(), 400)
  const [results, setResults] = useState<Media[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<number | null>(null)
  const online = useOnline()
  const input = useRef<HTMLInputElement>(null)
  const tracked = useLive(async () => new Set(await db.entries.toCollection().primaryKeys()), []) ?? new Set<number>()

  useEffect(() => {
    if (open) setTimeout(() => input.current?.focus(), 50)
    else {
      setQuery('')
      setResults(null)
      setExpanded(null)
    }
  }, [open])

  useEffect(() => {
    if (debounced.length < MIN_CHARS) {
      setResults(null)
      setError(null)
      return
    }
    let stale = false
    setLoading(true)
    setError(null)
    searchAnime(debounced)
      .then((r) => !stale && setResults(r))
      .catch(() => !stale && setError('La recherche n’a pas abouti. Réessaie dans un instant.'))
      .finally(() => !stale && setLoading(false))
    return () => {
      stale = true
    }
  }, [debounced])

  return (
    <Sheet open={open} onClose={onClose} label="Rechercher un anime" tall>
      <div className="search">
        <label className="search__field">
          <IconSearch width={20} height={20} className="search__icon" />
          <span className="visually-hidden">Rechercher un anime</span>
          <input
            ref={input}
            type="search"
            inputMode="search"
            enterKeyHint="search"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="Titre d’un anime"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>

        <div className="search__results">
          {!online ? (
            <EmptyState title="Tu es hors ligne" text="La recherche reviendra avec le réseau. Ta liste, elle, reste là." />
          ) : debounced.length < MIN_CHARS ? (
            <EmptyState title="Que veux-tu regarder ?" text="Tape au moins deux lettres." />
          ) : loading && !results ? (
            <SearchSkeleton />
          ) : error ? (
            <EmptyState title="Oups" text={error} />
          ) : results && results.length === 0 ? (
            <EmptyState title="Aucun résultat" text="Essaie le titre japonais ou anglais." />
          ) : (
            <ul className="result-list" aria-busy={loading}>
              {results?.map((m) => (
                <ResultRow
                  key={m.id}
                  media={m}
                  tracked={tracked.has(m.id)}
                  expanded={expanded === m.id}
                  onToggle={() => setExpanded(expanded === m.id ? null : m.id)}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </Sheet>
  )
}

function ResultRow({ media, tracked, expanded, onToggle }: { media: Media; tracked: boolean; expanded: boolean; onToggle: () => void }) {
  const toast = useToast()
  const [started, setStarted] = useState(false)
  const [episode, setEpisode] = useState(1)
  const [busy, setBusy] = useState(false)
  const max = maxEpisode(media)
  const title = displayTitle(media)
  const meta = [mediaYear(media), formatLabel(media.format), media.episodes ? `${media.episodes} ép.` : null]
    .filter(Boolean)
    .join(' · ')

  const add = async (watched: number) => {
    setBusy(true)
    try {
      await addAnime(media, watched)
      toast({ message: watched > 0 ? 'Ajouté à « En cours »' : 'Ajouté à « À voir »' })
    } catch {
      toast({ message: 'Impossible d’ajouter cet anime pour le moment.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className={`result${expanded ? ' is-expanded' : ''}`}>
      <div className="result__row">
        <button type="button" className="result__main" onClick={onToggle} aria-expanded={expanded} disabled={tracked}>
          <Cover src={media.cover} size="s" />
          <span className="result__text">
            <span className="result__title">{title}</span>
            <span className="result__meta">{meta}</span>
          </span>
        </button>
        {tracked ? (
          <span className="result__done" aria-label="Déjà dans ma liste"><IconCheck width={22} height={22} /></span>
        ) : (
          <button type="button" className="icon-button icon-button--filled" onClick={() => add(0)} disabled={busy} aria-label={`Ajouter ${title} à voir`}>
            <IconPlus width={22} height={22} />
          </button>
        )}
      </div>
      {expanded && !tracked && (
        <div className="result__more">
          <label className="switch-row">
            <span>Je l’ai déjà commencé</span>
            <input type="checkbox" role="switch" checked={started} onChange={(e) => setStarted(e.target.checked)} disabled={max === 0} />
          </label>
          {started && (
            <div className="stepper stepper--compact">
              <button type="button" className="icon-button" onClick={() => setEpisode(Math.max(1, episode - 1))} aria-label="Un épisode de moins" disabled={episode <= 1}>
                <IconMinus />
              </button>
              <span className="stepper__value" aria-live="polite">J’en suis à l’épisode {episode}</span>
              <button type="button" className="icon-button" onClick={() => setEpisode(Math.min(max, episode + 1))} aria-label="Un épisode de plus" disabled={episode >= max}>
                <IconPlus />
              </button>
            </div>
          )}
          <button type="button" className="button button--primary" disabled={busy} onClick={() => add(started ? episode : 0)}>
            {started ? 'Ajouter à « En cours »' : 'Ajouter à « À voir »'}
          </button>
        </div>
      )}
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
