import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { rememberMedia } from '../../api/media'
import { db } from '../../db/trackerDb'
import { followAnime, type EpisodeOutcome, type Undo } from '../../domain/actions'
import type { Media } from '../../domain/types'
import { useToast } from '../components/Toast'
import { AnimePage } from './AnimePage'
import { AnimeSheet, type SheetTarget } from './AnimeSheet'
import { CompletionSheet } from './CompletionSheet'
import { RateAnimeSheet } from './RateAnimeSheet'
import { EpisodePage, type EpisodeTarget } from './EpisodePage'
import { WhereSheet } from './WhereSheet'

interface AnimeFlow {
  /** Ouvre la feuille d'une fiche reçue ailleurs (grille, suggestion, recherche), sans nouvelle requête. */
  openMedia: (media: Media) => void
  /** « Voir plus » : la page complète. */
  openPage: (target: SheetTarget) => void
  /** La page d'un épisode, par-dessus le reste. */
  openEpisode: (target: EpisodeTarget) => void
  /** Ajoute l'anime : pose « Tu en es où ? », ou suit simplement un anime déjà enregistré. */
  askAdd: (media: Media) => void
  /** Après un changement d'épisode : fin de saison et note, ou « Enregistré · Suivre ». */
  handleOutcome: (outcome: EpisodeOutcome) => void
  /** Toast discret après une action sur un anime non suivi. */
  recorded: (franchiseId: number) => void
  follow: (franchiseId: number) => Promise<void>
}

const AnimeFlowContext = createContext<AnimeFlow | null>(null)

export function useAnimeFlow(): AnimeFlow {
  const flow = useContext(AnimeFlowContext)
  if (!flow) throw new Error('AnimeFlowProvider manquant')
  return flow
}

/** La même feuille et la même page pour tous les onglets. */
export function AnimeFlowProvider({ children }: { children: ReactNode }) {
  const toast = useToast()
  const [sheet, setSheet] = useState<SheetTarget | null>(null)
  const [page, setPage] = useState<SheetTarget | null>(null)
  const [episode, setEpisode] = useState<EpisodeTarget | null>(null)
  const [completion, setCompletion] = useState<number | null>(null)
  const [where, setWhere] = useState<Media | null>(null)
  const [seenAll, setSeenAll] = useState<{ mediaId: number; undo: Undo } | null>(null)

  const follow = useCallback(async (franchiseId: number) => {
    const undo = await followAnime(franchiseId)
    toast({ message: 'Ajouté à À suivre', action: { label: 'Annuler', onAction: undo }, duration: 5000 })
  }, [toast])

  const recorded = useCallback((franchiseId: number) => {
    toast({ message: 'Enregistré', action: { label: 'Suivre', onAction: () => follow(franchiseId) }, duration: 4000 })
  }, [toast, follow])

  const handleOutcome = useCallback((out: EpisodeOutcome) => {
    if (!out.changed) return
    if (!out.followed) {
      recorded(out.franchiseId)
      return
    }
    if (!out.completed) return
    // Fin d'un revisionnage : la note ne se redemande jamais.
    if (out.viewing > 1) {
      toast({ message: `Vu ${out.seen} fois`, action: { label: 'Annuler', onAction: out.undo }, duration: 5000 })
      return
    }
    setCompletion(out.mediaId)
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
  }, [toast, recorded])

  const openMedia = useCallback((media: Media) => {
    void rememberMedia(media).finally(() => setSheet({ mediaId: media.id }))
  }, [])

  const askAdd = useCallback((media: Media) => {
    void (async () => {
      const own = await db.entries.get(media.id)
      if (own) await follow(own.franchiseId)
      else {
        await rememberMedia(media)
        setWhere(media)
      }
    })()
  }, [follow])

  const value = useMemo(
    () => ({ openMedia, openPage: setPage, openEpisode: setEpisode, askAdd, handleOutcome, recorded, follow }),
    [openMedia, askAdd, handleOutcome, recorded, follow],
  )
  const closeSheet = useCallback(() => setSheet(null), [])
  const closeCompletion = useCallback(() => setCompletion(null), [])
  const closeWhere = useCallback(() => setWhere(null), [])
  const onSeenAll = useCallback((media: Media, undo: Undo) => setSeenAll({ mediaId: media.id, undo }), [])
  const closeRate = useCallback(() => {
    if (seenAll) toast({ message: 'Marqué comme vu', action: { label: 'Annuler', onAction: seenAll.undo }, duration: 5000 })
    setSeenAll(null)
  }, [seenAll, toast])
  const closePage = useCallback(() => setPage(null), [])
  const closeEpisode = useCallback(() => setEpisode(null), [])

  return (
    <AnimeFlowContext.Provider value={value}>
      {children}
      {page && <AnimePage key={page.mediaId} target={page} onClose={closePage} />}
      {episode && <EpisodePage key={`${episode.mediaId}-${episode.episode}`} target={episode} onClose={closeEpisode} />}
      <AnimeSheet target={sheet} onClose={closeSheet} />
      <CompletionSheet mediaId={completion} onClose={closeCompletion} />
      <WhereSheet media={where} onClose={closeWhere} onSeenAll={onSeenAll} />
      <RateAnimeSheet mediaId={seenAll?.mediaId ?? null} onClose={closeRate} />
    </AnimeFlowContext.Provider>
  )
}
