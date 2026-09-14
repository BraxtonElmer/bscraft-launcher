import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { AlertIcon, CheckIcon, InfoIcon, MemoryIcon } from '../../components/Icons'
import { formatRam } from '../../lib/format'
import { device, osName } from '../../lib/platform'
import type { AppConfig, MemoryPlan } from '../../types'

const GB = 1024
const SLIDER_MIN = 2 * GB
const SLIDER_STEP = 512

interface Props {
  config: AppConfig
  persist: (partial: Partial<AppConfig>) => Promise<void>
  head: ReactNode
}

type Tone = 'ok' | 'info' | 'warn' | 'danger'

/**
 * How much memory the game gets. Automatic picks the most that helps on this computer (see
 * settings::memory_plan in Rust, from measuring the pack); a manual amount gets told
 * plainly when it's too little, more than the pack can use, or more than the OS can spare.
 */
export function MemoryCard({ config, persist, head }: Props) {
  const [plan, setPlan] = useState<MemoryPlan | null>(null)
  const [ram, setRam] = useState(config.ram_mb)
  useEffect(() => { invoke<MemoryPlan>('get_memory_plan').then(setPlan).catch(() => {}) }, [])
  useEffect(() => { setRam(config.ram_mb) }, [config.ram_mb])

  const auto = config.ram_auto !== false
  const choose = (mb: number) => {
    setRam(mb)
    if (mb !== config.ram_mb || auto) persist({ ram_mb: mb, ram_auto: false })
  }
  const useAuto = () => {
    if (plan) setRam(plan.recommended_mb)
    persist({ ram_auto: true, ...(plan ? { ram_mb: plan.recommended_mb } : {}) })
  }

  const total = plan?.total_mb ?? 8 * GB
  const sliderMax = Math.max(SLIDER_MIN + SLIDER_STEP, Math.floor(total / SLIDER_STEP) * SLIDER_STEP)
  const fill = ((ram - SLIDER_MIN) / (sliderMax - SLIDER_MIN)) * 100
  const presets = [4, 6, 8, 10, 12, 16].map(g => g * GB).filter(mb => plan ? mb <= plan.safe_max_mb || mb <= plan.recommended_mb : mb <= total * 0.6)
  const advice = plan ? adviseMemory(ram, plan, auto) : null

  return (
    <section className="card">
      {head}

      <div className="ram-readout">
        <span className="ram-value">{formatRam(ram)}</span>
        <span className="ram-of">of {formatRam(Math.round(total / GB) * GB)} installed</span>
        {auto && <span className="ram-auto-badge">Automatic</span>}
      </div>

      <input
        id="ram-slider"
        type="range"
        className={`slider${advice ? ` tone-${advice.tone}` : ''}`}
        min={SLIDER_MIN}
        max={sliderMax}
        step={SLIDER_STEP}
        value={ram}
        style={{ '--fill': `${fill}%` } as CSSProperties}
        onChange={e => setRam(Number(e.target.value))}
        onPointerUp={e => choose(Number((e.target as HTMLInputElement).value))}
        onKeyUp={e => choose(Number((e.target as HTMLInputElement).value))}
        aria-label="Memory allocation"
      />

      <div className="ram-presets">
        <button className={`preset auto${auto ? ' active' : ''}`} onClick={useAuto} title={`The most that helps on this ${device}, worked out from how much BSCraft really uses`}>
          <MemoryIcon size={12} /> Auto{plan ? ` · ${formatRam(plan.recommended_mb)}` : ''}
        </button>
        {presets.map(mb => (
          <button key={mb} className={`preset${!auto && ram === mb ? ' active' : ''}`} onClick={() => choose(mb)}>
            {formatRam(mb)}
          </button>
        ))}
      </div>

      {advice && (
        <div className={`hint ${advice.tone === 'danger' ? 'warn danger' : advice.tone}`}>
          {advice.tone === 'ok' ? <CheckIcon size={14} /> : advice.tone === 'info' ? <InfoIcon size={14} /> : <AlertIcon size={14} />}
          <span>{advice.text}</span>
        </div>
      )}
    </section>
  )
}

export function adviseMemory(ram: number, plan: MemoryPlan, auto: boolean): { tone: Tone; text: string } {
  const best = formatRam(plan.recommended_mb)
  const tight = plan.recommended_mb < plan.min_mb
  if (ram > plan.safe_max_mb) {
    return {
      tone: 'danger',
      text: `That leaves ${osName} too little: it'll swap to disk and the game will stutter, or crash. ${
        plan.safe_max_mb > plan.recommended_mb ? `Up to ${formatRam(plan.safe_max_mb)} is safe on this ${device}; ${best} is best.` : `${best} is the most that's safe here.`}`,
    }
  }
  if (ram > plan.max_useful_mb) {
    return {
      tone: 'warn',
      text: `More than BSCraft can use, and it won't run faster: Java just takes longer to clean up its memory, which you feel as hitches. ${best} is best here.`,
    }
  }
  if (ram < plan.min_mb && !(auto && tight)) {
    return {
      tone: 'warn',
      text: tight
        ? `Too little for this modpack, but this ${device} can't spare much more. ${best} is the most that's safe.`
        : `Too little for this modpack: expect stutters and out-of-memory crashes. ${best} is best here.`,
    }
  }
  if (tight) {
    return {
      tone: 'info',
      text: `This ${device} is short on memory for BSCraft, so it gets ${best}. Performance mode helps a lot, and close other apps while you play.`,
    }
  }
  if (auto) {
    return {
      tone: 'ok',
      text: `Best for this ${device}. BSCraft holds about 4 GB once you're in a world; the rest is room for busy areas. More wouldn't make it faster.`,
    }
  }
  return ram === plan.recommended_mb
    ? { tone: 'ok', text: `Best for this ${device}.` }
    : { tone: 'ok', text: `Works well. ${best} is best for this ${device}; Auto keeps it right if you change hardware.` }
}
