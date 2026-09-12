// ============================================================
// skin.ts — Reading, checking and fetching Minecraft skins.
// Published skins live on the BSCraft server in CustomSkinLoader's
// CustomSkinAPI format: /skins/<Name>.json -> /skins/textures/<sha256>.
// ============================================================

export type SkinModel = 'default' | 'slim'

export interface Skin {
  model: SkinModel
  image: HTMLImageElement
  /** Object URL or remote URL the image was loaded from */
  src: string
}

export const SKIN_ROOT = 'https://bscraft.zukashix.com/skins/'
export const MAX_SKIN_BYTES = 32 * 1024

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

/** Validates a picked file and loads it, so problems show before uploading */
export async function readSkinFile(file: File): Promise<{ bytes: Uint8Array; skin: Skin }> {
  if (file.size > MAX_SKIN_BYTES) throw new Error('That file is too large for a skin (max 32 KB).')
  const bytes = new Uint8Array(await file.arrayBuffer())
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (!sig.every((b, i) => bytes[i] === b)) throw new Error('Skins must be PNG images.')
  const src = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }))
  let image: HTMLImageElement
  try {
    image = await loadImage(src)
  } catch {
    URL.revokeObjectURL(src)
    throw new Error("That PNG couldn't be read.")
  }
  const { naturalWidth: w, naturalHeight: h } = image
  if (!(w === 64 && (h === 64 || h === 32))) {
    URL.revokeObjectURL(src)
    throw new Error(`Skins must be 64×64 or 64×32 pixels (this one is ${w}×${h}).`)
  }
  return { bytes, skin: { model: detectSlim(image) ? 'slim' : 'default', image, src } }
}

/** The skin a player has published on the BSCraft server, or null if they use the default */
export async function fetchPublishedSkin(username: string): Promise<Skin | null> {
  if (!/^[A-Za-z0-9_]{3,16}$/.test(username)) return null
  const res = await fetch(`${SKIN_ROOT}${username}.json`, { cache: 'no-store' })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Skin server returned ${res.status}`)
  const profile = await res.json() as { skins?: Record<string, string> }
  const entry = Object.entries(profile.skins ?? {})[0]
  if (!entry) return null
  const [model, hash] = entry
  const src = `${SKIN_ROOT}textures/${hash}`
  const image = await loadImage(src, true)
  return { model: model === 'slim' ? 'slim' : 'default', image, src }
}
