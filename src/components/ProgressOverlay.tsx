import type { ActiveOperation } from '../types'

interface Props {
  operation: ActiveOperation
}

function formatSpeed(bps: number): string {
  if (bps < 1024) return ''
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(0)} KB/s`
  return `${(bps / 1024 / 1024).toFixed(1)} MB/s`
}

export function ProgressOverlay({ operation }: Props) {
  const { title, detail, file, overallPercent, speedBps, filesDone, filesTotal } = operation

  // Build the right-side counter text
  const counterText = filesTotal > 1
    ? `${filesDone} / ${filesTotal}`
    : overallPercent > 0
    ? `${overallPercent.toFixed(0)}%`
    : ''

  // Current item label: prefer file name, fall back to detail
  const itemLabel = file
    ? file.split('/').pop() ?? file   // just the filename portion
    : detail ?? ''

  const speed = formatSpeed(speedBps)

  return (
    <div className="progress-overlay fade-in">
      <div className="progress-card">

        {/* Operation title */}
        <div className="progress-title">{title}</div>

        {/* Current item — filename or stage detail */}
        {itemLabel && (
          <div className="progress-current" title={file || detail}>
            {itemLabel}
          </div>
        )}

        {/* Single overall progress bar */}
        <div className="progress-track-wrap">
          <div className="progress-bar-track">
            <div
              className="progress-bar-fill"
              style={{ width: `${Math.min(Math.max(overallPercent, 0), 100)}%` }}
            />
          </div>
          <div className="progress-counts">
            <span>{counterText}</span>
            {speed && <span>{speed}</span>}
          </div>
        </div>

      </div>
    </div>
  )
}
