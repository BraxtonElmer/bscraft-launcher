import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'

interface Props {
  error: string
  context: string
  onClose: () => void
}

export function ErrorModal({ error, context, onClose }: Props) {
  const [reportPath, setReportPath] = useState<string | null>(null)

  useEffect(() => {
    invoke<string>('write_error_report', { context, message: error })
      .then(setReportPath)
      .catch(() => {})
  }, [error, context])

  return (
    <div className="error-modal-overlay" onClick={onClose}>
      <div className="error-modal-card" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="error-modal-header">
          <svg className="error-modal-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="error-modal-title">Something went wrong</span>
        </div>

        {/* Context label */}
        <div className="error-modal-context">{context}</div>

        {/* Full error text — selectable & scrollable */}
        <textarea
          className="error-modal-text"
          readOnly
          value={error}
        />

        {/* Error report path */}
        {reportPath && (
          <div className="error-modal-report">
            <span className="error-modal-report-label">Report saved:</span>
            <code className="error-modal-report-path">{reportPath}</code>
          </div>
        )}

        {/* Footer */}
        <div className="error-modal-footer">
          <button id="btn-error-close" className="error-modal-close" onClick={onClose}>
            Close
          </button>
        </div>

      </div>
    </div>
  )
}
