import { useEffect, useRef, useState } from 'react'
import { Spinner } from '../components/ui'
import { AlertIcon, CheckIcon, XCircleIcon } from '../components/Icons'
import { usernameProblem } from '../lib/format'
import type { TextureKind } from '../lib/skin'
import type { AccountApi } from '../hooks/useAccount'
import { IdentityCard } from './profile/IdentityCard'
import { WardrobeCard } from './profile/WardrobeCard'
import { SkinPartsCard } from './profile/SkinPartsCard'
import { ViewerPanel, type ViewerOptions } from './profile/ViewerPanel'
import { useWardrobe } from './profile/useWardrobe'
import { useSkinPrefs } from './profile/useSkinPrefs'

interface Props {
  username: string
  account: AccountApi
  gameRunning: boolean
  onRename: (name: string) => Promise<void>
}

// Viewer settings are a per-PC convenience, so they live in the webview
const VIEWER_KEY = 'bscraft.viewer'

function loadViewerOptions(): ViewerOptions {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const defaults: ViewerOptions = { animation: reduced ? 'still' : 'idle', back: 'cape', outerLayer: true, nameTag: true, autoRotate: false }
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(VIEWER_KEY) ?? '{}') }
  } catch {
    return defaults
  }
}

export function ProfilePage({ username, account, gameRunning, onRename }: Props) {
  const named = !usernameProblem(username)
  const wardrobe = useWardrobe(named ? username : '')
  const skinPrefs = useSkinPrefs()
  const [tab, setTab] = useState<TextureKind>('skin')
  const [viewer, setViewer] = useState<ViewerOptions>(loadViewerOptions)
  const [saveNotice, setSaveNotice] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null)

  // The password can change in game (/simplelogin change_password), so re-read on every visit
  useEffect(() => {
    account.refreshLocal().then(() => account.checkServer()).catch(() => {})
  }, [])

  useEffect(() => { setSaveNotice(null) }, [username])
  useEffect(() => {
    if (saveNotice?.tone !== 'ok') return
    const t = window.setTimeout(() => setSaveNotice(null), 8000)
    return () => window.clearTimeout(t)
  }, [saveNotice])

  // Starting a new round of changes clears the last save's message
  const changeCount = wardrobe.changes.length
  const prevCount = useRef(changeCount)
  useEffect(() => {
    if (prevCount.current === 0 && changeCount > 0) setSaveNotice(null)
    prevCount.current = changeCount
  }, [changeCount])

  const changeViewer = (patch: Partial<ViewerOptions>) => {
    setViewer(v => {
      const next = { ...v, ...patch }
      try { localStorage.setItem(VIEWER_KEY, JSON.stringify(next)) } catch { /* storage unavailable */ }
      return next
    })
  }

  // Looking at the cape or elytra tab puts that on the preview's back
  const changeTab = (t: TextureKind) => {
    setTab(t)
    if (t !== 'skin') changeViewer({ back: t })
  }

  const { passwordSet, server, serverError } = account
  const blocker =
    !passwordSet ? 'Set your server password first.'
    : serverError ? "Couldn't reach the BSCraft server."
    : !server ? null
    : !server.registered ? 'Join the server once to claim your name, then you can save your look. New names show up here within about 5 minutes.'
    : !server.valid ? "Your saved password doesn't match the server's."
    : null
  const canSave = !blocker && !!server?.valid && !wardrobe.saving

  const save = async () => {
    setSaveNotice(null)
    try {
      await wardrobe.save()
      setSaveNotice({ tone: 'ok', text: 'Saved! It shows in game the next time you join the server.' })
    } catch (e) {
      setSaveNotice({ tone: 'danger', text: e instanceof Error ? e.message : String(e) })
    }
  }

  return (
    <div className="page profile page-enter">
      <header className="page-header">
        <h1>Profile</h1>
        <p>Your name, password and how you look on BSCraft.</p>
      </header>

      <div className="profile-layout">
        <ViewerPanel
          username={named ? username : ''}
          wardrobe={wardrobe}
          prefs={skinPrefs.prefs}
          options={viewer}
          onOptions={changeViewer}
        />

        <div className="profile-side">
          <IdentityCard
            username={username}
            account={account}
            skin={wardrobe.published.skin}
            gameRunning={gameRunning}
            onRename={onRename}
          />
          {named && <WardrobeCard wardrobe={wardrobe} tab={tab} onTab={changeTab} />}
          <SkinPartsCard
            prefs={skinPrefs.prefs}
            loaded={skinPrefs.loaded}
            error={skinPrefs.error}
            gameRunning={gameRunning}
            onChange={skinPrefs.update}
          />

          {(wardrobe.changes.length > 0 || saveNotice) && (
            <div className={`save-bar${wardrobe.changes.length ? '' : ' done'}`}>
              {wardrobe.changes.length > 0 ? (
                <>
                  <div className="save-bar-text">
                    <b>Unsaved: {wardrobe.changes.join(', ')}</b>
                    {blocker
                      ? <span className="warn"><AlertIcon size={12} /> {blocker}</span>
                      : saveNotice?.tone === 'danger' && <span className="danger"><XCircleIcon size={12} /> {saveNotice.text}</span>}
                  </div>
                  <button className="btn ghost sm" onClick={wardrobe.discard} disabled={wardrobe.saving}>Discard</button>
                  <button className="btn brand sm" onClick={save} disabled={!canSave}>
                    {wardrobe.saving && <Spinner size={12} />} Save changes
                  </button>
                </>
              ) : saveNotice && (
                <div className={`save-bar-text ${saveNotice.tone}`}>
                  <span>{saveNotice.tone === 'ok' ? <CheckIcon size={13} /> : <XCircleIcon size={13} />} {saveNotice.text}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
