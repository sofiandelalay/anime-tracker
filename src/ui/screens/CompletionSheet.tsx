import { useEffect, useState } from 'react'
import { cacheDb } from '../../db/cacheDb'
import { db } from '../../db/trackerDb'
import { setScore } from '../../domain/actions'
import { displayTitle } from '../../domain/format'
import { Stars } from '../components/Bits'
import { Sheet } from '../components/Sheet'
import { useLive } from '../hooks/hooks'

/** Après le dernier épisode : proposer (sans obliger) une note. La suite est déjà rattachée à l'anime. */
export function CompletionSheet({ mediaId, onClose }: { mediaId: number | null; onClose: () => void }) {
  const [last, setLast] = useState(mediaId)
  useEffect(() => {
    if (mediaId) setLast(mediaId)
  }, [mediaId])
  const id = mediaId ?? last

  return (
    <Sheet open={!!mediaId} onClose={onClose} label="Saison terminée">
      {id && <Content key={id} mediaId={id} onClose={onClose} />}
    </Sheet>
  )
}

function Content({ mediaId, onClose }: { mediaId: number; onClose: () => void }) {
  const data = useLive(async () => {
    const [entry, media] = await Promise.all([db.entries.get(mediaId), cacheDb.media.get(mediaId)])
    return { entry, media }
  }, [mediaId])

  if (!data?.media || !data.entry) return <div className="sheet-loading" aria-busy="true" />
  const media = data.media

  return (
    <div className="completion">
      <p className="completion__eyebrow">Saison terminée</p>
      <h2 className="completion__title">{displayTitle(media)}</h2>
      <p className="completion__hint">Une note ? C’est facultatif.</p>
      <Stars value={data.entry.score} onChange={(v) => setScore(media, v)} size={38} />
      <button type="button" className="button button--plain" onClick={onClose}>
        {data.entry.score ? 'Terminé' : 'Plus tard'}
      </button>
    </div>
  )
}
