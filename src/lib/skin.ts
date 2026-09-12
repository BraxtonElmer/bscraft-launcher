// ============================================================
// skin.ts — Reading, checking and fetching skins, capes and elytra.
// Published looks live on the BSCraft server in CustomSkinLoader's
// CustomSkinAPI format: /skins/<Name>.json -> /skins/textures/<sha256>.
// ============================================================

export type SkinModel = 'default' | 'slim'
export type TextureKind = 'skin' | 'cape' | 'elytra'

export interface Texture {
  image: HTMLImageElement
  /** Object URL or remote URL the image was loaded from */
  src: string
}

export interface Skin extends Texture {
  model: SkinModel
}

/** Everything a player wears, as published on the server */
export interface Look {
  skin: Skin | null
  cape: Texture | null
  elytra: Texture | null
}

export const EMPTY_LOOK: Look = { skin: null, cape: null, elytra: null }

export const SKIN_ROOT = 'https://bscraft.zukashix.com/skins/'
export const MAX_BYTES: Record<TextureKind, number> = { skin: 32 * 1024, cape: 60 * 1024, elytra: 60 * 1024 }

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const BACK_SIZES = [1, 2, 4, 8].map(k => [64 * k, 32 * k])

function loadImage(src: string, crossOrigin = false): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    if (crossOrigin) img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not load the image'))
    img.src = src
  })
}

function pixels(img: HTMLImageElement): ImageData {
  const c = document.createElement('canvas')
  c.width = img.naturalWidth
  c.height = img.naturalHeight
  const ctx = c.getContext('2d')!
  ctx.drawImage(img, 0, 0)
  return ctx.getImageData(0, 0, c.width, c.height)
}

/** Slim (Alex) skins leave the outer column of each front arm transparent */
export function detectSlim(img: HTMLImageElement): boolean {
  if (img.naturalHeight !== 64) return false
  const d = pixels(img)
  for (let y = 20; y < 32; y++) {
    for (const x of [54, 55]) {
      if (d.data[(y * 64 + x) * 4 + 3] !== 0) return false
    }
  }
  return true
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(b => {
      if (!b) return reject(new Error("Couldn't convert the image."))
      b.arrayBuffer().then(buf => resolve(new Uint8Array(buf)), reject)
    }, 'image/png')
  })
}

export interface TextureDraft<T extends Texture = Texture> {
  bytes: Uint8Array
  texture: T
}

/**
 * Minecraft draws the elytra from the cape texture: its wings are the 24×22 block at (22, 0)
 * of the 64×32 layout (scaled up in HD capes). Profile "elytra" textures are ignored in game.
 */
const WING = { x: 22, y: 0, w: 24, h: 22 }

function wingAreaEmpty(img: HTMLImageElement): boolean {
  const s = img.naturalWidth / 64
  const d = pixels(img)
  for (let y = WING.y * s; y < (WING.y + WING.h) * s; y++) {
    for (let x = WING.x * s; x < (WING.x + WING.w) * s; x++) {
      if (d.data[(y * img.naturalWidth + x) * 4 + 3] !== 0) return false
    }
  }
  return true
}

/**
 * A copy of the cape with its wing area replaced by `design`'s (an elytra texture in the
 * standard layout), or by plain wings when `design` is null.
 */
export async function capeWithWings(cape: HTMLImageElement, design: HTMLImageElement | HTMLCanvasElement | null): Promise<TextureDraft> {
  const { plainElytra } = await import('./defaultSkin')
  const src = design ?? plainElytra()
  const s = cape.naturalWidth / 64
  const ds = (src instanceof HTMLImageElement ? src.naturalWidth : src.width) / 64
  const c = document.createElement('canvas')
  c.width = cape.naturalWidth
  c.height = cape.naturalHeight
  const g = c.getContext('2d')!
  g.imageSmoothingEnabled = false
  g.drawImage(cape, 0, 0)
  g.clearRect(WING.x * s, WING.y * s, WING.w * s, WING.h * s)
  g.drawImage(src, WING.x * ds, WING.y * ds, WING.w * ds, WING.h * ds, WING.x * s, WING.y * s, WING.w * s, WING.h * s)
  return textureFromBytes(await canvasToPng(c), 'cape')
}

