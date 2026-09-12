import { useEffect, useRef, useState } from 'react'
import { openUrl } from '@tauri-apps/plugin-opener'
import { Segmented, Spinner } from '../../components/ui'
import {
  CheckIcon, ExternalIcon, SearchIcon, ShirtIcon, TrashIcon, UploadIcon, XCircleIcon,
} from '../../components/Icons'
import { sanitizeUsername } from '../../lib/format'
import { capeWithWings, readTextureFile, type SkinModel, type Texture, type TextureKind } from '../../lib/skin'
import type { WardrobeApi, WardrobeKind } from './useWardrobe'

interface Props {
  wardrobe: WardrobeApi
  tab: TextureKind
  onTab: (tab: TextureKind) => void
}

const SKIN_SITES = [
  { label: 'NameMC', url: 'https://namemc.com/minecraft-skins' },
  { label: 'The Skindex', url: 'https://www.minecraftskins.com/' },
  { label: 'Planet Minecraft', url: 'https://www.planetminecraft.com/skins/' },
  { label: 'Skin editor', url: 'https://www.minecraftskins.com/skin-editor/' },
]

type Notice = { tone: 'ok' | 'danger'; text: string } | null

export function WardrobeCard({ wardrobe, tab, onTab }: Props) {
  const [notice, setNotice] = useState<Notice>(null)
  const { drafts, saving } = wardrobe
  const dot = (k: WardrobeKind) => (drafts[k] || (k === 'skin' && drafts.model) ? <span className="tab-dot" aria-label="changed" /> : null)

  useEffect(() => { setNotice(null) }, [tab])

  return (
    <section className="card wardrobe">
      <div className="card-head">
        <div className="card-icon pink"><ShirtIcon size={18} /></div>
        <div>
          <h2 className="card-title">Wardrobe</h2>
          <p className="card-desc">Your skin, cape and elytra. Everyone on the server sees them.</p>
        </div>
      </div>

      <Segmented<TextureKind>
        label="Texture"
        value={tab}
        onChange={onTab}
        options={[
          { value: 'skin', label: <>Skin{dot('skin')}</> },
          { value: 'cape', label: <>Cape{dot('cape')}</> },
          { value: 'elytra', label: 'Elytra' },
        ]}
      />

      {tab === 'elytra'
        ? <ElytraPane wardrobe={wardrobe} disabled={saving} onNotice={setNotice} />
        : <TexturePane key={tab} kind={tab} wardrobe={wardrobe} disabled={saving} onNotice={setNotice} />}

      {notice && (
        <div className={`status-line ${notice.tone}`}>
          {notice.tone === 'ok' ? <CheckIcon size={14} /> : <XCircleIcon size={14} />}
          <span>{notice.text}</span>
        </div>
      )}

      <ImportRow wardrobe={wardrobe} disabled={saving} onNotice={setNotice} />

      <div className="skin-sites">
        <span>Find skins:</span>
        {SKIN_SITES.map(s => (
          <button key={s.url} className="link-btn" onClick={() => openUrl(s.url).catch(() => {})}>
            {s.label} <ExternalIcon size={11} />
          </button>
        ))}
      </div>
    </section>
  )
}

// ── One texture ──────────────────────────────────────────────

function describe(kind: WardrobeKind, wardrobe: WardrobeApi): { title: string; desc: string } {
  const change = wardrobe.drafts[kind]
  const published = wardrobe.published[kind]
  if (change?.op === 'set') return { title: `New ${kind}`, desc: 'Preview. Not saved yet.' }
  if (kind === 'skin') {
    if (change) return { title: 'Default skin', desc: 'Your skin will be removed when you save.' }
    if (published) return { title: 'Your skin', desc: wardrobe.drafts.model ? 'New arm style. Not saved yet.' : 'This is what everyone sees in game.' }
    return { title: 'Default skin', desc: 'Upload a 64×64 PNG to wear your own.' }
  }
  if (change) return { title: 'No cape', desc: 'Your cape will be removed when you save.' }
  if (published) return { title: 'Your cape', desc: 'Shows on your back. Its wing area is also your elytra design.' }
  return { title: 'No cape', desc: '64×32 PNG, or HD up to 512×256.' }
}

