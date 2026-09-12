import { useCallback, useRef, useState } from 'react'
import { CheckIcon, CloseIcon, InfoIcon, XCircleIcon } from './Icons'
import type { Toast } from '../types'

const LIFETIME_MS = 6000

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)

  const dismiss = useCallback((id: number) => {
    setToasts(list => list.filter(t => t.id !== id))
  }, [])

  const notify = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = nextId.current++
    setToasts(list => [...list.slice(-2), { ...toast, id }])
    window.setTimeout(() => dismiss(id), LIFETIME_MS)
  }, [dismiss])

  return { toasts, notify, dismiss }
}

interface Props {
  toasts: Toast[]
  onDismiss: (id: number) => void
}

export function Toasts({ toasts, onDismiss }: Props) {
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map(t => (
        <div key={t.id} className={`toast ${t.tone}`}>
          <span className="toast-icon">
            {t.tone === 'success' ? <CheckIcon size={16} /> : t.tone === 'error' ? <XCircleIcon size={16} /> : <InfoIcon size={16} />}
          </span>
          <div className="toast-body">
            <div className="toast-title">{t.title}</div>
            {t.body && <div className="toast-text">{t.body}</div>}
            {t.action && (
              <button
                className="toast-action"
                onClick={() => { t.action?.onClick(); onDismiss(t.id) }}
              >
                {t.action.label}
              </button>
            )}
          </div>
          <button className="toast-close" onClick={() => onDismiss(t.id)} aria-label="Dismiss">
            <CloseIcon size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}
