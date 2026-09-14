import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { invoke } from '@tauri-apps/api/core'
import { Spinner, Toggle } from '../../components/ui'
import { AlertIcon, CheckIcon, ExternalIcon, EraserIcon, TrashIcon, XCircleIcon } from '../../components/Icons'
import { formatBytes } from '../../lib/format'
import type { StorageUsage, UninstallResult } from '../../types'

const GROUPS: Record<StorageUsage['groups'][number]['key'], { label: string; desc: string }> = {
  game: { label: 'Minecraft & Forge', desc: 'The game, its libraries and sounds' },
  java: { label: 'Java', desc: 'What Minecraft runs on' },
  modpack: { label: 'Modpack', desc: 'Mods, their settings, shaders and resource packs' },
  worlds: { label: 'Your worlds & screenshots', desc: 'Singleplayer worlds, screenshots, schematics, map waypoints' },
  caches: { label: 'Caches & logs', desc: 'Logs, crash reports, downloaded skins, far-terrain cache. Rebuilt as you play' },
}

interface Props {
  head: ReactNode
  /** Minecraft is running: its files are in use */
  gameRunning: boolean
}

/** What BSCraft keeps on this PC, clearing the caches, and uninstalling it all */
export function StorageCard({ head, gameRunning }: Props) {
  const [usage, setUsage] = useState<StorageUsage | null>(null)
  const [clearing, setClearing] = useState(false)
  const [message, setMessage] = useState<{ tone: 'done' | 'error'; text: string } | null>(null)
  const [uninstalling, setUninstalling] = useState(false)

  const refresh = useCallback(() => {
    invoke<StorageUsage>('storage_usage').then(setUsage).catch(() => {})
  }, [])
  useEffect(() => { refresh() }, [refresh, gameRunning])

  const caches = usage?.groups.find(g => g.key === 'caches')?.bytes ?? 0
  const worlds = usage?.groups.find(g => g.key === 'worlds')?.bytes ?? 0

  const clear = async () => {
    setClearing(true)
    setMessage(null)
    try {
      const freed = await invoke<number>('clear_caches')
      setMessage({ tone: 'done', text: `Freed ${formatBytes(freed)}.` })
    } catch (e) {
      setMessage({ tone: 'error', text: String(e) })
    } finally {
      setClearing(false)
      refresh()
    }
  }

  return (
    <section className="card storage-card">
      {head}

      <div className="storage-total">
        <span className="storage-size">{usage ? formatBytes(usage.total) : <Spinner size={14} />}</span>
        <span className="storage-where" title={usage?.path}>in {usage ? shortPath(usage.path) : '…'}</span>
      </div>

      {usage && usage.total > 0 && (
        <div className="storage-bar" aria-hidden>
          {usage.groups.filter(g => g.bytes > 0).map(g => (
            <span key={g.key} className={`seg ${g.key}`} style={{ flexGrow: g.bytes }} />
          ))}
        </div>
      )}

      <ul className="storage-list">
        {(usage?.groups ?? []).map(g => (
          <li key={g.key}>
            <span className={`dot ${g.key}`} />
            <span className="storage-text">
              <span className="storage-label">{GROUPS[g.key].label}</span>
              <span className="storage-desc">{GROUPS[g.key].desc}</span>
            </span>
            <span className="storage-bytes">{formatBytes(g.bytes)}</span>
          </li>
        ))}
      </ul>

      <div className="storage-actions">
        <button className="btn ghost sm" onClick={() => invoke('open_data_folder').catch(() => {})}>
          <ExternalIcon size={14} /> Open folder
        </button>
        <button
          className="btn ghost sm"
          onClick={clear}
          disabled={clearing || gameRunning || caches === 0}
          title={gameRunning ? 'Close Minecraft first' : 'Logs, crash reports, downloaded skins and the far-terrain cache'}
        >
          {clearing ? <Spinner size={12} /> : <EraserIcon size={14} />} Clear caches{caches > 0 ? ` · ${formatBytes(caches)}` : ''}
        </button>
        <span className="spacer" />
        <button className="btn ghost sm danger-text" onClick={() => setUninstalling(true)} disabled={gameRunning} title={gameRunning ? 'Close Minecraft first' : undefined}>
          <TrashIcon size={14} /> Uninstall…
        </button>
      </div>

      {message && (
        <div className={`action-result ${message.tone}`}>
          {message.tone === 'done' ? <CheckIcon size={14} /> : <XCircleIcon size={14} />}
          <span>{message.text}</span>
        </div>
      )}

      {/* Out on the page itself: the card's frosted glass would otherwise hold the overlay inside it */}
      {uninstalling && usage && createPortal(
        <UninstallModal total={usage.total} worlds={worlds} onClose={() => setUninstalling(false)} />,
        document.body,
      )}
    </section>
  )
}

function shortPath(p: string): string {
  return p.replace(/^.*[\\/]AppData[\\/]Roaming[\\/]/i, '%APPDATA%\\')
}

function UninstallModal({ total, worlds, onClose }: { total: number; worlds: number; onClose: () => void }) {
  const [keep, setKeep] = useState(true)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<UninstallResult | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy && !done) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, busy, done])

  const run = async () => {
    if (!confirm) { setConfirm(true); return }
    setBusy(true)
    setError(null)
    try {
      setDone(await invoke<UninstallResult>('uninstall_bscraft', { keepWorlds: keep && worlds > 0 }))
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  const removed = formatBytes(Math.max(0, total - (keep ? worlds : 0)))

  return (
    <div className="modal-overlay" onClick={() => { if (!busy && !done) onClose() }}>
      <div className="modal narrow" role="alertdialog" aria-modal="true" aria-labelledby="uninstall-title" onClick={e => e.stopPropagation()}>
        {done ? (
          <div className="modal-head">
            <div className="modal-icon brand"><CheckIcon size={20} /></div>
            <div>
              <h2 id="uninstall-title" className="modal-title">BSCraft is removed from this PC</h2>
              <p className="modal-sub">
                {done.kept_in && <>Your worlds and screenshots are in <b>{done.kept_in}</b>. </>}
                {done.uninstaller_started
                  ? 'Finish in the Windows uninstaller that just opened; the launcher closes now.'
                  : 'Remove the launcher itself from Windows Settings › Apps.'}
              </p>
            </div>
          </div>
        ) : (
          <>
            <div className="modal-head">
              <div className="modal-icon danger"><AlertIcon size={20} /></div>
              <div>
                <h2 id="uninstall-title" className="modal-title">Uninstall BSCraft?</h2>
                <p className="modal-sub">
                  Removes the launcher and everything it downloaded: Java, Minecraft, Forge, the modpack and your
                  settings (<b>{removed}</b>). Your name on the server and your skin stay, so you can come back any time.
                </p>
              </div>
            </div>
            {worlds > 0 && (
              <div className="uninstall-keep">
                <div>
                  <div className="setting-title">Keep my worlds and screenshots</div>
                  <div className="setting-desc">{formatBytes(worlds)}, moved to Documents\BSCraft worlds</div>
                </div>
                <Toggle id="toggle-keep-worlds" label="Keep my worlds and screenshots" checked={keep} onChange={setKeep} />
              </div>
            )}
            {error && <div className="pw-error">{error}</div>}
            <div className="modal-foot">
              <button className="btn ghost" onClick={onClose} disabled={busy} autoFocus>Cancel</button>
              <button className="btn danger" onClick={run} disabled={busy}>
                {busy ? <><Spinner size={12} /> Removing…</> : confirm ? 'Click to confirm' : 'Uninstall'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
