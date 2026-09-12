import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type {
  AppConfig,
  VerifyAllResult,
  UpdateCheckResult,
  ModpackManifest,
  SyncProgress,
  DownloadProgress,
  InstallProgress,
  ActiveOperation,
  GpuInfo,
} from '../types'

interface Props {
  config: AppConfig
  onConfigChange: (c: AppConfig) => void
  launcherVersion: string
  operation: ActiveOperation | null
  onOperation: (op: ActiveOperation | null) => void
}

type BtnState = 'idle' | 'busy' | 'done' | 'error'

interface BtnResult { state: BtnState; message: string }

export function SettingsPage({ config, onConfigChange, launcherVersion, onOperation }: Props) {
  const [systemRam, setSystemRam] = useState(8192)
  const [ram, setRam] = useState(config.ram_mb)
  const [consoleEnabled, setConsoleEnabled] = useState(config.console_enabled)
  const [preferDgpu, setPreferDgpu] = useState(config.prefer_dgpu)
  const [gpus, setGpus] = useState<GpuInfo[]>([])
  const [checkResult, setCheckResult] = useState<BtnResult | null>(null)
  const [verifyResult, setVerifyResult] = useState<BtnResult | null>(null)
  const [verifyDetail, setVerifyDetail] = useState<VerifyAllResult | null>(null)
  const [repairing, setRepairing] = useState(false)

  useEffect(() => {
    invoke<number>('get_system_ram').then(setSystemRam).catch(() => {})
  }, [])

  useEffect(() => {
    invoke<GpuInfo[]>('get_gpus').then(setGpus).catch(() => setGpus([]))
  }, [])

  useEffect(() => {
    setPreferDgpu(config.prefer_dgpu)
  }, [config.prefer_dgpu])

  // Progress listeners for this page's operations
  useEffect(() => {
    const unlisteners = [
      listen<DownloadProgress>('download-progress', e => {
        const p = e.payload
        onOperation({
          title: 'Downloading…',
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
          title: p.stage,
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

  // ── Persist config helper ──────────────────────────────────
  const persistConfig = (partial: Partial<AppConfig>) => {
    const updated = { ...config, ...partial }
    onConfigChange(updated)
    invoke('save_config', { config: updated }).catch(() => {})
  }

  // ── Check for Updates ──────────────────────────────────────
  const handleCheckUpdates = async () => {
    setCheckResult({ state: 'busy', message: '' })
    onOperation({ title: 'Checking for Updates', detail: 'Contacting servers…', file: '', filePercent: 0, overallPercent: 0, speedBps: 0, filesDone: 0, filesTotal: 0 })
    try {
      // Always load fresh config from Rust to get the real installed version
      const [freshConfigRes, launcherRes, manifestRes] = await Promise.allSettled([
        invoke<AppConfig>('get_config'),
        invoke<UpdateCheckResult>('check_launcher_update'),
        invoke<ModpackManifest>('fetch_manifest'),
      ])

      const freshConfig = freshConfigRes.status === 'fulfilled' ? freshConfigRes.value : config
      if (freshConfigRes.status === 'fulfilled') onConfigChange(freshConfig)

      const parts: string[] = []
      let needsLauncherUpdate = false
      let needsModpackUpdate = false
      let latestModpackVersion = ''

      if (launcherRes.status === 'fulfilled') {
        needsLauncherUpdate = launcherRes.value.has_update
        parts.push(needsLauncherUpdate
          ? `Launcher update: v${launcherRes.value.latest_version} available`
          : 'Launcher is up to date')
      } else {
        parts.push('Launcher: could not check (server unreachable)')
      }

      if (manifestRes.status === 'fulfilled') {
        latestModpackVersion = manifestRes.value.modpack_version
        const installedVersion = freshConfig.installed_modpack_version
        needsModpackUpdate = !installedVersion || installedVersion !== latestModpackVersion
        parts.push(needsModpackUpdate
          ? `Modpack update: v${latestModpackVersion} available`
          : `Modpack v${installedVersion}: up to date`)
      } else {
        parts.push('Modpack: could not check (server unreachable)')
      }

      setCheckResult({ state: 'done', message: parts.join(' · ') })
      onOperation(null)

      // ── Auto-start updates if anything is available ──────────────────
      if (needsLauncherUpdate) {
        // Launcher update takes priority — it restarts the app
        setCheckResult({ state: 'busy', message: 'Applying launcher update…' })
        onOperation({ title: 'Updating Launcher', detail: 'Downloading…', file: '', filePercent: 0, overallPercent: 0, speedBps: 0, filesDone: 0, filesTotal: 1 })
        await invoke('apply_launcher_update').catch((e: any) => {
          setCheckResult({ state: 'error', message: `Launcher update failed: ${e}` })
        })
        onOperation(null)
      } else if (needsModpackUpdate && manifestRes.status === 'fulfilled') {
        // Modpack-only update — may also need new MC / Forge versions
        const newManifest = manifestRes.value
        setCheckResult({ state: 'busy', message: `Updating modpack to v${latestModpackVersion}…` })
        try {
          // Check if Minecraft version changed
          const mcChanged = freshConfig.installed_mc_version !== newManifest.minecraft_version
          const forgeChanged = freshConfig.installed_forge_version !== newManifest.forge_version

          if (mcChanged) {
            setCheckResult({ state: 'busy', message: `Installing Minecraft ${newManifest.minecraft_version}…` })
            await invoke('install_minecraft', { mcVersion: newManifest.minecraft_version })
          }

          // Reinstall Forge if MC or Forge version changed (Forge is tied to MC version)
          if (mcChanged || forgeChanged) {
            setCheckResult({ state: 'busy', message: `Installing Forge ${newManifest.forge_version}…` })
            await invoke('install_forge', {
              mcVersion: newManifest.minecraft_version,
              forgeVersion: newManifest.forge_version,
            })
          }

          // Sync modpack files (remove_deleted: true cleans up dropped mods)
          setCheckResult({ state: 'busy', message: `Syncing modpack files…` })
          await invoke('sync_modpack', { removeDeleted: true })

          // Re-apply performance mode if it was enabled (sync restores all files)
          if (freshConfig.performance_mode) {
            await invoke('apply_performance_mode', { enabled: true }).catch(() => {})
          }
          const updatedConfig = await invoke<AppConfig>('get_config').catch(() => freshConfig)
          onConfigChange(updatedConfig)
          setCheckResult({ state: 'done', message: `Modpack updated to v${latestModpackVersion}` })
        } catch (e: any) {
          setCheckResult({ state: 'error', message: `Modpack update failed: ${e}` })
        } finally {
          onOperation(null)
        }
      }
    } catch (e: any) {
      setCheckResult({ state: 'error', message: String(e) })
      onOperation(null)
    }
  }

  // ── Verify Files ───────────────────────────────────────────
  const handleVerify = async () => {
    setVerifyResult({ state: 'busy', message: '' })
    setVerifyDetail(null)
    onOperation({ title: 'Verifying Files', detail: 'Starting…', file: '', filePercent: 0, overallPercent: 0, speedBps: 0, filesDone: 0, filesTotal: 0 })

    // Listen for verify-progress events while running
    const unlisten = await listen<{ step: string; detail: string; percent: number }>(
      'verify-progress', e => {
        const { detail, percent } = e.payload
        onOperation({ title: 'Verifying Files', detail, file: '', filePercent: 0, overallPercent: percent, speedBps: 0, filesDone: 0, filesTotal: 0 })
      }
    )

    try {
      const result = await invoke<VerifyAllResult>('verify_all')
      unlisten()
      setVerifyDetail(result)

      const issues: string[] = []
      if (!result.jre_ok) issues.push('Java runtime missing')
      if (!result.minecraft_ok) issues.push('Minecraft client missing')
      if (!result.forge_ok) issues.push('Forge not installed')
      if (result.modpack_failed.length > 0) issues.push(`${result.modpack_failed.length} modpack files failed`)
      if (!result.server_reachable) issues.push('(server unreachable — modpack not checked)')

      if (issues.length === 0) {
        setVerifyResult({ state: 'done', message: `All OK · ${result.modpack_total} modpack files verified` })
      } else {
        setVerifyResult({ state: 'error', message: issues.join(' · ') })
      }
    } catch (e: any) {
      unlisten()
      setVerifyResult({ state: 'error', message: String(e) })
    } finally {
      onOperation(null)
    }
  }

  // ── Repair failed modpack files ────────────────────────────
  const handleRepair = async () => {
    if (!verifyDetail?.modpack_failed.length) return
    setRepairing(true)
    onOperation({ title: 'Repairing Files', detail: 'Downloading failed files…', file: '', filePercent: 0, overallPercent: 0, speedBps: 0, filesDone: 0, filesTotal: verifyDetail.modpack_failed.length })
    try {
      await invoke('repair_files', { paths: verifyDetail.modpack_failed })
      setVerifyResult({ state: 'done', message: `Repaired ${verifyDetail.modpack_failed.length} files` })
      setVerifyDetail(null)
    } catch (e: any) {
      setVerifyResult({ state: 'error', message: `Repair failed: ${e}` })
    } finally {
      setRepairing(false)
      onOperation(null)
    }
  }

  const busy = checkResult?.state === 'busy' || verifyResult?.state === 'busy' || repairing

  const ramPercent = Math.round(ram / systemRam * 100)

  return (
    <div className="settings-page fade-in">

      {/* ── Performance ─────────────────────────────────────── */}
      <div className="settings-section">
        <div className="settings-section-label">Performance</div>
        <div className="settings-card">
          <div className="setting-row">
            <div className="setting-info">
              <div className="setting-label">RAM Allocation</div>
              <div className="setting-sub">Memory allocated to Minecraft</div>
            </div>
            <div className="ram-value">{(ram / 1024).toFixed(1)} GB</div>
          </div>
          <div className="setting-row-full">
            <input
              id="ram-slider"
              type="range"
              className="slider"
              min={512}
              max={systemRam}
              step={256}
              value={ram}
              onChange={e => setRam(Number(e.target.value))}
              onMouseUp={e => persistConfig({ ram_mb: Number((e.target as HTMLInputElement).value) })}
              onTouchEnd={e => persistConfig({ ram_mb: Number((e.target as HTMLInputElement).value) })}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)' }}>
              <span>512 MB</span>
              <span>{ramPercent}% of {(systemRam / 1024).toFixed(0)} GB system RAM</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Display ─────────────────────────────────────────── */}
      <div className="settings-section">
        <div className="settings-section-label">Display</div>
        <div className="settings-card">
          <div className="setting-row">
            <div className="setting-info">
              <div className="setting-label">Console View</div>
              <div className="setting-sub">Show Minecraft logs in the launcher while playing</div>
            </div>
            <label className="toggle" htmlFor="toggle-console">
              <input
                id="toggle-console"
                type="checkbox"
                checked={consoleEnabled}
                onChange={e => {
                  setConsoleEnabled(e.target.checked)
                  persistConfig({ console_enabled: e.target.checked })
                }}
              />
              <span className="toggle-track" />
            </label>
          </div>
          <div className="setting-row">
            <div className="setting-info">
              <div className="setting-label">Prefer Dedicated GPU</div>
              <div className="setting-sub">Ask Windows to run Minecraft on the high-performance GPU</div>
            </div>
            <label className="toggle" htmlFor="toggle-dgpu">
              <input
                id="toggle-dgpu"
                type="checkbox"
                checked={preferDgpu}
                onChange={e => {
                  setPreferDgpu(e.target.checked)
                  persistConfig({ prefer_dgpu: e.target.checked })
                }}
              />
              <span className="toggle-track" />
            </label>
          </div>
        </div>
      </div>

      {/* ── Maintenance ─────────────────────────────────────── */}
      <div className="settings-section">
        <div className="settings-section-label">Maintenance</div>
        <div className="settings-card">

          {/* Check for Updates */}
          <button
            id="btn-check-updates"
            className="action-btn"
            onClick={handleCheckUpdates}
            disabled={busy}
          >
            {checkResult?.state === 'busy'
              ? <span className="btn-spinner" style={{ width: 16, height: 16, borderWidth: 2, borderColor: 'rgba(255,255,255,0.15)', borderTopColor: 'var(--accent)' }} />
              : <span style={{ fontSize: 16 }}>↻</span>
            }
            <div className="action-btn-body">
              <span className="action-btn-label" style={{ fontSize: 13.5, fontWeight: 500 }}>Check for Updates</span>
              <span className="action-btn-sub">Check both launcher and modpack for updates</span>
            </div>
            <span className="action-btn-right">›</span>
          </button>
          {checkResult && checkResult.state !== 'busy' && checkResult.message && (
            <div className={`action-result ${checkResult.state === 'done' ? 'ok' : 'err'}`}>
              {checkResult.state === 'done' ? '✓ ' : '✗ '}{checkResult.message}
            </div>
          )}

          {/* Verify Files */}
          <button
            id="btn-verify-files"
            className="action-btn"
            onClick={handleVerify}
            disabled={busy}
          >
            {verifyResult?.state === 'busy'
              ? <span className="btn-spinner" style={{ width: 16, height: 16, borderWidth: 2, borderColor: 'rgba(255,255,255,0.15)', borderTopColor: 'var(--accent)' }} />
              : <span style={{ fontSize: 16 }}>✓</span>
            }
            <div className="action-btn-body">
              <span style={{ fontSize: 13.5, fontWeight: 500 }}>Verify Files</span>
              <span className="action-btn-sub">Check Java, Minecraft, Forge and all modpack files</span>
            </div>
            <span className="action-btn-right">›</span>
          </button>

          {verifyResult && verifyResult.state !== 'busy' && (
            <>
              {verifyResult.message && (
                <div className={`action-result ${verifyResult.state === 'done' ? 'ok' : 'err'}`}>
                  {verifyResult.state === 'done' ? '✓ ' : '✗ '}{verifyResult.message}
                </div>
              )}
              {verifyDetail && verifyDetail.modpack_failed.length > 0 && (
                <div style={{ padding: '0 18px 14px' }}>
                  <button
                    id="btn-repair"
                    onClick={handleRepair}
                    disabled={repairing || busy}
                    style={{
                      padding: '7px 14px',
                      background: 'var(--accent-dim)',
                      border: '1px solid rgba(61,142,245,0.25)',
                      borderRadius: 'var(--radius-sm)',
                      color: 'var(--accent)',
                      fontSize: 12,
                      fontWeight: 600,
                      fontFamily: 'Inter, sans-serif',
                      cursor: 'pointer',
                    }}
                  >
                    {repairing ? 'Repairing…' : `Repair ${verifyDetail.modpack_failed.length} failed files`}
                  </button>
                </div>
              )}
            </>
          )}

        </div>
      </div>

      {/* ── About ───────────────────────────────────────────── */}
      <div className="settings-section">
        <div className="settings-section-label">About</div>
        <div className="settings-card">
          <div className="about-grid">
            <span className="about-key">Launcher</span>
            <span className="about-val">v{launcherVersion}</span>
            {config.installed_modpack_version && <>
              <span className="about-key">Modpack</span>
              <span className="about-val">v{config.installed_modpack_version}</span>
            </>}
            {config.installed_mc_version && <>
              <span className="about-key">Minecraft</span>
              <span className="about-val">{config.installed_mc_version}</span>
            </>}
            {config.installed_forge_version && <>
              <span className="about-key">Forge</span>
              <span className="about-val">{config.installed_forge_version}</span>
            </>}
          </div>
        </div>
      </div>

    </div>
  )
}
