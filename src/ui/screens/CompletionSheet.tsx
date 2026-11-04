import { useEffect, useState } from 'react'
import { fetchMedia } from '../../api/media'
import { cacheDb } from '../../db/cacheDb'
import { db } from '../../db/trackerDb'
import { addAnime, setScore } from '../../domain/actions'
import { displayTitle } from '../../domain/format'
import { Cover, Stars } from '../components/Bits'
import { Sheet } from '../components/Sheet'
import { useToast } from '../components/Toast'
import { useLive } from '../hooks/hooks'

export interface Completion {
  mediaId: number
  nextSeasonId: number | null
}

/** Après le dernier épisode : proposer (sans obliger) une note et la saison suivante. */
export function CompletionSheet({ completion, onClose }: { completion: Completion | null; onClose: () => void }) {
  const [last, setLast] = useState(completion)
  useEffect(() => {
    if (completion) setLast(completion)
  }, [completion])
  const c = completion ?? last

  return (
    <Sheet open={!!completion} onClose={onClose} label="Saison terminée">
      {c && <Content key={c.mediaId} completion={c} onClose={onClose} />}
    </Sheet>
  )
}

function Content({ completion, onClose }: { completion: Completion; onClose: () => void }) {
  const toast = useToast()
  const data = useLive(async () => {
    const [entry, media, next, nextEntry] = await Promise.all([
      db.entries.get(completion.mediaId),
      cacheDb.media.get(completion.mediaId),
      completion.nextSeasonId ? cacheDb.media.get(completion.nextSeasonId) : undefined,
      completion.nextSeasonId ? db.entries.get(completion.nextSeasonId) : undefined,
    ])
    return { entry, media, next, nextEntry }
  }, [completion.mediaId, completion.nextSeasonId])

  useEffect(() => {
    if (completion.nextSeasonId && data && !data.next) void fetchMedia(completion.nextSeasonId).catch(() => undefined)
  }, [completion.nextSeasonId, data])

  if (!data?.media || !data.entry) return <div className="sheet-loading" aria-busy="true" />

  return (
    <div className="completion">
      <p className="completion__eyebrow">Saison terminée</p>
      <h2 className="completion__title">{displayTitle(data.media)}</h2>
      <p className="completion__hint">Une note ? C’est facultatif.</p>
      <Stars value={data.entry.score} onChange={(v) => setScore(completion.mediaId, v)} size={38} />

      {data.next && !data.nextEntry && (
        <div className="completion__next">
          <Cover src={data.next.cover} size="s" />
          <div className="completion__next-text">
            <span className="completion__next-label">La suite existe</span>
            <span className="completion__next-title">{displayTitle(data.next)}</span>
          </div>
          <button
            type="button"
            className="button button--primary button--small"
            onClick={async () => {
              await addAnime(data.next!)
              toast({ message: 'Saison suivante ajoutée' })
              onClose()
            }}
          >
            Ajouter
          </button>
        </div>
      )}

      <button type="button" className="button button--plain" onClick={onClose}>
        {data.entry.score ? 'Terminé' : 'Plus tard'}
      </button>
    </div>
  )
}
