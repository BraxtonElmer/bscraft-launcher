import { useEffect, useState, type ReactNode } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { ProgressBar, Segmented, Spinner, Toggle, describeOperation, totalPercent } from '../components/ui'
import {
  CheckIcon, ChevronRightIcon, ChipIcon, DatabaseIcon, ImageIcon, InfoIcon,
  MemoryIcon, RefreshIcon, ShieldCheckIcon, SlidersIcon, WrenchIcon, XCircleIcon,
} from '../components/Icons'
import { MemoryCard } from './settings/MemoryCard'
import { StorageCard } from './settings/StorageCard'
import { device, isMac } from '../lib/platform'
import type { Scenery } from '../components/PixelScene'
import type { LauncherApi } from '../hooks/useLauncher'
import type { ActiveOperation, AppConfig, GpuInfo, OperationKind, TaskResult } from '../types'

interface Props {
  launcher: LauncherApi
  config: AppConfig
  persist: (partial: Partial<AppConfig>) => Promise<void>
  operation: ActiveOperation | null
  launcherVersion: string
  scenery: Scenery
  onSceneryChange: (s: Scenery) => void
}

export function SettingsPage({ launcher, config, persist, operation, launcherVersion, scenery, onSceneryChange }: Props) {
  const [gpus, setGpus] = useState<GpuInfo[] | null>(null)

  useEffect(() => { invoke<GpuInfo[]>('get_gpus').then(setGpus).catch(() => setGpus([])) }, [])

  const { checkResult, verifyResult, verifyDetail, maintenanceBlocked, manifest, launcherUpdate } = launcher
  const opFor = (...kinds: OperationKind[]) => (operation && kinds.includes(operation.kind) ? operation : null)
  const checkOp = opFor('check', 'modpack-update', 'launcher-update')
  const verifyOp = opFor('verify', 'repair')
  const ownTaskRunning = !!(checkOp || verifyOp)
  const failed = verifyDetail?.modpack_failed ?? []

  return (
    <div className="page settings page-enter">
      <header className="page-header">
        <h1>Settings</h1>
        <p>Changes are saved automatically and apply the next time you launch.</p>
      </header>

      <div className="settings-grid">
        <div className="settings-col">
          {/* ── Memory ─────────────────────────────── */}
          <MemoryCard
            config={config}
            persist={persist}
            head={<CardHead icon={<MemoryIcon size={18} />} tone="violet" title="Memory" desc="How much RAM Minecraft is allowed to use" />}
          />

          {/* ── Graphics ───────────────────────────── */}
          <section className="card">
            <CardHead icon={<ChipIcon size={18} />} tone="green" title="Graphics" desc="GPU used to run the game" />
            {isMac ? (
              <p className="setting-desc gpu-note">macOS runs Minecraft on the fastest graphics on its own.</p>
            ) : (
              <SettingRow
                title="Prefer dedicated GPU"
                desc="Ask Windows to run Minecraft on the high-performance graphics card."
              >
                <Toggle
                  id="toggle-dgpu"
                  label="Prefer dedicated GPU"
                  checked={config.prefer_dgpu}
                  onChange={v => persist({ prefer_dgpu: v })}
                />
              </SettingRow>
            )}
            <div className="gpu-list">
              {gpus === null ? (
                <div className="gpu muted"><Spinner size={12} /> Detecting graphics cards…</div>
              ) : gpus.length === 0 ? (
                <div className="gpu muted">No graphics cards detected</div>
              ) : (
                gpus.map((g, i) => {
                  const v = vendorOf(g)
                  return (
                    <div key={`${g.name}-${i}`} className="gpu">
                      <span className={`gpu-vendor ${v.key}`}>{v.label}</span>
                      <span className="gpu-name" title={g.name}>{g.name}</span>
                    </div>
                  )
                })
              )}
            </div>
          </section>

          {/* ── Launcher ───────────────────────────── */}
          <section className="card">
            <CardHead icon={<SlidersIcon size={18} />} tone="pink" title="Launcher" desc="How the launcher looks and behaves" />
            <SettingRow
              title="Start the game in"
              desc="Where Play takes you. Also on the ▴ beside the Play button."
            >
              <Segmented<'server' | 'menu'>
                id="start-in"
                size="sm"
                label="Start the game in"
                value={config.auto_join ? 'server' : 'menu'}
                onChange={v => persist({ auto_join: v === 'server' })}
                options={[
                  { value: 'server', label: 'Server' },
                  { value: 'menu', label: 'Main menu' },
                ]}
              />
            </SettingRow>
            <SettingRow
              title="Open console on launch"
              desc="Jump to the live game log when Minecraft starts."
            >
              <Toggle
                id="toggle-console"
                label="Open console on launch"
                checked={config.console_enabled}
                onChange={v => persist({ console_enabled: v })}
              />
            </SettingRow>
            <SettingRow title="Background" desc="Auto follows your local time of day." icon={<ImageIcon size={15} />}>
              <Segmented<Scenery>
                size="sm"
                label="Background scenery"
                value={scenery}
                onChange={onSceneryChange}
                options={[
                  { value: 'auto', label: 'Auto' },
                  { value: 'dawn', label: 'Dawn' },
                  { value: 'day', label: 'Day' },
                  { value: 'dusk', label: 'Dusk' },
                  { value: 'night', label: 'Night' },
                ]}
              />
            </SettingRow>
          </section>
        </div>

        <div className="settings-col">
          {/* ── Maintenance ────────────────────────── */}
          <section className="card">
            <CardHead icon={<WrenchIcon size={18} />} tone="amber" title="Maintenance" desc="Keep your installation healthy" />

            <ActionRow
              id="btn-check-updates"
              icon={<RefreshIcon size={17} />}
              title="Check for updates"
              desc="Launcher and modpack — updates install automatically"
              onClick={launcher.checkForUpdates}
              disabled={!!maintenanceBlocked}
              result={checkResult}
              op={checkOp}
            />

            <ActionRow
              id="btn-verify-files"
              icon={<ShieldCheckIcon size={17} />}
              title="Verify files"
              desc="Check Java, Minecraft, Forge and every modpack file"
              onClick={launcher.verifyFiles}
              disabled={!!maintenanceBlocked}
              result={verifyResult}
              op={verifyOp}
            >
              {failed.length > 0 && !verifyOp && (
                <div className="failed-files">
                  <ul>
                    {failed.slice(0, 4).map(f => <li key={f} title={f}>{f}</li>)}
                    {failed.length > 4 && <li className="more">and {failed.length - 4} more</li>}
                  </ul>
                  <button
                    id="btn-repair"
                    className="btn brand sm"
                    onClick={launcher.repairFiles}
                    disabled={!!maintenanceBlocked}
                  >
                    <WrenchIcon size={14} /> Repair {failed.length} file{failed.length === 1 ? '' : 's'}
                  </button>
                </div>
              )}
            </ActionRow>

            {maintenanceBlocked && !ownTaskRunning && (
              <div className="hint info card-note">
                <InfoIcon size={14} /> {maintenanceBlocked}
              </div>
            )}
          </section>

          {/* ── Storage ────────────────────────────── */}
          <StorageCard
            gameRunning={launcher.running}
            head={<CardHead icon={<DatabaseIcon size={18} />} tone="green" title="Storage" desc={`What BSCraft keeps on this ${device}`} />}
          />

          {/* ── About ──────────────────────────────── */}
          <section className="card">
            <CardHead icon={<InfoIcon size={18} />} tone="blue" title="About" desc="Installed versions" />
            <dl className="about">
              <AboutRow label="Launcher" value={`v${launcherVersion}`} badge={launcherUpdate ? `v${launcherUpdate.latest_version} available` : undefined} />
              <AboutRow
                label="Modpack"
                value={config.installed_modpack_version ? `v${config.installed_modpack_version}` : 'Not installed'}
                badge={manifest && config.installed_modpack_version && manifest.modpack_version !== config.installed_modpack_version
                  ? `v${manifest.modpack_version} available` : undefined}
              />
              <AboutRow label="Minecraft" value={config.installed_mc_version ?? manifest?.minecraft_version ?? '—'} />
              <AboutRow label="Forge" value={config.installed_forge_version ?? manifest?.forge_version ?? '—'} />
              {manifest && <AboutRow label="Java" value={`${manifest.java_version}`} />}
            </dl>
          </section>
        </div>
      </div>
    </div>
  )
}

