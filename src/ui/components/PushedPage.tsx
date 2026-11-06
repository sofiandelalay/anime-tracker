import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

const CLOSE_MS = 240
/** Largeur de la zone de balayage, depuis le bord gauche. */
const EDGE = 24

/**
 * Pile des pages ouvertes, branchée sur l'historique du navigateur : le bouton retour, le geste natif de Safari
 * et notre balayage du bord ferment toujours la page du dessus.
 */
const stack: (() => void)[] = []
let listening = false

function pushNav(close: () => void): void {
  if (!listening) {
    listening = true
    addEventListener('popstate', () => stack.pop()?.())
  }
  stack.push(close)
  history.pushState({ page: stack.length }, '')
}

export const goBack = (): void => history.back()

/** Page plein écran à navigation iOS : arrive de la droite, repart par « retour » ou en balayant depuis le bord gauche. */
export function PushedPage({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  const [closing, setClosing] = useState(false)
  const [drag, setDrag] = useState(0)
  const start = useRef<number | null>(null)
  const panel = useRef<HTMLDivElement>(null)
  const pushed = useRef(false)

  useEffect(() => {
    if (pushed.current) return
    pushed.current = true
    pushNav(() => {
      setClosing(true)
      const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
      setTimeout(onClose, reduce ? 0 : CLOSE_MS)
    })
    panel.current?.focus({ preventScroll: true })
  }, [onClose])

  const onPointerEnd = () => {
    if (start.current === null) return
    start.current = null
    if (drag > window.innerWidth * 0.33) goBack()
    else setDrag(0)
  }

  return createPortal(
    <div
      ref={panel}
      className={`page-root${closing ? ' is-closing' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      tabIndex={-1}
      style={drag ? { transform: `translateX(${drag}px)`, transition: 'none' } : undefined}
    >
      <div
        className="page-edge"
        style={{ width: EDGE }}
        aria-hidden="true"
        onPointerDown={(e) => {
          start.current = e.clientX
          e.currentTarget.setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => {
          if (start.current !== null) setDrag(Math.max(0, e.clientX - start.current))
        }}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
      />
      {children}
    </div>,
    document.body,
  )
}
