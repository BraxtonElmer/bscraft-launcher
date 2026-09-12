// ============================================================
// SkinView.tsx — Flat front/back render of a Minecraft skin.
// Draws each body part's face from the skin texture onto a small
// canvas scaled up without smoothing, including the outer layers
// (hat, jacket, sleeves, trousers) and slim arms. 64×32 skins have no
// left-limb textures, so those mirror the right limbs like in game.
// ============================================================

import { useEffect, useRef } from 'react'
import type { SkinModel } from '../lib/skin'

type Rect = [number, number, number, number] // x, y, w, h in the skin texture

interface Part {
  base: Rect
  overlay?: Rect
  /** Where the part goes in the 16×32 figure */
  at: [number, number]
  /** 64×32 skins: draw this other part's texture mirrored instead */
  legacyMirror?: Rect
}

function parts(view: 'front' | 'back', slim: boolean): Part[] {
  const aw = slim ? 3 : 4
  if (view === 'front') {
    return [
      { base: [8, 8, 8, 8], overlay: [40, 8, 8, 8], at: [4, 0] },
      { base: [20, 20, 8, 12], overlay: [20, 36, 8, 12], at: [4, 8] },
      { base: [44, 20, aw, 12], overlay: [44, 36, aw, 12], at: [4 - aw, 8] },
      { base: [36, 52, aw, 12], overlay: [52, 52, aw, 12], at: [12, 8], legacyMirror: [44, 20, aw, 12] },
      { base: [4, 20, 4, 12], overlay: [4, 36, 4, 12], at: [4, 20] },
      { base: [20, 52, 4, 12], overlay: [4, 52, 4, 12], at: [8, 20], legacyMirror: [4, 20, 4, 12] },
    ]
  }
  return [
    { base: [24, 8, 8, 8], overlay: [56, 8, 8, 8], at: [4, 0] },
    { base: [32, 20, 8, 12], overlay: [32, 36, 8, 12], at: [4, 8] },
    { base: [52 - (slim ? 1 : 0), 20, aw, 12], overlay: [52 - (slim ? 1 : 0), 36, aw, 12], at: [12, 8] },
    {
      base: [44 - (slim ? 1 : 0), 52, aw, 12], overlay: [60 - (slim ? 1 : 0), 52, aw, 12], at: [4 - aw, 8],
      legacyMirror: [52 - (slim ? 1 : 0), 20, aw, 12],
    },
    { base: [12, 20, 4, 12], overlay: [12, 36, 4, 12], at: [8, 20] },
    { base: [28, 52, 4, 12], overlay: [12, 52, 4, 12], at: [4, 20], legacyMirror: [12, 20, 4, 12] },
  ]
}

function drawFigure(ctx: CanvasRenderingContext2D, img: HTMLImageElement, view: 'front' | 'back', slim: boolean) {
  const legacy = img.naturalHeight === 32
  ctx.clearRect(0, 0, 16, 32)
  for (const p of parts(view, slim)) {
    const [dx, dy] = p.at
    if (legacy && p.legacyMirror) {
      const [sx, sy, w, h] = p.legacyMirror
      ctx.save()
      ctx.translate(dx + w, dy)
      ctx.scale(-1, 1)
      ctx.drawImage(img, sx, sy, w, h, 0, 0, w, h)
      ctx.restore()
      continue
    }
    const [sx, sy, w, h] = p.base
    ctx.drawImage(img, sx, sy, w, h, dx, dy, w, h)
    // 64×32 skins only have the hat as an outer layer
    if (p.overlay && (!legacy || p.overlay[1] < 32)) {
      const [ox, oy, ow, oh] = p.overlay
      ctx.drawImage(img, ox, oy, ow, oh, dx, dy, ow, oh)
    }
  }
}

interface Props {
  image: HTMLImageElement | null
  model: SkinModel
  view: 'front' | 'back'
  scale?: number
  className?: string
}

export function SkinView({ image, model, view, scale = 6, className }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const ctx = ref.current?.getContext('2d')
    if (!ctx) return
    ctx.imageSmoothingEnabled = false
    if (image) drawFigure(ctx, image, view, model === 'slim')
    else ctx.clearRect(0, 0, 16, 32)
  }, [image, model, view])
  return (
    <canvas
      ref={ref}
      width={16}
      height={32}
      className={className}
      style={{ width: 16 * scale, height: 32 * scale, imageRendering: 'pixelated' }}
      aria-label={`Skin ${view}`}
    />
  )
}

/** Draws the 8×8 face plus hat layer from a skin onto a canvas */
export function drawFace(canvas: HTMLCanvasElement, image: HTMLImageElement) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.imageSmoothingEnabled = false
  ctx.clearRect(0, 0, 8, 8)
  ctx.drawImage(image, 8, 8, 8, 8, 0, 0, 8, 8)
  ctx.drawImage(image, 40, 8, 8, 8, 0, 0, 8, 8)
}
