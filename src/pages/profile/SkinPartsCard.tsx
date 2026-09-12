import { Segmented, Toggle } from '../../components/ui'
import { AlertIcon, InfoIcon, SlidersIcon } from '../../components/Icons'
import type { SkinPrefs } from '../../types'

type Part = Exclude<keyof SkinPrefs, 'main_hand'>

const PARTS: { key: Part; label: string }[] = [
  { key: 'hat', label: 'Hat' },
  { key: 'jacket', label: 'Jacket' },
  { key: 'left_sleeve', label: 'Left sleeve' },
  { key: 'right_sleeve', label: 'Right sleeve' },
  { key: 'left_pants_leg', label: 'Left pants leg' },
  { key: 'right_pants_leg', label: 'Right pants leg' },
  { key: 'cape', label: 'Cape' },
]

interface Props {
  prefs: SkinPrefs
  loaded: boolean
  error: string | null
  gameRunning: boolean
  onChange: (patch: Partial<SkinPrefs>) => void
}

export function SkinPartsCard({ prefs, loaded, error, gameRunning, onChange }: Props) {
  const locked = !loaded || gameRunning
  return (
    <section className="card">
      <div className="card-head">
        <div className="card-icon blue"><SlidersIcon size={18} /></div>
        <div>
          <h2 className="card-title">Skin customization</h2>
          <p className="card-desc">The same switches as Options › Skin Customization in game.</p>
        </div>
      </div>

      <div className="parts-grid">
        {PARTS.map(p => (
          <label key={p.key} className={`part-toggle${locked ? ' disabled' : ''}`}>
            <span>{p.label}</span>
            <Toggle
              label={p.label}
              checked={prefs[p.key]}
              disabled={locked}
              onChange={v => onChange({ [p.key]: v })}
            />
          </label>
        ))}
      </div>

      <div className="setting-row compact">
        <div className="setting-text">
          <div className="setting-title">Main hand</div>
          <div className="setting-desc">The hand you hold items in.</div>
        </div>
        <Segmented<'left' | 'right'>
          size="sm"
          label="Main hand"
          value={prefs.main_hand}
          onChange={main_hand => onChange({ main_hand })}
          disabled={locked}
          options={[
            { value: 'left', label: 'Left' },
            { value: 'right', label: 'Right' },
          ]}
        />
      </div>

      {gameRunning ? (
        <div className="hint info card-note">
          <InfoIcon size={14} /> Close Minecraft to change these. It saves its own options when it exits.
        </div>
      ) : error && (
        <div className="hint warn card-note"><AlertIcon size={14} /> {error}</div>
      )}
    </section>
  )
}