// ── Pieces ───────────────────────────────────────────────────

function vendorOf(g: GpuInfo): { key: string; label: string } {
  const s = `${g.vendor} ${g.name}`
  if (/nvidia|geforce|rtx|gtx/i.test(s)) return { key: 'nvidia', label: 'NVIDIA' }
  if (/amd|advanced micro|radeon|\bati\b/i.test(s)) return { key: 'amd', label: 'AMD' }
  if (/intel/i.test(s)) return { key: 'intel', label: 'Intel' }
  if (/apple/i.test(s)) return { key: 'apple', label: 'Apple' }
  return { key: 'other', label: g.vendor || 'GPU' }
}

function CardHead({ icon, title, desc, tone }: { icon: ReactNode; title: string; desc: string; tone: string }) {
  return (
    <div className="card-head">
      <div className={`card-icon ${tone}`}>{icon}</div>
      <div>
        <h2 className="card-title">{title}</h2>
        <p className="card-desc">{desc}</p>
      </div>
    </div>
  )
}

function SettingRow({ title, desc, icon, children }: { title: string; desc: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <div className="setting-row">
      <div className="setting-text">
        <div className="setting-title">{icon}{title}</div>
        <div className="setting-desc">{desc}</div>
      </div>
      <div className="setting-control">{children}</div>
    </div>
  )
}

