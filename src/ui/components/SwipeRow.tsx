import { useRef, useState, type ReactNode } from 'react'

export interface SwipeAction {
  label: string
  tone?: 'danger'
  onAction: () => void
}

const ACTION_WIDTH = 92
const LOCK = 10

/** Balayer vers la gauche révèle des actions ; le défilement vertical reste natif. */
export function SwipeRow({ actions, children }: { actions: SwipeAction[]; children: ReactNode }) {
  const width = ACTION_WIDTH * actions.length
  const [x, setX] = useState(0)
  const [dragging, setDragging] = useState(false)
  const gesture = useRef<{ x: number; y: number; base: number; locked: boolean; moved: boolean } | null>(null)
  const swallowClick = useRef(false)

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    gesture.current = { x: e.clientX, y: e.clientY, base: x, locked: false, moved: false }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const g = gesture.current
    if (!g) return
    const dx = e.clientX - g.x
    if (!g.locked) {
      if (Math.abs(e.clientY - g.y) > LOCK && Math.abs(e.clientY - g.y) > Math.abs(dx)) {
        gesture.current = null
        return
      }
      if (Math.abs(dx) < LOCK) return
      g.locked = true
      g.moved = true
      setDragging(true)
      e.currentTarget.setPointerCapture(e.pointerId)
    }
    setX(Math.min(0, Math.max(-width - 24, g.base + dx)))
  }
  const onPointerEnd = () => {
    const g = gesture.current
    gesture.current = null
    setDragging(false)
    if (g?.moved) {
      swallowClick.current = true
      setX(x < -width / 2 ? -width : 0)
    }
  }

  return (
    <div className="swipe">
      {x < 0 && (
        <div className="swipe__actions" style={{ width }}>
          {actions.map((a) => (
            <button
              key={a.label}
              type="button"
              className={`swipe__action${a.tone === 'danger' ? ' swipe__action--danger' : ''}`}
              onClick={() => {
                setX(0)
                a.onAction()
              }}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
      <div
        className="swipe__content"
        style={{ transform: x ? `translateX(${x}px)` : undefined, transition: dragging ? 'none' : undefined }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onClickCapture={(e) => {
          // Fin d'un balayage, ou carte déjà ouverte : le toucher referme au lieu d'ouvrir.
          if (swallowClick.current || x !== 0) {
            swallowClick.current = false
            e.preventDefault()
            e.stopPropagation()
            if (x !== 0 && !dragging) setX(0)
          }
        }}
      >
        {children}
      </div>
    </div>
  )
}
