import { useEffect, useState } from 'react'
import { setAnimeScore } from '../../domain/actions'
import { displayTitle } from '../../domain/format'
import { globalScore } from '../../domain/progress'
import { Stars } from '../components/Bits'
import { Sheet } from '../components/Sheet'
import { useAnimeData } from '../hooks/anime'

/** Après « J'ai tout vu » : proposer (sans obliger) de noter l'anime. */
export function RateAnimeSheet({ mediaId, onClose }: { mediaId: number | null; onClose: () => void }) {
  const [last, setLast] = useState(mediaId)
  useEffect(() => {
    if (mediaId) setLast(mediaId)
  }, [mediaId])
  const id = mediaId ?? last
  return (
    <Sheet open={!!mediaId} onClose={onClose} label="Noter cet anime">
      {id && <Content key={id} mediaId={id} onClose={onClose} />}
    </Sheet>
  )
}

function Content({ mediaId, onClose }: { mediaId: number; onClose: () => void }) {
  const data = useAnimeData(mediaId)
  const shown = data?.root ?? data?.touched
  if (!data || !shown) return <div className="sheet-loading" aria-busy="true" />
  const score = globalScore(data.entries.values())
  return (
    <div className="completion">
      <p className="completion__eyebrow">Marqué comme vu</p>
      <h2 className="completion__title">{displayTitle(shown)}</h2>
      <p className="completion__hint">Une note ? C’est facultatif.</p>
      <Stars value={score} onChange={(v) => void setAnimeScore(data.franchiseId, v)} size={38} />
      <button type="button" className="button button--plain" onClick={onClose}>
        {score ? 'Terminé' : 'Plus tard'}
      </button>
    </div>
  )
}
