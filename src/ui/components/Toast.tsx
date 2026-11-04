import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'

export interface ToastInput {
  message: string
  action?: { label: string; onAction: () => void | Promise<void> }
  /** Durée en ms ; 0 = reste affiché. */
  duration?: number
}

interface ToastState extends ToastInput {
  id: number
}

const ToastContext = createContext<(t: ToastInput) => void>(() => {})

export const useToast = () => useContext(ToastContext)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null)
  const counter = useRef(0)

  const show = useCallback((t: ToastInput) => setToast({ ...t, id: ++counter.current }), [])

  useEffect(() => {
    if (!toast || toast.duration === 0) return
    const id = toast.id
    const timer = setTimeout(() => setToast((cur) => (cur?.id === id ? null : cur)), toast.duration ?? 3000)
    return () => clearTimeout(timer)
  }, [toast])

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toast-region" role="status" aria-live="polite">
        {toast && (
          <div className="toast" key={toast.id}>
            <span className="toast__message">{toast.message}</span>
            {toast.action && (
              <button
                type="button"
                className="toast__action"
                onClick={() => {
                  const a = toast.action!
                  setToast(null)
                  void a.onAction()
                }}
              >
                {toast.action.label}
              </button>
            )}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  )
}
