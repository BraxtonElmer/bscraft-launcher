import { invoke } from '@tauri-apps/api/core'

interface Props {
  onCancel: () => void
}

export function CloseWarningModal({ onCancel }: Props) {
  const handleClose = async () => {
    await invoke('exit_app').catch(() => {})
    // exit_app calls app.exit(0) on the Rust side; this line is never reached
  }

  return (
    <div className="error-modal-overlay" onClick={onCancel}>
      <div className="close-warn-card" onClick={e => e.stopPropagation()}>

        {/* Icon */}
        <div className="close-warn-icon-wrap">
          <svg className="close-warn-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>

        {/* Text */}
        <div className="close-warn-title">Minecraft is still running</div>
        <div className="close-warn-body">
          Closing the launcher will <strong>terminate Minecraft</strong> immediately.
          Any unsaved game progress may be lost.
        </div>

        {/* Buttons */}
        <div className="close-warn-footer">
          <button id="btn-close-warn-cancel" className="error-modal-close" onClick={onCancel}>
            Cancel
          </button>
          <button id="btn-close-warn-confirm" className="close-warn-confirm" onClick={handleClose}>
            Close Anyway
          </button>
        </div>

      </div>
    </div>
  )
}
