import { useEffect, useRef, useState, type ReactNode } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { PlayerHead } from '../../components/PlayerHead'
import { PasswordForm } from '../../components/PasswordForm'
import { Spinner } from '../../components/ui'
import {
  AlertIcon, CheckIcon, CopyIcon, EyeIcon, EyeOffIcon, InfoIcon, KeyIcon,
  PencilIcon, RefreshIcon, UserIcon, XCircleIcon,
} from '../../components/Icons'
import { copyText } from '../../lib/clipboard'
import { sanitizeUsername, usernameProblem } from '../../lib/format'
import type { AccountApi } from '../../hooks/useAccount'
import type { Skin } from '../../lib/skin'
import type { ServerAccount } from '../../types'

interface Props {
  username: string
  account: AccountApi
  skin: Skin | null
  gameRunning: boolean
  onRename: (name: string) => Promise<void>
}

export function IdentityCard({ username, account, skin, gameRunning, onRename }: Props) {
  const named = !usernameProblem(username)
  const [renaming, setRenaming] = useState(!named)

  return (
    <section className="card">
      {renaming ? (
        <NameEditor
          current={username}
          account={account}
          onCancel={named ? () => setRenaming(false) : undefined}
          onSave={async name => { await onRename(name); setRenaming(false) }}
        />
      ) : (
        <div className="profile-who">
          <div className="avatar"><PlayerHead name={username} size={52} skin={skin?.image} /></div>
          <div className="profile-who-text">
            <div className="profile-name">{username}</div>
            <div className="card-desc">Offline account · protected by SimpleLogin</div>
          </div>
          <button
            className="btn ghost sm"
            onClick={() => setRenaming(true)}
            disabled={gameRunning}
            title={gameRunning ? 'Close Minecraft to change your name' : undefined}
          >
            <PencilIcon size={14} /> Change name
          </button>
        </div>
      )}

      {named && <PasswordSection username={username} account={account} />}
    </section>
  )
}

// ── Name ─────────────────────────────────────────────────────

type Availability =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'error' }
  | { state: 'done'; result: ServerAccount }

function NameEditor({ current, account, onCancel, onSave }: {
  current: string
  account: AccountApi
  onCancel?: () => void
  onSave: (name: string) => Promise<void>
}) {
  const [name, setName] = useState(current)
  const [availability, setAvailability] = useState<Availability>({ state: 'idle' })
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.select() }, [])

  const problem = usernameProblem(name)
  const unchanged = name === current
  const caseOnly = !unchanged && name.toLowerCase() === current.toLowerCase()

  // Ask the server whether the name is free, already ours, or someone else's
  useEffect(() => {
    if (problem || unchanged) { setAvailability({ state: 'idle' }); return }
    setAvailability({ state: 'checking' })
    let live = true
    const t = window.setTimeout(() => {
      invoke<ServerAccount>('check_server_account', { username: name })
        .then(result => { if (live) setAvailability({ state: 'done', result }) })
        .catch(() => { if (live) setAvailability({ state: 'error' }) })
    }, 450)
    return () => { live = false; window.clearTimeout(t) }
  }, [name, problem, unchanged])

  const taken = availability.state === 'done' && availability.result.registered && !availability.result.valid
  const canSave = !problem && !unchanged && !saving

  const save = async () => {
    if (!canSave) return
    setSaving(true)
    try { await onSave(name) } finally { setSaving(false) }
  }

  let status: ReactNode = null
  if (problem && name) {
    status = <Line tone="warn" icon={<AlertIcon size={14} />}>{problem}.</Line>
  } else if (availability.state === 'checking') {
    status = <Line tone="info" icon={<Spinner size={12} />}>Checking the name…</Line>
  } else if (availability.state === 'error') {
    status = <Line tone="warn" icon={<AlertIcon size={14} />}>Couldn't check this name with the server.</Line>
  } else if (availability.state === 'done') {
    const { registered, valid } = availability.result
    status = registered && valid
      ? <Line tone="ok" icon={<CheckIcon size={14} />}>This name is already yours. Your saved password matches it.</Line>
      : registered
        ? <Line tone="danger" icon={<XCircleIcon size={14} />}>Someone already registered <b>{name}</b> with a different password. You won't be able to join with it.</Line>
        : <Line tone="ok" icon={<CheckIcon size={14} />}><b>{name}</b> is free. It becomes yours the first time you join with it.</Line>
  }

  return (
    <div className="name-editor">
      <div className="card-head account-head">
        <div className="card-icon violet"><UserIcon size={18} /></div>
        <div>
          <h2 className="card-title">{current ? 'Change your name' : 'Pick your name'}</h2>
          <p className="card-desc">Your in-game name on BSCraft, 3–16 letters, numbers or _.</p>
        </div>
      </div>
      <form className="name-row" onSubmit={e => { e.preventDefault(); save() }}>
        <div className="pw-field name-field">
          <span className="pw-icon"><UserIcon size={15} /></span>
          <input
            ref={inputRef}
            value={name}
            onChange={e => setName(sanitizeUsername(e.target.value))}
            placeholder="Username"
            maxLength={16}
            spellCheck={false}
            autoComplete="off"
            aria-label="Username"
          />
        </div>
        {onCancel && <button type="button" className="btn ghost sm" onClick={onCancel} disabled={saving}>Cancel</button>}
        <button type="submit" className={`btn sm ${taken ? '' : 'brand'}`} disabled={!canSave}>
          {saving && <Spinner size={12} />} {taken ? 'Use anyway' : 'Save name'}
        </button>
      </form>
      {status}
      {current && !unchanged && !problem && (
        <p className="name-note">
          {caseOnly
            ? 'Only the capitals change. Save your skin again afterwards so the new spelling picks it up.'
            : <>Your password stays the same on this PC. Skins, capes and in-game progress belong to each name, so <b>{current}</b>'s stay with {current}.</>}
        </p>
      )}
      {account.passwordSet === false && !current && (
        <p className="name-note">Next you'll set a password that protects this name on the server.</p>
      )}
    </div>
  )
}

