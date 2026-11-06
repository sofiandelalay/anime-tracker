import { memo } from 'react'
import { formatStartDate } from '../../domain/format'
import type { CardModel } from '../../domain/listModel'
import { isReleased, progressInfo, seasonLine } from '../../domain/progress'
import { useAiringLabel } from '../hooks/clock'
import { Cover, ProgressBar } from './Bits'
import { IconPlus } from './Icons'

interface Props {
  card: CardModel
  onOpen: (card: CardModel) => void
  onIncrement: (card: CardModel) => void
  onFollow: (card: CardModel) => void
}

/** Une carte = un anime entier ; la ligne et la barre sont celles de sa saison en cours. */
export const AnimeCard = memo(function AnimeCard({ card, onOpen, onIncrement, onFollow }: Props) {
  const title = card.animeTitle
  const info = progressInfo(card.entry, card.media)
  const released = isReleased(card.media)
  const start = released ? null : formatStartDate(card.media.startDate)
  const line =
    card.kind === 'completed'
      ? 'Terminé'
      : released
        ? seasonLine(card.seasonNumber, info)
        : [card.seasonNumber ? `Saison ${card.seasonNumber}` : null, start ?? 'À venir'].filter(Boolean).join(' · ')
  const showBar = released && card.kind !== 'completed'
  const airing = card.kind !== 'completed' && card.kind !== 'dropped' && card.media.status === 'RELEASING'
  const countdown = useAiringLabel(airing ? card.media.nextAiring : null)

  let action: React.ReactNode = null
  if (!card.followed && card.kind !== 'dropped') {
    action = (
      <button type="button" className="card__button" onClick={() => onFollow(card)}>
        <IconPlus width={18} height={18} /> Suivre
      </button>
    )
  } else if (card.kind === 'current' || card.kind === 'planning' || card.kind === 'newSeason') {
    action = (
      <button
        type="button"
        className="card__button"
        disabled={!info.canIncrement}
        onClick={() => onIncrement(card)}
        aria-label={info.nextEpisode ? `Épisode ${info.nextEpisode} vu, ${title}` : undefined}
      >
        {info.canIncrement ? <><IconPlus width={18} height={18} /> 1 épisode</> : released ? 'À jour' : 'Bientôt'}
      </button>
    )
  }

  return (
    <article className="card">
      <button type="button" className="card__main" onClick={() => onOpen(card)} aria-label={`${title}, ${line}${countdown ? `, ${countdown}` : ''}${card.newSeason ? ', nouvelle saison' : ''}${card.viewingBadge ? `, ${card.viewingBadge}` : ''}. Ouvrir`}>
        <Cover src={card.media.cover} />
        <div className="card__info">
          {card.newSeason && <span className={`badge${card.followed ? '' : ' badge--quiet'}`}>Nouvelle saison</span>}
          {card.viewingBadge && <span className="badge badge--quiet">{card.viewingBadge}</span>}
          <h3 className="card__title">{title}</h3>
          <p className="card__line">{line}</p>
          {countdown && <p className="card__countdown">{countdown}</p>}
          {showBar && <ProgressBar info={info} label={`Progression de ${title}`} />}
        </div>
      </button>
      {action && <div className="card__actions">{action}</div>}
    </article>
  )
})
