import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { ErrorModal } from '../components/ErrorModal'
import type {
  AppConfig,
  ModpackManifest,
  InstallStatus,
  UpdateCheckResult,
  ActiveOperation,
  DownloadProgress,
  InstallProgress,
  SyncProgress,
  GameExited,
} from '../types'

interface Props {
  config: AppConfig
  onConfigChange: (c: AppConfig) => void
  onGameStart: () => void
  onSettingsOpen: () => void
  launcherVersion: string
  gameRunning: boolean
  operation: ActiveOperation | null
  onOperation: (op: ActiveOperation | null) => void
}

type Phase =
  | 'init'
  | 'ready'
  | 'no-internet'
  | 'launcher-update'
  | 'busy'
  | 'running'
  | 'error'

interface ErrorState {
  message: string
  context: string
}

// ── Speedometer SVG icon ─────────────────────────────────────────────────────
function SpeedometerIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 22C6.477 22 2 17.523 2 12S6.477 2 12 2s10 4.477 10 10"
        stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
      <path d="M22 12a10 10 0 0 1-1.636 5.534" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
      <path d="M12 12l-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
      <circle cx="12" cy="12" r="1.5" fill="currentColor"/>
      <path d="M6 12h1M17 12h1M12 7v1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  )
}

export function MainPage({
  config, onConfigChange, onGameStart, onSettingsOpen, launcherVersion, gameRunning, onOperation
}: Props) {
  const [phase, setPhase] = useState<Phase>('init')
  const [username, setUsername] = useState(config.username)
  const [errorModal, setErrorModal] = useState<ErrorState | null>(null)
  const [manifest, setManifest] = useState<ModpackManifest | null>(null)
  const [installed, setInstalled] = useState(false)

  // Performance mode
  const [performanceMode, setPerformanceMode] = useState(config.performance_mode)
  const [perfBusy, setPerfBusy] = useState(false)

  useEffect(() => { setUsername(config.username) }, [config.username])
  useEffect(() => { setPerformanceMode(config.performance_mode) }, [config.performance_mode])

  // ── Progress event listeners ─────────────────────────────────
  useEffect(() => {
    const unlisteners = [
      listen<DownloadProgress>('download-progress', e => {
        const p = e.payload
        onOperation({
          title: stageTitle(p.stage),
          detail: p.detail,
          file: p.file,
          filePercent: p.percent,
          overallPercent: p.percent,
          speedBps: p.speed_bps,
          filesDone: 0,
          filesTotal: 0,
        })
      }),
      listen<InstallProgress>('install-progress', e => {
        const p = e.payload
        onOperation({
          title: stageTitle(p.stage),
          detail: p.detail,
          file: '',
          filePercent: 0,
          overallPercent: p.percent,
          speedBps: 0,
          filesDone: p.files_done,
          filesTotal: p.files_total,
        })
      }),
      listen<SyncProgress>('sync-progress', e => {
        const p = e.payload
        onOperation({
          title: 'Syncing Modpack',
          detail: '',
          file: p.file,
          filePercent: 0,
          overallPercent: p.overall_percent,
          speedBps: 0,
          filesDone: p.files_done,
          filesTotal: p.files_total,
        })
      }),
    ]
    return () => { unlisteners.forEach(p => p.then(fn => fn())) }
  }, [])

  // ── Game exit listener ───────────────────────────────────────
  useEffect(() => {
    const unlisten = listen<GameExited>('game-exited', () => {
      setPhase('ready')
    })
    return () => { unlisten.then(fn => fn()) }
  }, [])

  // ── Startup on mount ─────────────────────────────────────────
  useEffect(() => { runStartup() }, [])

  const runStartup = async () => {
    setPhase('init')
    setErrorModal(null)

    // Check local install status — no network needed
    let status: InstallStatus | null = null
    try {
      status = await invoke<InstallStatus>('get_install_status')
    } catch { /* ignore */ }

    const isInstalled =
      !!status?.jre_installed &&
      !!status?.minecraft_installed &&
      !!status?.forge_installed

    setInstalled(isInstalled)

    if (isInstalled) {
      setPhase('ready')
      checkForLauncherUpdate()
    } else {
      const online = await tryFetchManifest()
      if (online) {
        setPhase('ready')
      } else {
        setPhase('no-internet')
      }
    }
  }

  const tryFetchManifest = async (): Promise<boolean> => {
    try {
      const m = await invoke<ModpackManifest>('fetch_manifest')
      setManifest(m)
      return true
    } catch {
      return false
    }
  }

  const checkForLauncherUpdate = async () => {
    try {
      const result = await invoke<UpdateCheckResult>('check_launcher_update')
      if (result.has_update) {
        setPhase('launcher-update')
      }
    } catch { /* server unreachable — ignore */ }
    tryFetchManifest()
  }

  // ── Performance Mode toggle ──────────────────────────────────
  const handleTogglePerformance = async () => {
    const next = !performanceMode
    setPerfBusy(true)
    try {
      await invoke('apply_performance_mode', { enabled: next })
      setPerformanceMode(next)
      // Load fresh config from Rust so we don't overwrite installed versions
      const freshConfig = await invoke<AppConfig>('get_config').catch(() => config)
      const updated = { ...freshConfig, performance_mode: next }
      onConfigChange(updated)
      await invoke('save_config', { config: updated }).catch(() => {})
    } catch (e: any) {
      setErrorModal({ message: String(e), context: 'Performance Mode toggle failed' })
    } finally {
      setPerfBusy(false)
    }
  }

  // ── Install then launch ──────────────────────────────────────
  const doInstallThenLaunch = async () => {
    setPhase('busy')
    setErrorModal(null)

    let activeManifest = manifest
    if (!activeManifest) {
      try {
        activeManifest = await invoke<ModpackManifest>('fetch_manifest')
        setManifest(activeManifest)
      } catch {
        setPhase('no-internet')
        return
      }
    }

    try {
      await invoke('install_jre')
      await invoke('install_minecraft', { mcVersion: activeManifest.minecraft_version })
      await invoke('install_forge', {
        mcVersion: activeManifest.minecraft_version,
        forgeVersion: activeManifest.forge_version,
      })
      await invoke('sync_modpack', { removeDeleted: false })

      // Re-apply performance mode after sync (sync restores all files to mc_dir)
      if (performanceMode) {
        await invoke('apply_performance_mode', { enabled: true }).catch(() => {})
      }

      setInstalled(true)
      onOperation(null)
      await doLaunch()
    } catch (e: any) {
      onOperation(null)
      setPhase('error')
      setErrorModal({ message: String(e), context: 'Installation failed' })
    }
  }

  // ── Launch ───────────────────────────────────────────────────
  const doLaunch = async () => {
    if (!username.trim()) {
      setErrorModal({ message: 'Please enter a username before launching.', context: 'Launch validation' })
      return
    }

    if (username !== config.username) {
      // Load fresh config from Rust — do NOT spread stale React config, as
      // it may have null installed_mc_version from before the install ran.
      const freshConfig = await invoke<AppConfig>('get_config').catch(() => null)
      const updated = { ...(freshConfig ?? config), username }
      onConfigChange(updated)
      await invoke('save_config', { config: updated }).catch(() => {})
    }

    setPhase('busy')
    try {
      await invoke('launch_game', { username, ramMb: config.ram_mb })
      setPhase('running')
      if (config.console_enabled) onGameStart()
    } catch (e: any) {
      setPhase('error')
      setErrorModal({ message: String(e), context: 'Launch failed' })
    }
  }

  // ── Play button click ────────────────────────────────────────
  const handlePlay = async () => {
    setErrorModal(null)

    if (phase === 'launcher-update') {
      setPhase('busy')
      onOperation({ title: 'Updating Launcher', detail: 'Downloading…', file: '', filePercent: 0, overallPercent: 0, speedBps: 0, filesDone: 0, filesTotal: 1 })
      try {
        await invoke('apply_launcher_update')
      } catch (e: any) {
        onOperation(null)
        setPhase('launcher-update')
        setErrorModal({ message: String(e), context: 'Launcher update failed' })
      }
      return
    }

    if (phase === 'no-internet' || phase === 'error') {
      runStartup()
      return
    }

    if (phase !== 'ready') return

    if (!installed) {
      await doInstallThenLaunch()
    } else {
      await doLaunch()
    }
  }

  const isBusy = phase === 'busy' || phase === 'init'
  const isRunning = phase === 'running' || gameRunning

  return (
    <div className="home-page fade-in">
      {/* Settings cogwheel FAB */}
      {!isBusy && !isRunning && (
        <button
          id="btn-settings-fab"
          className="settings-fab"
          onClick={onSettingsOpen}
          title="Settings"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path
              strokeLinecap="round" strokeLinejoin="round" stroke="currentColor" strokeWidth="1.6"
              d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 0 1 0 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 0 1 0-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z"
            />
            <path
              strokeLinecap="round" strokeLinejoin="round" stroke="currentColor" strokeWidth="1.6"
              d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z"
            />
          </svg>
        </button>
      )}

      {/* Version badge */}
      <div className="home-version">v{launcherVersion}</div>

      <div className="home-inner">
        {/* Logo */}
        <div className="home-logo">
          <div className="home-logo-icon">⛏</div>
          <div>
            <div className="home-logo-name">BSCraft</div>
            <div className="home-logo-sub">Modpack Launcher</div>
          </div>
        </div>

        {/* Username */}
        <div className="username-wrap">
          <input
            id="username-input"
            className="username-input"
            type="text"
            placeholder="Enter your username"
            value={username}
            onChange={e => setUsername(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && phase === 'ready') handlePlay() }}
            maxLength={16}
            disabled={isBusy || isRunning}
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        {/* PLAY button */}
        <button
          id="btn-play"
          className={`play-btn${phase === 'launcher-update' ? ' update-available' : ''}`}
          onClick={handlePlay}
          disabled={isBusy || isRunning}
        >
          {isBusy && <span className="btn-spinner" />}
          {isRunning
            ? 'RUNNING'
            : phase === 'launcher-update'
            ? 'UPDATE & PLAY'
            : phase === 'no-internet'
            ? 'RETRY'
            : 'PLAY'}
        </button>

        {/* Performance Mode toggle — below play button */}
        <button
          id="btn-perf-mode"
          className={`perf-btn${performanceMode ? ' active' : ''}`}
          onClick={handleTogglePerformance}
          disabled={isBusy || isRunning || perfBusy}
          title={performanceMode
            ? 'Performance Mode ON: visual mods are removed for better FPS'
            : 'Performance Mode OFF: all mods active'}
        >
          {perfBusy ? (
            <span className="btn-spinner" style={{ width: 13, height: 13, borderWidth: 2 }} />
          ) : (
            <SpeedometerIcon />
          )}
          {performanceMode ? 'Performance Mode: ON' : 'Performance Mode: OFF'}
        </button>

        {/* No-internet hint */}
        {phase === 'no-internet' && (
          <div className="home-error">
            No internet connection. The game must be downloaded first.
          </div>
        )}
      </div>

      {/* Error modal */}
      {errorModal && (
        <ErrorModal
          error={errorModal.message}
          context={errorModal.context}
          onClose={() => {
            setErrorModal(null)
            if (phase === 'error') setPhase('ready')
          }}
        />
      )}
    </div>
  )
}

function stageTitle(stage: string): string {
  const map: Record<string, string> = {
    jre: 'Installing Java Runtime',
    minecraft: 'Installing Minecraft',
    forge: 'Installing Forge',
    libraries: 'Downloading Libraries',
    assets: 'Downloading Game Assets',
    modpack: 'Syncing Modpack',
    repair: 'Repairing Files',
  }
  return map[stage] ?? 'Working…'
}
