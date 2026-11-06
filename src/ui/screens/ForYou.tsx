import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { cacheDb } from '../../db/cacheDb'
import { db } from '../../db/trackerDb'
import { hideAnime } from '../../domain/actions'
import { displayTitle } from '../../domain/format'
import { buildExclusions, isExcluded, MAX_SUGGESTIONS, ratingsSignature, type Suggestion } from '../../domain/recommend'
import { computeSuggestions, SUGGESTIONS_KEY, SUGGESTIONS_TTL, type SuggestionSet } from '../../domain/suggestions'
import { Cover, EmptyState, OfflinePill, SkeletonCards } from '../components/Bits'
import { IconPlus } from '../components/Icons'
import { useToast } from '../components/Toast'
import { useAutoRetry, useDebounced, useLibrary, useLive, useOnline } from '../hooks/hooks'
import { useAnimeFlow } from './AnimeFlow'

export function ForYou({ active }: { active: boolean }) {
  const library = useLibrary()
  const online = useOnline()
  const hidden = useLive(() => db.hidden.toArray(), [])
  // null = pas encore de suggestions en cache ; undefined = lecture en cours.
  const cached = useLive(async () => (await cacheDb.kv.get(SUGGESTIONS_KEY)) ?? null, [])
  const [running, setRunning] = useState(false)
  const [failed, setFailed] = useState(false)

  const liveSignature = library ? ratingsSignature(library.entries) : undefined
  const signature = useDebounced(liveSignature, 800)
  const attempted = useRef<string | null>(null)

  const run = useCallback(async (force: boolean) => {
    setRunning(true)
    setFailed(false)
    try {
      await computeSuggestions({ force })
    } catch {
      setFailed(true)
    } finally {
      setRunning(false)
    }
  }, [])

  // Recalcul : note modifiée, ou cache de plus de 24 h. Seulement si l'onglet est affiché.
  const set = cached?.value as SuggestionSet | undefined
  const fresh = !!cached && Date.now() - cached.fetchedAt <= SUGGESTIONS_TTL && set?.signature === signature
  useEffect(() => {
    if (!active || !online || running || signature === undefined || cached === undefined || fresh) return
    // Un seul essai automatique par situation : pas de boucle si le réseau échoue.
    const attempt = `${signature}#${cached?.fetchedAt ?? 0}`
    if (attempted.current === attempt) return
    attempted.current = attempt
    void run(false)
  }, [active, online, running, signature, cached, fresh, run])

  useAutoRetry(failed, () => void run(false))

  // Exclusions relues en direct : un ajout ou un masquage fait remonter la suggestion suivante, sans recalcul.
  const items = useMemo<Suggestion[]>(() => {
    if (!set || !library || !hidden) return []
    const ex = buildExclusions(library.entries, library.franchises.values(), hidden.map((h) => h.mediaId))
    return set.items.filter((s) => !isExcluded(s.media, ex)).slice(0, MAX_SUGGESTIONS)
  }, [set, library, hidden])

  const loading = !set && (running || cached === undefined || (online && !failed))

  return (
    <div className="screen">
      <header className="bar">
        <div className="compact-header">
          <h1 className="compact-header__title">Pour toi</h1>
          <button
            type="button"
            className="text-button text-button--muted"
            disabled={running || !online}
            onClick={() => void run(true)}
          >
            {running ? 'Actualisation…' : 'Actualiser'}
          </button>
        </div>
        <OfflinePill />
      </header>
      <main className="screen__content">
        {set?.cold && (
          <p className="notice">Note ou termine au moins 3 animes et tes suggestions deviendront personnelles. En attendant, voici les plus populaires de la saison.</p>
        )}
        {failed && set && <p className="footnote notice-inline">AniList ne répond pas : voici tes dernières suggestions. On réessaie tout seul.</p>}

        {loading ? (
          <SkeletonCards />
        ) : !set ? (
          <EmptyState
            title={online ? 'Un instant' : 'Tu es hors ligne'}
            text={online ? 'AniList ne répond pas pour le moment. On réessaie tout seul.' : 'Tes suggestions arriveront avec le réseau.'}
            action={online ? <button type="button" className="button button--plain" onClick={() => void run(false)}>Réessayer</button> : undefined}
          />
        ) : items.length === 0 ? (
          <EmptyState title="Plus rien à te proposer" text="Note quelques animes de plus, de nouvelles idées arriveront." />
        ) : (
          <div className="card-list">
            {items.map((s) => <SuggestionCard key={s.media.id} suggestion={s} />)}
          </div>
        )}
      </main>
    </div>
  )
}

function SuggestionCard({ suggestion: { media, reason } }: { suggestion: Suggestion }) {
  const toast = useToast()
  const { openMedia, askAdd } = useAnimeFlow()
  const title = displayTitle(media)

  const hide = async () => {
    const undo = await hideAnime(media.id)
    toast({ message: 'Masqué', action: { label: 'Annuler', onAction: undo }, duration: 5000 })
  }

  return (
    <article className="suggestion">
      <button type="button" className="suggestion__cover" onClick={() => openMedia(media)} aria-label={`${title}. Ouvrir`}>
        <Cover src={media.cover} size="fill" />
      </button>
      <div className="suggestion__body">
        <button type="button" className="suggestion__text" onClick={() => openMedia(media)} aria-label={`${title}. ${reason}. Ouvrir`}>
          <h3 className="suggestion__title">{title}</h3>
          <p className="suggestion__reason">{reason}</p>
        </button>
        <div className="suggestion__actions">
          <button type="button" className="card__button" onClick={() => askAdd(media)} aria-label={`Ajouter ${title} à ma liste`}>
            <IconPlus width={16} height={16} /> À voir
          </button>
          <button type="button" className="card__button card__button--quiet" onClick={hide} aria-label={`Masquer ${title}, pas pour moi`}>
            Pas pour moi
          </button>
        </div>
      </div>
    </article>
  )
}
