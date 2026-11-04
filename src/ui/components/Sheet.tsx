import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { IconClose } from './Icons'

interface Props {
  open: boolean
  onClose: () => void
  /** Libellé VoiceOver de la feuille. */
  label: string
  children: ReactNode
  /** Feuille presque plein écran (recherche). */
  tall?: boolean
}

const CLOSE_MS = 260

/** Feuille modale iOS : glisse depuis le bas, se ferme en tirant la poignée vers le bas. */
export function Sheet({ open, onClose, label, children, tall }: Props) {
  const [mounted, setMounted] = useState(open)
  const [closing, setClosing] = useState(false)
  const [drag, setDrag] = useState(0)
  const start = useRef<number | null>(null)
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) {
      setMounted(true)
      setClosing(false)
      setDrag(0)
    } else if (mounted) {
      setClosing(true)
      const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
      const t = setTimeout(() => setMounted(false), reduce ? 0 : CLOSE_MS)
      return () => clearTimeout(t)
    }
  }, [open, mounted])

  useEffect(() => {
    if (!open) return
    const prev = document.activeElement as HTMLElement | null
    panel.current?.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      prev?.focus?.({ preventScroll: true })
    }
  }, [open, onClose])

  if (!mounted) return null

  const onPointerDown = (e: React.PointerEvent) => {
    start.current = e.clientY
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (start.current !== null) setDrag(Math.max(0, e.clientY - start.current))
  }
  const onPointerUp = () => {
    if (start.current === null) return
    start.current = null
    if (drag > 90) onClose()
    else setDrag(0)
  }

  return createPortal(
    <div className={`sheet-root${closing ? ' is-closing' : ''}`}>
      <div className="sheet-backdrop" onClick={onClose} aria-hidden="true" />
      <div
        ref={panel}
        className={`sheet${tall ? ' sheet--tall' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        style={drag ? { transform: `translateY(${drag}px)`, transition: 'none' } : undefined}
      >
        <div
          className="sheet__grabber-zone"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <span className="sheet__grabber" aria-hidden="true" />
        </div>
        <button type="button" className="icon-button sheet__close" onClick={onClose} aria-label="Fermer">
          <IconClose width={20} height={20} />
        </button>
        <div className="sheet__body">{children}</div>
      </div>
    </div>,
    document.body,
  )
}