function Line({ tone, icon, children }: { tone: string; icon: ReactNode; children: ReactNode }) {
  return <div className={`status-line ${tone}`}>{icon}<span>{children}</span></div>
}

// ── Password ─────────────────────────────────────────────────

function PasswordSection({ username, account }: { username: string; account: AccountApi }) {
  const { passwordSet, server, serverError, checking } = account
  const [editing, setEditing] = useState(false)
  const [revealed, setRevealed] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => { setRevealed(null); setEditing(false) }, [username])

  const reveal = async () => {
    if (revealed) { setRevealed(null); return }
    setRevealed(await account.revealPassword())
  }
  const copy = async () => {
    const p = revealed ?? await account.revealPassword()
    if (p && await copyText(p)) {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    }
  }
  const save = async (password: string) => {
    await account.savePassword(password)
    setEditing(false)
    setRevealed(null)
  }

  // Changing the local copy of a working password would lock the player out
  const locked = !!server?.registered && server.valid

  return (
    <div className="password-section">
      <div className="card-head account-head">
        <div className="card-icon violet"><KeyIcon size={18} /></div>
        <div>
          <h2 className="card-title">Server password</h2>
          <p className="card-desc">The launcher enters it for you whenever you join BSCraft.</p>
        </div>
      </div>

      {passwordSet === null ? (
        <div className="status-line"><Spinner size={12} /> Loading…</div>
      ) : !passwordSet || editing ? (
        <>
          <p className="account-copy">
            {editing
              ? 'Enter the password to use on this PC. It has to match the one the server has for your name.'
              : 'Your name is claimed with this password the first time you join the server, so nobody else can use it.'}
          </p>
          <PasswordForm
            confirm={!server?.registered}
            submitLabel={server?.registered ? 'Save password' : 'Set password'}
            onSubmit={save}
            onCancel={editing ? () => setEditing(false) : undefined}
            autoFocus={editing}
          />
        </>
      ) : (
        <>
          <div className="pw-saved">
            <span className="pw-dots">{revealed ?? '••••••••••'}</span>
            <button className="btn ghost sm" onClick={reveal} title={revealed ? 'Hide' : 'Show'}>
              {revealed ? <EyeOffIcon size={14} /> : <EyeIcon size={14} />}
            </button>
            <button className="btn ghost sm" onClick={copy} title="Copy">
              {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
            </button>
            {!locked && <button className="btn sm" onClick={() => setEditing(true)}>Change</button>}
          </div>

          <ServerStatus
            username={username}
            registered={server?.registered}
            valid={server?.valid}
            checking={checking}
            error={serverError}
            onRetry={account.checkServer}
          />

          {locked && (
            <div className="hint info card-note">
              <InfoIcon size={14} />
              <span>To change it, type <code>/simplelogin change_password &lt;new&gt;</code> in game. The launcher picks up the new one automatically.</span>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function ServerStatus({ username, registered, valid, checking, error, onRetry }: {
  username: string; registered?: boolean; valid?: boolean; checking: boolean; error: string | null; onRetry: () => void
}) {
  let tone = 'info'
  let icon: ReactNode = <InfoIcon size={14} />
  let text: ReactNode = 'Not registered yet. Join the server once and this password claims your name. Just joined? The server saves new names every few minutes.'
  if (checking) {
    icon = <Spinner size={12} />
    text = 'Checking with the server…'
  } else if (error) {
    tone = 'warn'; icon = <AlertIcon size={14} />
    text = "Couldn't reach the BSCraft server to check your account."
  } else if (registered && valid) {
    tone = 'ok'; icon = <CheckIcon size={14} />
    text = <>Registered. This password matches the server's for <b>{username}</b>.</>
  } else if (registered) {
    tone = 'danger'; icon = <XCircleIcon size={14} />
    text = <>This password doesn't match the server's for <b>{username}</b>. Enter the one you used before, or ask an admin to reset your name.</>
  }
  return (
    <div className={`status-line ${tone}`}>
      {icon}
      <span>{text}</span>
      {!checking && (error || registered === undefined) && (
        <button className="link-btn" onClick={onRetry}><RefreshIcon size={12} /> Retry</button>
      )}
    </div>
  )
}
