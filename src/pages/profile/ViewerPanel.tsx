import { useState, type ReactNode } from 'react'
import { SkinViewer3D, type BackShown, type SkinAnimation } from '../../components/SkinViewer3D'
import { Segmented } from '../../components/ui'
import { LayersIcon, RotateIcon, TagIcon, TargetIcon } from '../../components/Icons'
import { generatedSkin } from '../../lib/defaultSkin'
import type { WardrobeApi } from './useWardrobe'
import type { SkinPrefs } from '../../types'

export interface ViewerOptions {
  animation: SkinAnimation
  back: BackShown
  outerLayer: boolean
  nameTag: boolean
  autoRotate: boolean
}

const ANIMATIONS: { value: SkinAnimation; label: string }[] = [
  { value: 'still', label: 'Still' },
  { value: 'idle', label: 'Idle' },
  { value: 'walk', label: 'Walk' },
  { value: 'run', label: 'Run' },
  { value: 'fly', label: 'Fly' },
  { value: 'wave', label: 'Wave' },
  { value: 'crouch', label: 'Sneak' },
]

interface Props {
  username: string
  wardrobe: WardrobeApi
  prefs: SkinPrefs
  options: ViewerOptions
  onOptions: (patch: Partial<ViewerOptions>) => void
}

export function ViewerPanel({ username, wardrobe, prefs, options, onOptions }: Props) {
  const [resetKey, setResetKey] = useState(0)
  const { current, model, changes } = wardrobe
  const dirty = changes.length > 0

  return (
    <section className={`viewer-panel${dirty ? ' draft' : ''}`}>
      <div className="viewer-stage">
        <SkinViewer3D
          skin={current.skin?.image ?? generatedSkin(username || 'player')}
          model={current.skin ? model : 'default'}
          cape={current.cape?.image ?? null}
          elytra={current.elytra?.image ?? null}
          back={options.back}
          animation={options.animation}
          parts={prefs}
          outerLayer={options.outerLayer}
          nameTag={options.nameTag ? username || 'Player' : null}
          mainHand={prefs.main_hand}
          autoRotate={options.autoRotate}
          resetKey={resetKey}
          hint={!dirty}
        />
        {dirty && <span className="viewer-chip draft">Preview · not saved</span>}
        <div className="viewer-top">
          <div className="viewer-tools">
            <ToolButton on={options.autoRotate} title="Spin" onClick={() => onOptions({ autoRotate: !options.autoRotate })}>
              <RotateIcon size={15} />
            </ToolButton>
            <ToolButton on={options.nameTag} title="Name tag" onClick={() => onOptions({ nameTag: !options.nameTag })}>
              <TagIcon size={15} />
            </ToolButton>
            <ToolButton on={options.outerLayer} title="Outer layer (hat, jacket, sleeves)" onClick={() => onOptions({ outerLayer: !options.outerLayer })}>
              <LayersIcon size={15} />
            </ToolButton>
            <ToolButton title="Reset view" onClick={() => setResetKey(k => k + 1)}>
              <TargetIcon size={15} />
            </ToolButton>
          </div>
        </div>
      </div>

      <div className="viewer-controls">
        <div className="anim-chips" role="radiogroup" aria-label="Animation">
          {ANIMATIONS.map(a => (
            <button
              key={a.value}
              type="button"
              role="radio"
              aria-checked={options.animation === a.value}
              className={options.animation === a.value ? 'active' : ''}
              onClick={() => onOptions({ animation: a.value })}
            >
              {a.label}
            </button>
          ))}
        </div>
        <div className="viewer-back">
          <span>On back</span>
          <Segmented<BackShown>
            size="sm"
            label="Show on back"
            value={options.back}
            onChange={back => onOptions({ back })}
            options={[
              { value: 'cape', label: 'Cape' },
              { value: 'elytra', label: 'Elytra' },
              { value: 'none', label: 'None' },
            ]}
          />
        </div>
      </div>
    </section>
  )
}

function ToolButton({ on, title, onClick, children }: { on?: boolean; title: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      className={`viewer-tool${on ? ' on' : ''}`}
      title={title}
      aria-label={title}
      aria-pressed={on}
      onClick={onClick}
    >
      {children}
    </button>
  )
}