function TexturePane({ kind, wardrobe, disabled, onNotice }: {
  kind: WardrobeKind
  wardrobe: WardrobeApi
  disabled: boolean
  onNotice: (n: Notice) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const texture = wardrobe.current[kind]
  const hasDraft = !!wardrobe.drafts[kind] || (kind === 'skin' && !!wardrobe.drafts.model)
  const { title, desc } = describe(kind, wardrobe)
  const legacy = kind === 'skin' && texture?.image.naturalHeight === 32

  const pick = async (file: File | undefined) => {
    if (!file) return
    onNotice(null)
    try {
      wardrobe.setTexture(kind, await readTextureFile(file, kind))
    } catch (e) {
      onNotice({ tone: 'danger', text: e instanceof Error ? e.message : String(e) })
    }
  }

  return (
    <div className="texture-pane">
      <div className="texture-info">
        <TextureThumb texture={texture} kind={kind} />
        <div className="texture-text">
          <div className="texture-title">{title}</div>
          <div className="card-desc">{desc}</div>
        </div>
      </div>

      {kind === 'skin' && (
        <div className="setting-row compact">
          <div className="setting-text">
            <div className="setting-title">Arm style</div>
            <div className="setting-desc">{legacy ? 'Old 64×32 skins only have classic arms.' : 'Slim arms are 3 pixels wide, like Alex.'}</div>
          </div>
          <Segmented<SkinModel>
            size="sm"
            label="Arm style"
            value={wardrobe.model}
            onChange={wardrobe.setModel}
            disabled={!texture || legacy || disabled}
            options={[
              { value: 'default', label: 'Classic' },
              { value: 'slim', label: 'Slim' },
            ]}
          />
        </div>
      )}

      <div className="texture-actions">
        <input
          ref={fileRef}
          type="file"
          accept="image/png"
          hidden
          onChange={e => { pick(e.target.files?.[0]); e.target.value = '' }}
        />
        <button className="btn sm" onClick={() => fileRef.current?.click()} disabled={disabled}>
          <UploadIcon size={14} /> Upload PNG…
        </button>
        {hasDraft && (
          <button className="btn ghost sm" onClick={() => wardrobe.revert(kind)} disabled={disabled}>Undo</button>
        )}
        {texture && (
          <button className="btn ghost sm danger-text" onClick={() => wardrobe.removeTexture(kind)} disabled={disabled}>
            <TrashIcon size={14} /> Remove
          </button>
        )}
      </div>
    </div>
  )
}

// ── Elytra ───────────────────────────────────────────────────

/** Minecraft paints the elytra from the cape texture, so an elytra design is merged into the cape */
function ElytraPane({ wardrobe, disabled, onNotice }: {
  wardrobe: WardrobeApi
  disabled: boolean
  onNotice: (n: Notice) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const cape = wardrobe.current.cape

  const pick = async (file: File | undefined) => {
    if (!file || !cape) return
    onNotice(null)
    try {
      const design = await readTextureFile(file, 'elytra')
      const merged = await capeWithWings(cape.image, design.texture.image)
      URL.revokeObjectURL(design.texture.src)
      wardrobe.setTexture('cape', merged)
      onNotice({ tone: 'ok', text: 'Elytra design added to your cape. Save to wear it.' })
    } catch (e) {
      onNotice({ tone: 'danger', text: e instanceof Error ? e.message : String(e) })
    }
  }

  const plain = async () => {
    if (!cape) return
    onNotice(null)
    wardrobe.setTexture('cape', await capeWithWings(cape.image, null))
  }

  return (
    <div className="texture-pane">
      <div className="texture-info">
        <TextureThumb texture={cape} kind="elytra" />
        <div className="texture-text">
          <div className="texture-title">{cape ? 'Elytra design' : 'Default elytra'}</div>
          <div className="card-desc">
            {cape
              ? 'Minecraft paints your elytra from the wing area of your cape. Upload an elytra texture to replace it.'
              : 'Minecraft paints the elytra from your cape. Add a cape first to give your elytra a design.'}
          </div>
        </div>
      </div>
      <div className="texture-actions">
        <input
          ref={fileRef}
          type="file"
          accept="image/png"
          hidden
          onChange={e => { pick(e.target.files?.[0]); e.target.value = '' }}
        />
        <button className="btn sm" onClick={() => fileRef.current?.click()} disabled={disabled || !cape}>
          <UploadIcon size={14} /> Upload elytra design…
        </button>
        {cape && (
          <button className="btn ghost sm" onClick={plain} disabled={disabled}>Plain wings</button>
        )}
      </div>
    </div>
  )
}

/** The raw texture file, drawn crisp, so its pixels can be checked */
function TextureThumb({ texture, kind }: { texture: Texture | null; kind: TextureKind }) {
  return (
    <div className={`texture-thumb ${kind}`}>
      {texture ? <img src={texture.image.src} alt="" draggable={false} /> : <span>None</span>}
    </div>
  )
}

// ── Copy from a player ───────────────────────────────────────

function ImportRow({ wardrobe, disabled, onNotice }: {
  wardrobe: WardrobeApi
  disabled: boolean
  onNotice: (n: Notice) => void
}) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  const run = async () => {
    if (name.length < 3 || busy) return
    setBusy(true)
    onNotice(null)
    try {
      const r = await wardrobe.importFrom(name)
      const what = r.got.join(' and ')
      const from = r.source === 'bscraft' ? 'on BSCraft' : 'from their Minecraft account'
      onNotice({ tone: 'ok', text: `Copied ${r.name}'s ${what} ${from}. Save to wear ${r.got.length > 1 ? 'them' : 'it'}.` })
      setName('')
    } catch (e) {
      onNotice({ tone: 'danger', text: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="import-row" onSubmit={e => { e.preventDefault(); run() }}>
      <div className="pw-field">
        <span className="pw-icon"><SearchIcon size={15} /></span>
        <input
          value={name}
          onChange={e => setName(sanitizeUsername(e.target.value))}
          placeholder="Copy a look from any player name"
          spellCheck={false}
          autoComplete="off"
          aria-label="Player name to copy from"
          disabled={disabled}
        />
      </div>
      <button type="submit" className="btn sm" disabled={name.length < 3 || busy || disabled}>
        {busy && <Spinner size={12} />} Copy
      </button>
    </form>
  )
}
