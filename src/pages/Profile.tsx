import { useEffect, useRef, useState, type ReactNode } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { PlayerHead } from '../components/PlayerHead'
import { SkinView } from '../components/SkinView'
import { PasswordForm } from '../components/PasswordForm'
import { Segmented, Spinner } from '../components/ui'
import {
  AlertIcon, CheckIcon, CopyIcon, EyeIcon, EyeOffIcon, ImageIcon, InfoIcon,
  KeyIcon, RefreshIcon, UploadIcon, UserIcon, XCircleIcon,
} from '../components/Icons'
import { copyText } from '../lib/clipboard'
import { usernameProblem } from '../lib/format'
import { readSkinFile, type Skin, type SkinModel } from '../lib/skin'
import { invalidateSkin, usePublishedSkin } from '../hooks/useSkin'
import type { AccountApi } from '../hooks/useAccount'
import type { SkinUploadResult } from '../types'

interface Props {
  username: string
  account: AccountApi
}

export function ProfilePage({ username, account }: Props) {
  const nameProblem = usernameProblem(username)

  // The password can change in game (/simplelogin change_password), so re-read on every visit
  useEffect(() => {
    account.refreshLocal().then(() => account.checkServer()).catch(() => {})
  }, [])

  return (
    <div className="page settings profile page-enter">
      <header className="page-header">
        <h1>Profile</h1>
        <p>Your server password and the skin everyone sees in game.</p>
      </header>

      {nameProblem ? (
        <section className="card profile-empty">
          <UserIcon size={22} />
          <div>
            <div className="card-title">Pick a username first</div>
            <p className="card-desc">Enter your name on the Play screen, then come back to set a password and skin.</p>
          </div>
        </section>
      ) : (
        <div className="settings-grid">
          <div className="settings-col">
            <AccountCard username={username} account={account} />
          </div>
          <div className="settings-col">
            <SkinCard username={username} account={account} />
          </div>
        </div>
      )}
    </div>
  )
}

// ── Account ──────────────────────────────────────────────────

function AccountCard({ username, account }: Props) {
  const { skin } = usePublishedSkin(username)
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
    <section className="card">
      <div className="profile-who">
        <div className="avatar"><PlayerHead name={username} size={52} skin={skin?.image} /></div>
        <div>
          <div className="profile-name">{username}</div>
          <div className="card-desc">Offline account · protected by SimpleLogin</div>
        </div>
      </div>

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
    </section>
  )
}

