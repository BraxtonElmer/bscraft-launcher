import { useState, type FormEvent, type ReactNode } from 'react'
import { EyeIcon, EyeOffIcon, KeyIcon } from './Icons'
import { Spinner } from './ui'

interface Props {
  /** Asks for the password twice (setting a new one) instead of once (entering an existing one) */
  confirm?: boolean
  submitLabel: string
  onSubmit: (password: string) => Promise<void>
  onCancel?: () => void
  cancelLabel?: string
  autoFocus?: boolean
  extra?: ReactNode
}

/** Same rules the backend enforces, checked up front for instant feedback */
export function passwordProblem(p: string): string | null {
  const n = [...p].length
  if (n < 4) return 'Use at least 4 characters.'
  if (n > 64) return 'Use at most 64 characters.'
  if (p.trim() !== p) return "It can't start or end with a space."
  return null
}

export function PasswordForm({ confirm, submitLabel, onSubmit, onCancel, cancelLabel = 'Cancel', autoFocus, extra }: Props) {
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const problem = password ? passwordProblem(password) : null
  const mismatch = confirm && repeat.length > 0 && repeat !== password
  const ready = !!password && !problem && (!confirm || repeat === password)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!ready || busy) return
    setBusy(true)
    setError(null)
    try {
      await onSubmit(password)
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="pw-form" onSubmit={submit}>
      <div className="pw-field">
        <KeyIcon size={15} className="pw-icon" />
        <input
          type={show ? 'text' : 'password'}
          value={password}
          onChange={e => setPassword(e.target.value)}
          placeholder={confirm ? 'New password' : 'Password'}
          autoComplete={confirm ? 'new-password' : 'current-password'}
          autoFocus={autoFocus}
          maxLength={64}
          aria-label={confirm ? 'New password' : 'Password'}
        />
        <button type="button" className="pw-toggle" onClick={() => setShow(s => !s)} aria-label={show ? 'Hide password' : 'Show password'}>
          {show ? <EyeOffIcon size={15} /> : <EyeIcon size={15} />}
        </button>
      </div>
      {confirm && (
        <div className="pw-field">
          <KeyIcon size={15} className="pw-icon" />
          <input
            type={show ? 'text' : 'password'}
            value={repeat}
            onChange={e => setRepeat(e.target.value)}
            placeholder="Repeat password"
            autoComplete="new-password"
            maxLength={64}
            aria-label="Repeat password"
          />
        </div>
      )}
      {(problem || mismatch || error) && (
        <div className="pw-error">{error ?? problem ?? "The passwords don't match."}</div>
      )}
      {extra}
      <div className="pw-actions">
        {onCancel && <button type="button" className="btn ghost sm" onClick={onCancel}>{cancelLabel}</button>}
        <button type="submit" className="btn brand sm" disabled={!ready || busy}>
          {busy && <Spinner size={12} />} {submitLabel}
        </button>
      </div>
    </form>
  )
}
