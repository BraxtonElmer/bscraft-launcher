import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { copyText } from '../lib/clipboard'
import { AlertIcon, CheckIcon, CopyIcon } from './Icons'

interface Props {
  error: string
  context: string
  onClose: () => void
}

export function ErrorModal({ error, context, onClose }: Props) {
  const [reportPath, setReportPath] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    invoke<string>('write_error_report', { context, message: error })
      .then(setReportPath)
      .catch(() => {})
  }, [error, context])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const handleCopy = async () => {
    const text = `${context}\n\n${error}${reportPath ? `\n\nReport: ${reportPath}` : ''}`
    if (await copyText(text)) {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="error-title"
        onClick={e => e.stopPropagation()}
      >
        <div className="modal-head">
          <div className="modal-icon danger"><AlertIcon size={20} /></div>
          <div>
            <h2 id="error-title" className="modal-title">Something went wrong</h2>
            <p className="modal-sub">{context}</p>
          </div>
        </div>

        <pre className="modal-code">{error}</pre>

        {reportPath && (
          <div className="modal-report">
            <span>Report saved to</span>
            <code>{reportPath}</code>
          </div>
        )}

        <div className="modal-foot">
          <button className="btn ghost" onClick={handleCopy}>
            {copied ? <CheckIcon size={15} /> : <CopyIcon size={15} />}
            {copied ? 'Copied' : 'Copy details'}
          </button>
          <button id="btn-error-close" className="btn" onClick={onClose} autoFocus>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