/**
 * Checks PNG bytes and loads them as a texture of the given kind, so problems
 * show before uploading. Old OptiFine-style 22×17 capes are padded to 64×32.
 */
export async function textureFromBytes(bytes: Uint8Array, kind: TextureKind): Promise<TextureDraft> {
  const label = kind === 'skin' ? 'Skins' : kind === 'cape' ? 'Capes' : 'Elytra textures'
  if (!PNG_SIG.every((b, i) => bytes[i] === b)) throw new Error(`${label} must be PNG images.`)
  const src = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'image/png' }))
  let image: HTMLImageElement
  try {
    image = await loadImage(src)
  } catch {
    URL.revokeObjectURL(src)
    throw new Error("That PNG couldn't be read.")
  }
  const { naturalWidth: w, naturalHeight: h } = image

  if (kind !== 'skin' && w === 22 && h === 17) {
    URL.revokeObjectURL(src)
    const c = document.createElement('canvas')
    c.width = 64
    c.height = 32
    c.getContext('2d')!.drawImage(image, 0, 0)
    return textureFromBytes(await canvasToPng(c), kind)
  }

  const ok = kind === 'skin'
    ? w === 64 && (h === 64 || h === 32)
    : BACK_SIZES.some(([bw, bh]) => w === bw && h === bh)
  if (!ok) {
    URL.revokeObjectURL(src)
    throw new Error(kind === 'skin'
      ? `Skins must be 64×64 or 64×32 pixels (this one is ${w}×${h}).`
      : `${label} must be 64×32 pixels, or HD like 128×64 (this one is ${w}×${h}).`)
  }
  if (bytes.length > MAX_BYTES[kind]) {
    URL.revokeObjectURL(src)
    throw new Error(`That file is too large (max ${MAX_BYTES[kind] / 1024} KB).`)
  }
  if (kind === 'skin') {
    const skin: Skin = { image, src, model: detectSlim(image) ? 'slim' : 'default' }
    return { bytes, texture: skin }
  }
  // Capes without wing art (like old 22×17 ones) would give invisible elytra in game
  if (kind === 'cape' && wingAreaEmpty(image)) {
    URL.revokeObjectURL(src)
    return capeWithWings(image, null)
  }
  return { bytes, texture: { image, src } }
}

export async function readTextureFile(file: File, kind: TextureKind): Promise<TextureDraft> {
  // Generous limit here: 22×17 capes get re-encoded, the real check is after loading
  if (file.size > 256 * 1024) throw new Error(`That file is too large (max ${MAX_BYTES[kind] / 1024} KB).`)
  return textureFromBytes(new Uint8Array(await file.arrayBuffer()), kind)
}

/** The raw PNG of a published texture, e.g. to re-upload a skin with a different arm style */
export async function fetchTextureBytes(src: string): Promise<Uint8Array> {
  const res = await fetch(src, { cache: 'force-cache' })
  if (!res.ok) throw new Error(`Skin server returned ${res.status}`)
  return new Uint8Array(await res.arrayBuffer())
}

interface ProfileJson {
  skins?: Record<string, string>
  cape?: string
  elytra?: string
}

/** Everything a player has published on the BSCraft server (all null for defaults) */
export async function fetchPublishedLook(username: string): Promise<Look> {
  if (!/^[A-Za-z0-9_]{3,16}$/.test(username)) return EMPTY_LOOK
  const res = await fetch(`${SKIN_ROOT}${username}.json`, { cache: 'no-store' })
  if (res.status === 404) return EMPTY_LOOK
  if (!res.ok) throw new Error(`Skin server returned ${res.status}`)
  const profile = await res.json() as ProfileJson
  const texture = async (id: string | undefined): Promise<Texture | null> => {
    if (!id || !/^[0-9a-f]{64}$/.test(id)) return null
    const src = `${SKIN_ROOT}textures/${id}`
    return { image: await loadImage(src, true), src }
  }
  const [model, skinId] = Object.entries(profile.skins ?? {})[0] ?? []
  const [skinTex, cape, elytra] = await Promise.all([texture(skinId), texture(profile.cape), texture(profile.elytra)])
  const skin: Skin | null = skinTex ? { ...skinTex, model: model === 'slim' ? 'slim' : 'default' } : null
  return { skin, cape, elytra }
}
