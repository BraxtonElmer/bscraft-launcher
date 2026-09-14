import { useEffect, useRef, useState } from 'react'
import { PixelText } from '../components/PixelText'
import { PlayerHead } from '../components/PlayerHead'
import { PasswordForm } from '../components/PasswordForm'
import { ProgressBar, Segmented, Spinner, describeOperation, totalPercent } from '../components/ui'
import {
  AlertIcon, CheckIcon, ChestIcon, ChevronUpIcon, DiamondIcon, DownloadIcon, GaugeIcon, HomeIcon, KeyIcon, MemoryIcon,
  RefreshIcon, ServerIcon, StopIcon, TerminalIcon,
} from '../components/Icons'
import { formatBytes, formatRam, sanitizeUsername, usernameProblem } from '../lib/format'
import { usePublishedSkin } from '../hooks/useSkin'
import type { AccountApi } from '../hooks/useAccount'
import type { LauncherApi } from '../hooks/useLauncher'
import type { ActiveOperation, AppConfig, Page } from '../types'

interface Props {
  launcher: LauncherApi
  config: AppConfig
  operation: ActiveOperation | null
  startedAt: number | null
  onNavigate: (page: Page) => void
  onStopGame: () => void
  account: AccountApi
  /** Saves where the game starts: the BSCraft server (true) or the main menu */
  onStartIn: (autoJoin: boolean) => void
}

// Asked once per session; skipping leaves it to SimpleLogin's in-game prompt
let passwordPromptSkipped = false
// "Play anyway" past a password the server says is wrong (it can lag a few minutes behind
// a password changed in game), once per session
let wrongPasswordSkipped = false

export function HomePage({ launcher, config, operation, startedAt, onNavigate, onStopGame, account, onStartIn }: Props) {
  const { status, manifest, launcherUpdate, modpackUpdate, running } = launcher
  const [askPassword, setAskPassword] = useState<'new' | 'wrong' | null>(null)
  const checking = useRef(false)

  const mcVersion = config.installed_mc_version ?? manifest?.minecraft_version

  const play = async () => {
    const readyToLaunch = !launcherUpdate && status !== 'offline' && status !== 'error' && !usernameProblem(launcher.username.trim())
    if (readyToLaunch && account.passwordSet === false && !passwordPromptSkipped) {
      setAskPassword('new')
      return
    }
    if (readyToLaunch && account.passwordSet && !wrongPasswordSkipped) {
      // Joining with the wrong password gets you kicked, after the whole game has loaded
      if (checking.current) return
      checking.current = true
      const server = await account.checkServer().finally(() => { checking.current = false })
      if (server?.registered && !server.valid) {
        setAskPassword('wrong')
        return
      }
    }
    launcher.play()
  }
  const continueToPlay = () => {
    setAskPassword(null)
    launcher.play()
  }

  return (
    <div className="home page-enter">
      <div className="home-scrim" />

      {/* The BSCRAFT title itself is drawn into the landscape by PixelScene */}
      <h1 className="sr-only">BSCraft</h1>

      <section className="hero">

        {status === 'offline' && !operation && (
          <div className="callout danger">
            <div className="callout-icon"><AlertIcon size={18} /></div>
            <div className="callout-text">
              <strong>Can't reach the BSCraft server</strong>
              <span>The modpack has to be downloaded once before you can play. Check your connection and retry.</span>
            </div>
            <button className="btn sm" onClick={launcher.retry}>
              <RefreshIcon size={14} /> Retry
            </button>
          </div>
        )}

        {launcherUpdate && !operation && (
          <div className="callout">
            <div className="callout-icon pixel"><ChestIcon size={24} /></div>
            <div className="callout-text">
              <strong>Launcher v{launcherUpdate.latest_version} is ready</strong>
              <span className="callout-notes">
                {launcherUpdate.notes?.trim()
                  || `You have v${launcherUpdate.current_version}. Press Update: it downloads, installs and restarts the launcher.`}
              </span>
            </div>
          </div>
        )}

        {modpackUpdate && !operation && !launcherUpdate && (
          <div className="callout">
            <div className="callout-icon"><DownloadIcon size={18} /></div>
            <div className="callout-text">
              <strong>
                {config.installed_modpack_version === modpackUpdate.modpack_version
                  ? 'Update needed'
                  : `Modpack v${modpackUpdate.modpack_version} is available`}
              </strong>
              <span>
                {launcher.setupNeeds.length > 0
                  ? `The modpack now runs on ${launcher.setupNeeds.join(', ')}. Update, or press Play, to install it.`
                  : config.installed_modpack_version
                  ? `You have v${config.installed_modpack_version}. Update to stay compatible with the server.`
                  : 'Modpack files are missing. Sync them before playing.'}
              </span>
            </div>
            <button
              id="btn-update-modpack"
              className="btn brand sm"
              onClick={launcher.updateModpackNow}
              disabled={launcher.busy || running}
            >
              Update
            </button>
          </div>
        )}
      </section>

      <div className={`dock${operation ? ' working' : running ? ' in-game' : ''}`}>
        {operation ? (
          <DockProgress op={operation} />
        ) : running ? (
          <DockRunning
            username={config.username}
            startedAt={startedAt}
            onConsole={() => onNavigate('console')}
            onStop={onStopGame}
          />
        ) : (
          <DockControls launcher={launcher} config={config} onNavigate={onNavigate} onPlay={play} />
        )}
        <PlayButton
          launcher={launcher}
          operation={operation}
          mcVersion={mcVersion}
          autoJoin={config.auto_join}
          onPlay={play}
          onStartIn={onStartIn}
        />
      </div>

      <div className="credit">Made by Akariyu and Zukashi</div>

      {askPassword === 'new' && (
        <PasswordPrompt
          username={launcher.username.trim()}
          onSave={async p => { await account.savePassword(p); continueToPlay() }}
          onSkip={() => { passwordPromptSkipped = true; continueToPlay() }}
          onClose={() => setAskPassword(null)}
        />
      )}
      {askPassword === 'wrong' && (
        <WrongPasswordPrompt
          username={launcher.username.trim()}
          onSave={async p => {
            const server = await account.savePassword(p)
            if (server && !server.valid) throw new Error("That's not the one the server has either.")
            continueToPlay()
          }}
          onSkip={() => { wrongPasswordSkipped = true; continueToPlay() }}
          onClose={() => setAskPassword(null)}
        />
      )}
    </div>
  )
}