interface ActionRowProps {
  id: string
  icon: ReactNode
  title: string
  desc: string
  onClick: () => void
  disabled: boolean
  result: TaskResult | null
  op: ActiveOperation | null
  children?: ReactNode
}

function ActionRow({ id, icon, title, desc, onClick, disabled, result, op, children }: ActionRowProps) {
  const busy = !!op || result?.state === 'busy'
  const d = op ? describeOperation(op) : null

  return (
    <div className="action">
      <button id={id} className="action-btn" onClick={onClick} disabled={disabled}>
        <span className="action-icon">{busy ? <Spinner size={16} /> : icon}</span>
        <span className="action-text">
          <span className="action-title">{title}</span>
          <span className="action-desc">{desc}</span>
        </span>
        <ChevronRightIcon size={16} className="action-chevron" />
      </button>

      {op && d ? (
        <div className="action-progress">
          <div className="action-progress-top">
            <span>{op.step > 0 && op.stepCount > 1 ? `Step ${op.step}/${op.stepCount} · ` : ''}{op.title}</span>
            <span>{d.percentText}</span>
          </div>
          <ProgressBar percent={totalPercent(op)} indeterminate={op.indeterminate} />
          {(d.item || d.meta.length > 0) && (
            <div className="action-progress-item">{[d.item, ...d.meta].filter(Boolean).join('  ·  ')}</div>
          )}
        </div>
      ) : result && result.message ? (
        <div className={`action-result ${result.state}`}>
          {result.state === 'done' ? <CheckIcon size={14} /> : result.state === 'error' ? <XCircleIcon size={14} /> : <Spinner size={12} />}
          <span>{result.message}</span>
        </div>
      ) : null}

      {children}
    </div>
  )
}

function AboutRow({ label, value, badge }: { label: string; value: string; badge?: string }) {
  return (
    <div className="about-row">
      <dt>{label}</dt>
      <dd>
        {value}
        {badge && <span className="badge">{badge}</span>}
      </dd>
    </div>
  )
}
