// ============================================================
// ui.tsx — Small shared controls
// ============================================================

import type { ReactNode } from 'react'
import { formatBytes, formatSpeed } from '../lib/format'
import type { ActiveOperation } from '../types'

export function Spinner({ size = 16 }: { size?: number }) {
  return <span className="spinner" style={{ width: size, height: size }} aria-hidden />
}

interface ToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  id?: string
  label: string
}

export function Toggle({ checked, onChange, disabled, id, label }: ToggleProps) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`toggle${checked ? ' on' : ''}`}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="toggle-thumb" />
    </button>
  )
}

export interface SegmentOption<T extends string> {
  value: T
  label: ReactNode
  icon?: ReactNode
  title?: string
}

interface SegmentedProps<T extends string> {
  value: T
  options: SegmentOption<T>[]
  onChange: (value: T) => void
  disabled?: boolean
  size?: 'sm' | 'md'
  label: string
  id?: string
}

export function Segmented<T extends string>({ value, options, onChange, disabled, size = 'md', label, id }: SegmentedProps<T>) {
  return (
    <div id={id} className={`segmented ${size}${disabled ? ' disabled' : ''}`} role="radiogroup" aria-label={label}>
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={o.value === value ? 'active' : ''}
          disabled={disabled}
          title={o.title}
          onClick={() => { if (o.value !== value) onChange(o.value) }}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  )
}

interface ProgressBarProps {
  percent: number
  indeterminate?: boolean
  /** Split the bar into steps; `percent` is progress within the current step */
  step?: number
  stepCount?: number
}

export function ProgressBar({ percent, indeterminate, step = 0, stepCount = 0 }: ProgressBarProps) {
  const pct = Math.min(Math.max(percent, 0), 100)

  if (stepCount > 1 && step > 0) {
    return (
      <div className="progress-steps" role="progressbar" aria-valuemin={0} aria-valuemax={stepCount} aria-valuenow={step - 1 + pct / 100}>
        {Array.from({ length: stepCount }, (_, i) => {
          const state = i < step - 1 ? 'done' : i === step - 1 ? 'current' : 'todo'
          return (
            <div key={i} className={`progress ${state}${state === 'current' && indeterminate ? ' indeterminate' : ''}`}>
              <div className="progress-fill" style={{ width: state === 'done' ? '100%' : state === 'current' && !indeterminate ? `${pct}%` : undefined }} />
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div
      className={`progress${indeterminate ? ' indeterminate' : ''}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : Math.round(pct)}
    >
      <div className="progress-fill" style={{ width: indeterminate ? undefined : `${pct}%` }} />
    </div>
  )
}

/** Human-readable pieces of an operation's progress */
export function describeOperation(op: ActiveOperation) {
  const meta: string[] = []
  if (op.filesTotal > 1) meta.push(`${op.filesDone.toLocaleString()} / ${op.filesTotal.toLocaleString()} files`)
  if (op.bytesTotal > 0) meta.push(`${formatBytes(op.bytesDone)} / ${formatBytes(op.bytesTotal)}`)
  const speed = formatSpeed(op.speedBps)
  if (speed) meta.push(speed)

  const item = op.file ? op.file.split('/').pop() ?? op.file : op.detail
  const percentText = op.indeterminate ? '' : `${Math.floor(Math.min(Math.max(op.overallPercent, 0), 100))}%`
  return { meta, item, percentText }
}
