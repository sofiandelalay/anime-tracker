import { memo } from 'react'
import { displayTitle } from '../../domain/format'
import type { CardModel } from '../../domain/listModel'
import { progressInfo, seasonLine } from '../../domain/progress'
import { Cover, ProgressBar } from './Bits'
import { IconPlus } from './Icons'

interface Props {
  card: CardModel
  onOpen: (card: CardModel) => void
  onIncrement: (card: CardModel) => void
  onAddSeason: (card: CardModel) => void
}

export const AnimeCard = memo(function AnimeCard({ card, onOpen, onIncrement, onAddSeason }: Props) {
  const title = displayTitle(card.media)
  const info = progressInfo(card.entry, card.media)
  const line =
    card.kind === 'newSeason'
      ? card.seasonNumber ? `Saison ${card.seasonNumber}` : 'Suite annoncée'
      : card.kind === 'completed'
        ? 'Terminé'
        : seasonLine(card.seasonNumber, info)
  const showBar = card.kind === 'current' || card.kind === 'planning' || card.kind === 'dropped'

  let action: React.ReactNode = null
  if (card.kind === 'newSeason') {
    action = (
      <button type="button" className="card__button" onClick={() => onAddSeason(card)}>
        <IconPlus width={18} height={18} /> Ajouter
      </button>
    )
  } else if (card.kind === 'current' || card.kind === 'planning') {
    const notYet = card.media.status === 'NOT_YET_RELEASED'
    action = (
      <button
        type="button"
        className="card__button"
        disabled={!info.canIncrement}
        onClick={() => onIncrement(card)}
        aria-label={info.canIncrement ? `Épisode ${info.watched + 1} vu, ${title}` : undefined}
      >
        {info.canIncrement ? <><IconPlus width={18} height={18} /> 1 épisode</> : notYet ? 'Bientôt' : 'À jour'}
      </button>
    )
  }

  return (
    <article className="card">
      <button type="button" className="card__main" onClick={() => onOpen(card)} aria-label={`${title}, ${line}. Ouvrir`}>
        <Cover src={card.media.cover} />
        <div className="card__info">
          {card.kind === 'newSeason' && <span className="badge">Nouvelle saison</span>}
          <h3 className="card__title">{title}</h3>
          <p className="card__line">{line}</p>
          {showBar && <ProgressBar info={info} label={`Progression de ${title}`} />}
        </div>
      </button>
      {action && <div className="card__actions">{action}</div>}
    </article>
  )
})