function PasswordPrompt({ username, onSave, onSkip, onClose }: {
  username: string; onSave: (p: string) => Promise<void>; onSkip: () => void; onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal narrow" role="dialog" aria-modal="true" aria-labelledby="pw-prompt-title" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-icon brand"><KeyIcon size={20} /></div>
          <div>
            <h2 id="pw-prompt-title" className="modal-title">Protect your name</h2>
            <p className="modal-sub">
              BSCraft locks <b>{username}</b> to a password the first time you join. Set it here and the launcher
              enters it for you every time. If you already use a password for this name, enter that one.
            </p>
          </div>
        </div>
        <PasswordForm
          confirm
          autoFocus
          submitLabel="Save and play"
          onSubmit={onSave}
          onCancel={onSkip}
          cancelLabel="Skip, set it in game"
        />
      </div>
    </div>
  )
}

function WrongPasswordPrompt({ username, onSave, onSkip, onClose }: {
  username: string; onSave: (p: string) => Promise<void>; onSkip: () => void; onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal narrow" role="dialog" aria-modal="true" aria-labelledby="pw-wrong-title" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-icon danger"><KeyIcon size={20} /></div>
          <div>
            <h2 id="pw-wrong-title" className="modal-title">That password won't get you in</h2>
            <p className="modal-sub">
              BSCraft has a different password for <b>{username}</b> than the one saved on this PC, so the server
              would turn you away once the game has loaded. Enter the password you used before (on the PC you
              first played on, it's under Profile › Server password), or ask an admin to reset your name.
            </p>
          </div>
        </div>
        <PasswordForm
          autoFocus
          submitLabel="Save and play"
          onSubmit={onSave}
          onCancel={onSkip}
          cancelLabel="Play anyway"
        />
      </div>
    </div>
  )
}

// ── Dock: idle controls ──────────────────────────────────────

function DockControls({ launcher, config, onNavigate, onPlay }: {
  launcher: LauncherApi; config: AppConfig; onNavigate: (p: Page) => void; onPlay: () => void
}) {
  const { username, setUsername, usernameNudge, busy, perfBusy } = launcher
  const { skin } = usePublishedSkin(username)
  const inputRef = useRef<HTMLInputElement>(null)
  const [shake, setShake] = useState(false)

  useEffect(() => {
    if (!usernameNudge) return
    inputRef.current?.focus()
    setShake(true)
    const t = window.setTimeout(() => setShake(false), 450)
    return () => window.clearTimeout(t)
  }, [usernameNudge])

  const problem = usernameProblem(username)
  const showProblem = !!problem && (username.length > 0 || usernameNudge > 0)
  // What Performance mode switches off, straight from the modpack's manifest
  const extras = (launcher.manifest?.files ?? []).filter(f => f.performance).map(f => modName(f.path))

  return (
    <>
      <div className={`dock-player${shake ? ' shake' : ''}`}>
        <div className="avatar">
          <PlayerHead name={username} size={48} dim={!username} skin={skin?.image} />
        </div>
        <div className="dock-field">
          <label htmlFor="username-input" className={`overline${showProblem ? ' warn' : ''}`}>
            {showProblem ? problem : 'Player'}
          </label>
          <input
            id="username-input"
            ref={inputRef}
            className="username-input"
            type="text"
            placeholder="Username"
            value={username}
            onChange={e => setUsername(sanitizeUsername(e.target.value))}
            onKeyDown={e => { if (e.key === 'Enter') onPlay() }}
            onBlur={() => { launcher.saveUsername().catch(() => {}) }}
            maxLength={16}
            disabled={busy}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
      </div>

      <div className="dock-sep" />

      <div className="dock-field">
        <span className="overline">
          Mode {perfBusy && <Spinner size={10} />}
        </span>
        <Segmented
          id="perf-mode"
          size="sm"
          label="Graphics mode"
          value={config.performance_mode ? 'performance' : 'quality'}
          onChange={v => launcher.setPerformanceMode(v === 'performance')}
          disabled={busy}
          options={[
            { value: 'quality', label: 'Quality', icon: <DiamondIcon size={14} />, tip: <ModeTip mode="quality" extras={extras} /> },
            { value: 'performance', label: 'Performance', icon: <GaugeIcon size={13} />, tip: <ModeTip mode="performance" extras={extras} /> },
          ]}
        />
      </div>

      <div className="dock-sep" />

      <div className="dock-field">
        <span className="overline">Memory</span>
        <button
          className="dock-link"
          onClick={() => onNavigate('settings')}
          title={config.ram_auto !== false ? 'Automatic: the most that helps on this PC. Change it in Settings' : 'Change memory in Settings'}
        >
          <MemoryIcon size={15} />
          {formatRam(config.ram_mb)}
        </button>
      </div>

      <div className="dock-spacer" />
    </>
  )
}

// ── Graphics mode explained ──────────────────────────────────

/** Friendly names for the mods Performance mode turns off; others are tidied from the file name */
const MOD_NAMES: Record<string, string> = {
  distanthorizons: 'Distant Horizons (far terrain)',
  oculus: 'Oculus (shaders)',
  ryoamiclights: 'Ryoamic Lights (dynamic lights)',
  skinlayers3d: '3D skin layers',
  betteranimationscollection: 'Better Animations',
  notenoughanimations: 'Not Enough Animations',
  mobplaques: 'Mob health plaques',
  ambientsounds: 'Ambient Sounds',
  presencefootsteps: 'Presence Footsteps',
  'soundphysicsremastered': 'Sound Physics',
}

export function modName(path: string): string {
  const file = path.split('/').pop()?.replace(/\.jar$/i, '') ?? path
  // Up to the version: "DistantHorizons-3.0.3-b..." → "DistantHorizons", "Presence Footsteps [FORGE] 1.0.0" → "Presence Footsteps"
  const base = file.split(/[-_ ](?=v?\d|forge|fabric|mc\d|\[)/i)[0]
  const key = base.toLowerCase().replace(/[^a-z0-9]/g, '')
  return MOD_NAMES[key] ?? base.replace(/[-_]/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2')
}

function ModeTip({ mode, extras }: { mode: 'quality' | 'performance'; extras: string[] }) {
  return mode === 'quality' ? (
    <>
      <strong>Quality</strong>
      <span>Everything on, the way BSCraft is meant to look and sound: far terrain, shaders, dynamic lights, 3D skins, smoother animations and richer sound.</span>
      <span className="tip-foot">Best with a graphics card.</span>
    </>
  ) : (
    <>
      <strong>Performance</strong>
      <span>More FPS and less memory. Turns off {extras.length ? `${extras.length} extras` : 'the heaviest extras'}:</span>
      {extras.length > 0 && <span className="tip-list">{extras.join(' · ')}</span>}
      <span className="tip-foot">Nothing else changes, and you can switch back any time.</span>
    </>
  )
}

// ── Dock: progress ───────────────────────────────────────────

function DockProgress({ op }: { op: ActiveOperation }) {
  const { meta, item, percentText } = describeOperation(op)
  return (
    <div className="dock-progress">
      <div className="dp-top">
        <div className="dp-title">
          {op.stepCount > 1 && op.step > 0 && (
            <span className="dp-step">Step {op.step} of {op.stepCount}</span>
          )}
          <span className="dp-name">{op.title}</span>
        </div>
        <div className="dp-meta">{meta.join('  ·  ')}</div>
      </div>
      <ProgressBar
        percent={op.stepPercent}
        indeterminate={op.indeterminate}
        step={op.step}
        stepCount={op.stepCount}
      />
      <div className="dp-bottom">
        <span className="dp-item" title={op.file || op.detail}>{item || 'Working…'}</span>
        {percentText && <span className="dp-percent">{percentText}</span>}
      </div>
    </div>
  )
}

// ── Dock: in game ────────────────────────────────────────────

function useElapsed(startedAt: number | null) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!startedAt) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [startedAt])
  if (!startedAt) return ''
  const s = Math.max(0, Math.floor((now - startedAt) / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`
}

function DockRunning({ username, startedAt, onConsole, onStop }: {
  username: string; startedAt: number | null; onConsole: () => void; onStop: () => void
}) {
  const { skin } = usePublishedSkin(username)
  const elapsed = useElapsed(startedAt)
  const [confirm, setConfirm] = useState(false)

  useEffect(() => {
    if (!confirm) return
    const t = window.setTimeout(() => setConfirm(false), 3000)
    return () => window.clearTimeout(t)
  }, [confirm])

  return (
    <>
      <div className="dock-player">
        <div className="avatar live">
          <PlayerHead name={username} size={48} skin={skin?.image} />
        </div>
        <div className="dock-field">
          <span className="overline live-text"><span className="live-dot" /> In game</span>
          <span className="running-name">{username}</span>
        </div>
      </div>

      <div className="dock-sep" />

      <div className="dock-field">
        <span className="overline">Session</span>
        <span className="running-time">{elapsed || '0:00'}</span>
      </div>

      <div className="dock-spacer" />

      <div className="dock-actions">
        <button className="btn ghost sm" onClick={onConsole}>
          <TerminalIcon size={15} /> Console
        </button>
        <button
          className={`btn sm stop-btn ${confirm ? 'danger' : 'ghost danger-text'}`}
          onClick={() => { if (confirm) { setConfirm(false); onStop() } else setConfirm(true) }}
          title="Force-stop Minecraft (unsaved progress is lost)"
        >
          <StopIcon size={14} /> {confirm ? 'Click to confirm' : 'Stop'}
        </button>
      </div>
    </>
  )
}

// ── Play button ──────────────────────────────────────────────

function PlayButton({ launcher, operation, mcVersion, autoJoin, onPlay, onStartIn }: {
  launcher: LauncherApi; operation: ActiveOperation | null; mcVersion?: string
  autoJoin: boolean; onPlay: () => void; onStartIn: (autoJoin: boolean) => void
}) {
  const { status, installed, launcherUpdate, running, manifest, perfBusy, busy } = launcher

  let label = 'PLAY'
  let sub = mcVersion ? `Minecraft ${mcVersion}` : ''
  let tone = 'go'
  let spinner = false

  if (running) {
    label = 'PLAYING'; sub = 'Have fun!'; tone = 'live'
  } else if (operation) {
    const pct = Math.floor(totalPercent(operation))
    label = operation.indeterminate ? 'WORKING' : `${pct}%`
    sub = operation.kind === 'install' ? 'Installing…' : 'Please wait…'
    tone = 'busy'
  } else if (status === 'init') {
    label = 'LOADING'; sub = ''; tone = 'busy'; spinner = true
  } else if (status === 'launching') {
    label = 'STARTING'; sub = 'Launching Minecraft…'; tone = 'busy'; spinner = true
  } else if (status === 'busy') {
    label = 'WORKING'; sub = 'Please wait…'; tone = 'busy'; spinner = true
  } else if (launcherUpdate) {
    label = 'UPDATE'; sub = `Launcher v${launcherUpdate.latest_version}`; tone = 'warn'
  } else if (status === 'offline' || status === 'error') {
    label = 'RETRY'; sub = status === 'offline' ? 'Server unreachable' : 'Check again'; tone = 'brand'
  } else if (!installed) {
    const size = manifest ? manifest.files.reduce((sum, f) => sum + f.size, 0) : 0
    label = 'INSTALL'; sub = size ? `${formatBytes(size)} modpack` : 'Download & play'
  }

  const disabled = running || busy || perfBusy
  // Where the game starts can be picked whenever Play would launch it
  const canChoose = label === 'PLAY' && !disabled
  if (canChoose) sub = `${mcVersion ? `${mcVersion} · ` : ''}${autoJoin ? 'Joins BSCraft' : 'Main menu'}`

  return (
    <div className={`play-group${canChoose ? ' split' : ''}`}>
      <button id="btn-play" className={`play-btn ${tone}`} onClick={onPlay} disabled={disabled}>
        <span className="play-label">
          {spinner && <Spinner size={16} />}
          <PixelText text={label} scale={3} color="#ffffff" shadow="rgba(0, 0, 0, 0.28)" />
        </span>
        {sub && <span className="play-sub">{sub}</span>}
      </button>
      {canChoose && <StartMenu tone={tone} autoJoin={autoJoin} onChange={onStartIn} />}
    </div>
  )
}

/** The ▾ beside Play: start in the BSCraft server or at Minecraft's main menu */
function StartMenu({ tone, autoJoin, onChange }: { tone: string; autoJoin: boolean; onChange: (autoJoin: boolean) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const pick = (join: boolean) => {
    setOpen(false)
    if (join !== autoJoin) onChange(join)
  }

  const options = [
    { join: true, icon: <ServerIcon size={17} />, title: 'Join BSCraft', desc: 'Connects to the server as soon as the game loads' },
    { join: false, icon: <HomeIcon size={17} />, title: 'Main menu', desc: "Starts at Minecraft's title screen" },
  ]

  return (
    <div className="start-menu-wrap" ref={ref}>
      <button
        type="button"
        className={`play-btn caret ${tone}`}
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Where the game starts"
        title="Where the game starts"
      >
        <ChevronUpIcon size={18} />
      </button>
      {open && (
        <div className="start-menu" role="menu" aria-label="Start the game in">
          <div className="start-menu-title">Start the game in</div>
          {options.map(o => (
            <button
              key={o.title}
              type="button"
              role="menuitemradio"
              aria-checked={o.join === autoJoin}
              className={`start-option${o.join === autoJoin ? ' active' : ''}`}
              onClick={() => pick(o.join)}
            >
              <span className="start-option-icon">{o.icon}</span>
              <span className="start-option-text">
                <strong>{o.title}</strong>
                <span>{o.desc}</span>
              </span>
              {o.join === autoJoin && <CheckIcon size={15} />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
