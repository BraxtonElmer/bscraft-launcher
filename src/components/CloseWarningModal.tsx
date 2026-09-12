import { useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { AlertIcon } from './Icons'

interface Props {
  onCancel: () => void
}

export function CloseWarningModal({ onCancel }: Props) {
  const handleClose = async () => {
    // exit_app kills Minecraft and exits on the Rust side; it never returns
    await invoke('exit_app').catch(() => {})
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div
        className="modal narrow"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="close-warn-title"
        onClick={e => e.stopPropagation()}
      >
        <div className="modal-head">
          <div className="modal-icon warn"><AlertIcon size={20} /></div>
          <div>
            <h2 id="close-warn-title" className="modal-title">Minecraft is still running</h2>
            <p className="modal-sub">
              Closing the launcher will <strong>stop Minecraft immediately</strong>. Any unsaved progress may be lost.
            </p>
          </div>
        </div>

        <div className="modal-foot">
          <button id="btn-close-warn-cancel" className="btn ghost" onClick={onCancel} autoFocus>
            Keep playing
          </button>
          <button id="btn-close-warn-confirm" className="btn warn" onClick={handleClose}>
            Close anyway
          </button>
        </div>
      </div>
    </div>
  )
}
