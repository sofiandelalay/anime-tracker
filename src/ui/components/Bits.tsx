import { useId, useRef, useState, type ReactNode } from 'react'
import type { ProgressInfo } from '../../domain/progress'
import { useOnline } from '../hooks/hooks'
import { IconCloudOff } from './Icons'

/** Contrôle segmenté iOS. */
export function Segmented<T extends string>({
  options, value, onChange, label, small,
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
  label: string
  small?: boolean
}) {
  const index = Math.max(0, options.findIndex((o) => o.value === value))
  return (
    <div className={`segmented${small ? ' segmented--small' : ''}`} role="radiogroup" aria-label={label}>
      <span
        className="segmented__thumb"
        aria-hidden="true"
        style={{ width: `calc((100% - 4px) / ${options.length})`, transform: `translateX(${index * 100}%)` }}
      />
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={`segmented__item${o.value === value ? ' is-active' : ''}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Barre de progression fine ; repère des épisodes sortis si la saison est en diffusion. */
export function ProgressBar({ info, label }: { info: ProgressInfo; label: string }) {
  return (
    <div
      className="progress"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={info.total ?? undefined}
      aria-valuenow={info.watched}
      aria-valuetext={
        info.total ? `${info.watched} épisodes vus sur ${info.total}${info.airedRatio !== null ? `, ${info.aired} sortis` : ''}` : `${info.watched} épisodes vus`
      }
    >
      {info.airedRatio !== null && <span className="progress__aired" style={{ width: `${info.airedRatio * 100}%` }} />}
      <span className="progress__fill" style={{ width: `${info.watchedRatio * 100}%` }} />
    </div>
  )
}

export function OfflinePill() {
  const online = useOnline()
  if (online) return null
  return (
    <p className="offline-pill" role="status">
      <IconCloudOff width={14} height={14} /> Hors ligne
    </p>
  )
}

export function Cover({ src, size = 'm', alt = '', children }: { src: string | null; size?: 's' | 'm' | 'l' | 'xl' | 'fill'; alt?: string; children?: ReactNode }) {
  const [loaded, setLoaded] = useState(false)
  return (
    <div className={`cover cover--${size}`}>
      {src && (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          className={loaded ? 'is-loaded' : ''}
          onLoad={() => setLoaded(true)}
        />
      )}
      {children}
    </div>
  )
}

/** Étoiles en lecture seule (note globale, moyenne des saisons). */
export function StarsDisplay({ value, size = 24 }: { value: number | null; size?: number }) {
  const clip = `half${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  return (
    <span className="stars stars--display" aria-hidden="true">
      <StarIcons shown={value ?? 0} size={size} clip={clip} />
    </span>
  )
}

function StarIcons({ shown, size, clip }: { shown: number; size: number; clip: string }) {
  return (
    <>
      {[1, 2, 3, 4, 5].map((i) => {
        const fill = shown >= i ? 1 : shown >= i - 0.5 ? 0.5 : 0
        return (
          <svg key={i} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
            <defs>
              <clipPath id={`${clip}-${i}`}><rect x="0" y="0" width="12" height="24" /></clipPath>
            </defs>
            <path className="stars__empty" d={STAR} />
            {fill > 0 && <path className="stars__full" d={STAR} clipPath={fill === 0.5 ? `url(#${clip}-${i})` : undefined} />}
          </svg>
        )
      })}
    </>
  )
}

/** Note en étoiles : 0,5 à 5 par demi-étoile. Toucher la note actuelle l'efface. */
export function Stars({ value, onChange, size = 30 }: { value: number | null; onChange: (v: number | null) => void; size?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [preview, setPreview] = useState<number | null>(null)
  const clip = `half${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`
  const shown = preview ?? value ?? 0

  const valueAt = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect()
    const x = Math.min(Math.max(clientX - r.left, 0), r.width)
    return Math.max(0.5, Math.ceil((x / r.width) * 10) / 2)
  }
  const commit = (v: number) => onChange(v === value ? null : v)

  return (
    <div
      ref={ref}
      className="stars"
      role="slider"
      tabIndex={0}
      aria-label="Ma note"
      aria-valuemin={0}
      aria-valuemax={5}
      aria-valuenow={value ?? 0}
      aria-valuetext={value ? `${value.toLocaleString('fr-FR')} étoile${value > 1 ? 's' : ''} sur 5` : 'Pas de note'}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        setPreview(valueAt(e.clientX))
      }}
      onPointerMove={(e) => preview !== null && setPreview(valueAt(e.clientX))}
      onPointerUp={(e) => {
        if (preview === null) return
        setPreview(null)
        commit(valueAt(e.clientX))
      }}
      onPointerCancel={() => setPreview(null)}
      onKeyDown={(e) => {
        const cur = value ?? 0
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') onChange(Math.min(5, cur + 0.5))
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') onChange(cur - 0.5 <= 0 ? null : cur - 0.5)
        else return
        e.preventDefault()
      }}
    >
      <StarIcons shown={shown} size={size} clip={clip} />
    </div>
  )
}
const STAR = 'M12 2.8l2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3L2.9 9.5l6.3-.9z'

export function EmptyState({ title, text, action }: { title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <p className="empty__title">{title}</p>
      {text && <p className="empty__text">{text}</p>}
      {action}
    </div>
  )
}

export function SkeletonCards({ count = 3 }: { count?: number }) {
  return (
    <div aria-busy="true" aria-label="Chargement">
      {Array.from({ length: count }, (_, i) => (
        <div className="card card--skeleton" key={i} aria-hidden="true">
          <div className="cover cover--m skeleton" />
          <div className="card__info">
            <div className="skeleton skeleton--line" style={{ width: '70%' }} />
            <div className="skeleton skeleton--line" style={{ width: '45%' }} />
            <div className="skeleton skeleton--bar" />
          </div>
        </div>
      ))}
    </div>
  )
}