function ServerStatus({ username, registered, valid, checking, error, onRetry }: {
  username: string; registered?: boolean; valid?: boolean; checking: boolean; error: string | null; onRetry: () => void
}) {
  let tone = 'info'
  let icon: ReactNode = <InfoIcon size={14} />
  let text: ReactNode = 'Not registered yet. Join the server once and this password claims your name.'
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

// ── Skin ─────────────────────────────────────────────────────

function SkinCard({ username, account }: Props) {
  const { skin: published, loading } = usePublishedSkin(username)
  const [draft, setDraft] = useState<{ bytes: Uint8Array; skin: Skin } | null>(null)
  const [model, setModel] = useState<SkinModel>('default')
  const [busy, setBusy] = useState<'save' | 'reset' | null>(null)
  const [notice, setNotice] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const shown = draft?.skin ?? published
  useEffect(() => { if (!draft) setModel(published?.model ?? 'default') }, [published, draft])
  useEffect(() => () => { if (draft) URL.revokeObjectURL(draft.skin.src) }, [draft])
  useEffect(() => { setDraft(null); setNotice(null) }, [username])

  const { passwordSet, server } = account
  const blocker =
    !passwordSet ? 'Set your server password first.'
    : !server ? null
    : !server.registered ? 'Join the server once to claim your name, then you can upload a skin.'
    : !server.valid ? "Your saved password doesn't match the server's."
    : null
  const canSave = !!draft && !blocker && !!server?.valid
  const legacy = shown?.image.naturalHeight === 32

  const pick = async (file: File | undefined) => {
    if (!file) return
    setNotice(null)
    try {
      const next = await readSkinFile(file)
      setDraft(next)
      setModel(next.skin.model)
    } catch (e) {
      setNotice({ tone: 'danger', text: e instanceof Error ? e.message : String(e) })
    }
  }

  const save = async () => {
    if (!draft) return
    setBusy('save')
    setNotice(null)
    try {
      await invoke<SkinUploadResult>('upload_skin', { username, model, png: Array.from(draft.bytes) })
      await invalidateSkin(username)
      setDraft(null)
      setNotice({ tone: 'ok', text: 'Skin saved! Other players see it within about a minute.' })
    } catch (e) {
      setNotice({ tone: 'danger', text: String(e) })
    } finally {
      setBusy(null)
    }
  }

  const reset = async () => {
    setBusy('reset')
    setNotice(null)
    try {
      await invoke('reset_skin', { username })
      await invalidateSkin(username)
      setDraft(null)
      setNotice({ tone: 'ok', text: 'Skin reset to the default.' })
    } catch (e) {
      setNotice({ tone: 'danger', text: String(e) })
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="card skin-card">
      <div className="card-head">
        <div className="card-icon pink"><ImageIcon size={18} /></div>
        <div>
          <h2 className="card-title">Skin</h2>
          <p className="card-desc">{draft ? 'Preview — not saved yet' : published ? 'Your current skin' : 'Using the default skin'}</p>
        </div>
      </div>

      <div className={`skin-stage${draft ? ' draft' : ''}`}>
        {loading && !shown ? (
          <div className="skin-empty"><Spinner size={16} /></div>
        ) : shown ? (
          <>
            <figure><SkinView image={shown.image} model={model} view="front" /><figcaption>Front</figcaption></figure>
            <figure><SkinView image={shown.image} model={model} view="back" /><figcaption>Back</figcaption></figure>
          </>
        ) : (
          <div className="skin-empty">
            <UserIcon size={28} />
            <span>No custom skin yet</span>
          </div>
        )}
      </div>

      <div className="skin-controls">
        <Segmented<SkinModel>
          size="sm"
          label="Arm style"
          value={model}
          onChange={setModel}
          disabled={!draft || legacy}
          options={[
            { value: 'default', label: 'Classic arms', title: 'Steve-style 4px arms' },
            { value: 'slim', label: 'Slim arms', title: 'Alex-style 3px arms (64×64 skins only)' },
          ]}
        />
        <input
          ref={fileRef}
          type="file"
          accept="image/png"
          hidden
          onChange={e => { pick(e.target.files?.[0]); e.target.value = '' }}
        />
        <button className="btn sm" onClick={() => fileRef.current?.click()} disabled={!!busy}>
          <UploadIcon size={14} /> Choose PNG…
        </button>
      </div>

      {blocker && draft && <div className="hint warn card-note"><AlertIcon size={14} /> {blocker}</div>}
      {notice && (
        <div className={`status-line ${notice.tone}`}>
          {notice.tone === 'ok' ? <CheckIcon size={14} /> : <XCircleIcon size={14} />}
          <span>{notice.text}</span>
        </div>
      )}

      <div className="skin-actions">
        {published && !draft && (
          <button className="btn ghost sm danger-text" onClick={reset} disabled={!!busy || !!blocker}>
            {busy === 'reset' && <Spinner size={12} />} Reset to default
          </button>
        )}
        {draft && (
          <button className="btn ghost sm" onClick={() => { setDraft(null); setNotice(null) }} disabled={!!busy}>Discard</button>
        )}
        <button className="btn brand sm" onClick={save} disabled={!canSave || !!busy}>
          {busy === 'save' && <Spinner size={12} />} Save skin
        </button>
      </div>
    </section>
  )
}
