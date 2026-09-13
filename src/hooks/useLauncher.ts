import { useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { usernameProblem } from '../lib/format'
import type { ConfigApi } from './useConfig'
import type { OperationApi } from './useOperation'
import type { GameSessionApi } from './useGameSession'
import type {
  ErrorInfo,
  InstallStatus,
  LaunchStatus,
  ModpackManifest,
  TaskResult,
  Toast,
  UpdateCheckResult,
  VerifyAllResult,
} from '../types'

interface Options {
  cfg: ConfigApi
  op: OperationApi
  game: GameSessionApi
  onLaunched: () => void
  notify: (toast: Omit<Toast, 'id'>) => void
}

export type LauncherApi = ReturnType<typeof useLauncher>

/**
 * All launcher flows (startup checks, install, launch, updates, maintenance).
 * Kept at the app root so a running install or a verify result survives
 * switching pages.
 */
export function useLauncher({ cfg, op, game, onLaunched, notify }: Options) {
  const [status, setStatus] = useState<LaunchStatus>('init')
  const [installed, setInstalled] = useState(false)
  const [manifest, setManifest] = useState<ModpackManifest | null>(null)
  const [launcherUpdate, setLauncherUpdate] = useState<UpdateCheckResult | null>(null)
  const [perfBusy, setPerfBusy] = useState(false)
  const [error, setError] = useState<ErrorInfo | null>(null)
  const [username, setUsername] = useState('')
  const [usernameNudge, setUsernameNudge] = useState(0)
  const [checkResult, setCheckResult] = useState<TaskResult | null>(null)
  const [verifyResult, setVerifyResult] = useState<TaskResult | null>(null)
  const [verifyDetail, setVerifyDetail] = useState<VerifyAllResult | null>(null)

  // Async flows read these so they always see current values
  const cfgRef = useRef(cfg)
  cfgRef.current = cfg
  const usernameRef = useRef(username)
  usernameRef.current = username
  const manifestRef = useRef(manifest)
  manifestRef.current = manifest
  const statusRef = useRef(status)
  statusRef.current = status
  const onLaunchedRef = useRef(onLaunched)
  onLaunchedRef.current = onLaunched

  const running = game.running
  const busy =
    status === 'init' || status === 'busy' || status === 'launching' ||
    op.operation !== null || perfBusy

  useEffect(() => {
    if (cfg.loaded) setUsername(cfg.config.username)
  }, [cfg.loaded, cfg.config.username])

  useEffect(() => { runStartup() }, [])

  const showError = (e: unknown, context: string) => setError({ message: String(e), context })

  const dismissError = () => {
    setError(null)
    if (statusRef.current === 'error') runStartup()
  }

  // ── Startup ────────────────────────────────────────────────

  const fetchManifest = async () => {
    try {
      const m = await invoke<ModpackManifest>('fetch_manifest')
      setManifest(m)
      return m
    } catch {
      return null
    }
  }

  const checkLauncherUpdate = async () => {
    try {
      const r = await invoke<UpdateCheckResult>('check_launcher_update')
      setLauncherUpdate(r.has_update ? r : null)
    } catch { /* server unreachable — ignore */ }
  }

  const readInstallStatus = async () => {
    let s: InstallStatus | null = null
    try { s = await invoke<InstallStatus>('get_install_status') } catch { /* ignore */ }
    const ok = !!s?.jre_installed && !!s?.minecraft_installed && !!s?.forge_installed
    setInstalled(ok)
    return ok
  }

  const runStartup = async () => {
    setStatus('init')
    setError(null)
    const isInstalled = await readInstallStatus()
    checkLauncherUpdate()
    if (isInstalled) {
      setStatus('ready')
      fetchManifest()
    } else {
      // Nothing to launch yet — we need the manifest to install
      setStatus((await fetchManifest()) ? 'ready' : 'offline')
    }
  }

  // ── Launcher self-update ───────────────────────────────────

  /** Resolves only on failure — on success the app restarts into the new version */
  const runLauncherUpdate = async () => {
    setStatus('busy')
    op.begin('launcher-update', 'Updating Launcher', { detail: 'Downloading update…' })
    try {
      await invoke('apply_launcher_update')
    } catch (e) {
      op.end()
      setStatus('ready')
      throw e
    }
  }

  // ── Install + launch ───────────────────────────────────────

  const startStep = (step: number, title: string) => op.patch({
    step, title, detail: '', file: '', stepPercent: 0, speedBps: 0,
    bytesDone: 0, bytesTotal: 0, filesDone: 0, filesTotal: 0, indeterminate: true,
  })

  const installThenLaunch = async () => {
    setStatus('busy')
    op.begin('install', 'Preparing Install', { detail: 'Fetching modpack manifest…', stepCount: 4 })

    const m = manifestRef.current ?? await fetchManifest()
    if (!m) {
      op.end()
      setStatus('offline')
      return
    }

    try {
      startStep(1, 'Installing Java Runtime')
      await invoke('install_jre')
      startStep(2, 'Installing Minecraft')
      await invoke('install_minecraft', { mcVersion: m.minecraft_version })
      startStep(3, 'Installing Forge')
      await invoke('install_forge', { mcVersion: m.minecraft_version, forgeVersion: m.forge_version })
      startStep(4, 'Syncing Modpack')
      await invoke('sync_modpack', { removeDeleted: false })

      // Sync restores every file, so re-apply performance mode
      if (cfgRef.current.config.performance_mode) {
        await invoke('apply_performance_mode', { enabled: true }).catch(() => {})
      }
      setInstalled(true)
      await cfgRef.current.refresh()
      op.end()
    } catch (e) {
      op.end()
      setStatus('error')
      showError(e, 'Installation failed')
      return
    }
    await launch()
  }

  /** Saves the typed name, if it's valid, so it's kept after a restart */
  const saveUsername = async (name = usernameRef.current.trim()) => {
    if (usernameProblem(name) || name === cfgRef.current.config.username) return
    setUsername(name)
    await cfgRef.current.persist({ username: name })
  }

  const launch = async () => {
    const name = usernameRef.current.trim()
    if (usernameProblem(name)) {
      setStatus('ready')
      setUsernameNudge(n => n + 1)
      return
    }
    await saveUsername(name)

    setStatus('launching')
    game.prepare()
    try {
      await invoke('launch_game', { username: name, ramMb: cfgRef.current.config.ram_mb })
      game.markRunning()
      setStatus('ready')
      onLaunchedRef.current()
    } catch (e) {
      setStatus('error')
      showError(e, 'Launch failed')
    }
  }

  /** The big button */
  const play = async () => {
    if (busy || running) return
    setError(null)

    if (launcherUpdate) {
      try { await runLauncherUpdate() } catch (e) { showError(e, 'Launcher update failed') }
      return
    }
    if (status === 'offline' || status === 'error') {
      runStartup()
      return
    }
    if (usernameProblem(usernameRef.current.trim())) {
      setUsernameNudge(n => n + 1)
      return
    }
    if (!installed) await installThenLaunch()
    else await launch()
  }

  // ── Performance mode ───────────────────────────────────────

  const setPerformanceMode = async (enabled: boolean) => {
    if (perfBusy || enabled === cfgRef.current.config.performance_mode) return
    setPerfBusy(true)
    try {
      await invoke('apply_performance_mode', { enabled })
      await cfgRef.current.persist({ performance_mode: enabled })
    } catch (e) {
      showError(e, 'Performance Mode toggle failed')
    } finally {
      setPerfBusy(false)
    }
  }

  // ── Modpack update ─────────────────────────────────────────

  /** Installs new MC/Forge versions if the manifest changed them, then syncs. Throws on failure. */
  const updateModpack = async (m: ModpackManifest) => {
    setStatus('busy')
    try {
      const fresh = (await cfgRef.current.refresh()) ?? cfgRef.current.config
      const mcChanged = fresh.installed_mc_version !== m.minecraft_version
      // Forge is tied to the MC version, so reinstall it if either changed
      const forgeChanged = mcChanged || fresh.installed_forge_version !== m.forge_version
      const stepCount = 1 + (mcChanged ? 1 : 0) + (forgeChanged ? 1 : 0)
      let step = 0

      op.begin('modpack-update', `Updating to v${m.modpack_version}`, {
        stepCount: stepCount > 1 ? stepCount : 0,
      })
      if (mcChanged) {
        startStep(++step, `Installing Minecraft ${m.minecraft_version}`)
        await invoke('install_minecraft', { mcVersion: m.minecraft_version })
      }
      if (forgeChanged) {
        startStep(++step, `Installing Forge ${m.forge_version}`)
        await invoke('install_forge', { mcVersion: m.minecraft_version, forgeVersion: m.forge_version })
      }
      // remove_deleted cleans up mods dropped from the pack
      startStep(stepCount > 1 ? ++step : 0, 'Syncing Modpack')
      await invoke('sync_modpack', { removeDeleted: true })

      if (fresh.performance_mode) {
        await invoke('apply_performance_mode', { enabled: true }).catch(() => {})
      }
      await cfgRef.current.refresh()
    } finally {
      op.end()
      setStatus('ready')
    }
  }

  const updateModpackNow = async () => {
    const m = manifestRef.current
    if (!m || busy || running) return
    try {
      await updateModpack(m)
      notify({ tone: 'success', title: `Modpack updated to v${m.modpack_version}` })
    } catch (e) {
      showError(e, 'Modpack update failed')
    }
  }

  // ── Maintenance ────────────────────────────────────────────

  const checkForUpdates = async () => {
    if (busy || running) return
    setCheckResult({ state: 'busy', message: 'Contacting servers…' })
    op.begin('check', 'Checking for Updates', { detail: 'Contacting servers…' })

    const [freshRes, launcherRes, manifestRes] = await Promise.allSettled([
      cfgRef.current.refresh(),
      invoke<UpdateCheckResult>('check_launcher_update'),
      invoke<ModpackManifest>('fetch_manifest'),
    ])
    op.end()

    const fresh = (freshRes.status === 'fulfilled' && freshRes.value) || cfgRef.current.config
    const parts: string[] = []

    let launcherInfo: UpdateCheckResult | null = null
    if (launcherRes.status === 'fulfilled') {
      launcherInfo = launcherRes.value
      setLauncherUpdate(launcherInfo.has_update ? launcherInfo : null)
      parts.push(launcherInfo.has_update
        ? `Launcher v${launcherInfo.latest_version} available`
        : 'Launcher is up to date')
    } else {
      parts.push('Launcher: server unreachable')
    }

    let latest: ModpackManifest | null = null
    if (manifestRes.status === 'fulfilled') {
      latest = manifestRes.value
      setManifest(latest)
      const current = fresh.installed_modpack_version
      parts.push(current === latest.modpack_version
        ? `Modpack v${current} is up to date`
        : `Modpack v${latest.modpack_version} available`)
    } else {
      parts.push('Modpack: server unreachable')
    }

    // Launcher update takes priority — it restarts the app
    if (launcherInfo?.has_update) {
      setCheckResult({ state: 'busy', message: `Installing launcher v${launcherInfo.latest_version}…` })
      try {
        await runLauncherUpdate()
      } catch (e) {
        setCheckResult({ state: 'error', message: `Launcher update failed: ${e}` })
      }
      return
    }

    if (latest && fresh.installed_modpack_version !== latest.modpack_version) {
      if (!installed) {
        setCheckResult({ state: 'done', message: `Modpack v${latest.modpack_version} will be installed when you press Install.` })
        return
      }
      setCheckResult({ state: 'busy', message: `Updating modpack to v${latest.modpack_version}…` })
      try {
        await updateModpack(latest)
        setCheckResult({ state: 'done', message: `Modpack updated to v${latest.modpack_version}` })
      } catch (e) {
        setCheckResult({ state: 'error', message: `Modpack update failed: ${e}` })
      }
      return
    }

    const unreachable = launcherRes.status === 'rejected' || manifestRes.status === 'rejected'
    setCheckResult({ state: unreachable ? 'error' : 'done', message: parts.join(' · ') })
  }

  const verifyFiles = async () => {
    if (busy || running) return
    setVerifyResult({ state: 'busy', message: '' })
    setVerifyDetail(null)
    op.begin('verify', 'Verifying Files', { detail: 'Starting…' })

    try {
      const r = await invoke<VerifyAllResult>('verify_all')
      setVerifyDetail(r)

      const issues: string[] = []
      if (!r.jre_ok) issues.push('Java runtime missing')
      if (!r.minecraft_ok) issues.push('Minecraft client missing')
      if (!r.forge_ok) issues.push('Forge not installed')
      if (r.modpack_failed.length > 0) {
        issues.push(`${r.modpack_failed.length} modpack file${r.modpack_failed.length === 1 ? '' : 's'} failed`)
      }
      if (!r.server_reachable) issues.push('Server unreachable — modpack not checked')

      setVerifyResult(issues.length === 0
        ? { state: 'done', message: `All good · ${r.modpack_total} modpack files verified` }
        : { state: 'error', message: issues.join(' · ') })

      // Missing core components flip the Play button back to Install
      if (!r.jre_ok || !r.minecraft_ok || !r.forge_ok) await readInstallStatus()
    } catch (e) {
      setVerifyResult({ state: 'error', message: String(e) })
    } finally {
      op.end()
    }
  }

  const repairFiles = async () => {
    const failed = verifyDetail?.modpack_failed ?? []
    if (!failed.length || busy || running) return
    op.begin('repair', 'Repairing Files', { detail: 'Downloading failed files…', filesTotal: failed.length })
    try {
      await invoke('repair_files', { paths: failed })
      setVerifyResult({ state: 'done', message: `Repaired ${failed.length} file${failed.length === 1 ? '' : 's'}` })
      setVerifyDetail(null)
    } catch (e) {
      setVerifyResult({ state: 'error', message: `Repair failed: ${e}` })
    } finally {
      op.end()
    }
  }

  // ── Derived ────────────────────────────────────────────────

  const installedModpack = cfg.config.installed_modpack_version
  const modpackUpdate =
    installed && manifest && installedModpack !== manifest.modpack_version ? manifest : null

  const maintenanceBlocked = running
    ? 'Close Minecraft to run maintenance tasks.'
    : busy
    ? 'Wait for the current task to finish.'
    : null

  return {
    status,
    installed,
    manifest,
    launcherUpdate,
    modpackUpdate,
    running,
    busy,
    perfBusy,
    maintenanceBlocked,
    error,
    dismissError,
    username,
    setUsername,
    saveUsername,
    usernameNudge,
    checkResult,
    verifyResult,
    verifyDetail,
    play,
    retry: runStartup,
    setPerformanceMode,
    updateModpackNow,
    checkForUpdates,
    verifyFiles,
    repairFiles,
  }
}
