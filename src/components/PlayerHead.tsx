// ============================================================
// PlayerHead.tsx — 8×8 pixel-art head generated from the username.
// Offline accounts have no skin to fetch, so every name gets its
// own stable face instead.
// ============================================================

import { memo, useEffect, useRef } from 'react'
import { hashString } from '../lib/format'

const SKIN = ['#f3cfb3', '#e8b796', '#d49a74', '#b87a55', '#8d5a3b', '#63402a']
const HAIR = ['#2b1d14', '#4a2f1d', '#6e4424', '#a0692f', '#d9b45c', '#ece0b4', '#1f1f28', '#8a2f2f', '#c7cddb', '#7a4fc2', '#2f76c4', '#d8578a']
const EYES = ['#3b6fd8', '#2f8f5b', '#6b4a2f', '#8a63e0', '#35a8a0', '#2a2a36']

function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16)
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v * (1 + amount))))
  const r = ch((n >> 16) & 255), g = ch((n >> 8) & 255), b = ch(n & 255)
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`
}

// h = hair, s = skin, w = eye white, e = iris, n = nose, m = mouth, b = beard
const STYLES = [
  ['hhhhhhhh', 'hhhhhhhh', 'hsssssh.', 'ssssssss', 'swessews', 'sssnnsss', 'ssmmmmss', 'ssssssss'],
  ['hhhhhhhh', 'hhhhhhhh', 'hhhsshhh', 'ssssssss', 'swessews', 'sssnnsss', 'ssmmmmss', 'ssssssss'],
  ['hhhhhhhh', 'hhhhhhhh', 'hsssssss', 'hsssssss', 'hwessews', 'hssnnsss', 'hsmmmmss', 'hsssssss'],
  ['hhhhhhhh', 'hhhhhhhh', 'hhsssshh', 'hssssssh', 'hwessewh', 'hssnnssh', 'hsbmmbsh', 'hsbbbbsh'],
  ['hhhhhhhh', 'hsssssss', 'ssssssss', 'ssssssss', 'swessews', 'sssnnsss', 'sbmmmmbs', 'sbbbbbbs'],
]

interface Props {
  name: string
  size?: number
  dim?: boolean
  /** The player's real skin; when given, its face is shown instead of a generated one */
  skin?: HTMLImageElement | null
}

export const PlayerHead = memo(function PlayerHead({ name, size = 48, dim, skin }: Props) {
  if (skin) return <SkinFace image={skin} size={size} dim={dim} />
  return <GeneratedHead name={name} size={size} dim={dim} />
})

/** Draws a skin's face with its hat layer onto an 8×8 canvas */
function drawFace(canvas: HTMLCanvasElement, image: HTMLImageElement) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.imageSmoothingEnabled = false
  ctx.clearRect(0, 0, 8, 8)
  ctx.drawImage(image, 8, 8, 8, 8, 0, 0, 8, 8)
  ctx.drawImage(image, 40, 8, 8, 8, 0, 0, 8, 8)
}

function SkinFace({ image, size, dim }: { image: HTMLImageElement; size: number; dim?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => { if (ref.current) drawFace(ref.current, image) }, [image])
  return (
    <canvas
      ref={ref}
      width={8}
      height={8}
      className={`player-head${dim ? ' dim' : ''}`}
      style={{ width: size, height: size, imageRendering: 'pixelated' }}
      aria-hidden
    />
  )
}

/** The generated face for a name: its 8×8 pattern and the colours its letters stand for */
export function generatedFace(name: string) {
  const h = hashString(name.toLowerCase() || 'steve')
  const skin = SKIN[h % SKIN.length]
  const hair = HAIR[(h >>> 4) % HAIR.length]
  const eye = EYES[(h >>> 9) % EYES.length]
  const style = STYLES[(h >>> 13) % STYLES.length]

  const colors: Record<string, string> = {
    h: hair,
    s: skin,
    w: '#ffffff',
    e: eye,
    n: shade(skin, -0.14),
    m: shade(hair, -0.2),
    b: shade(hair, 0.08),
    '.': shade(skin, -0.06),
  }
  return { hash: h, skin, hair, style, colors, shade }
}

function GeneratedHead({ name, size, dim }: { name: string; size: number; dim?: boolean }) {
  const { skin, style, colors } = generatedFace(name)
  const cells: { x: number; y: number; c: string }[] = []
  style.forEach((row, y) => {
    for (let x = 0; x < 8; x++) cells.push({ x, y, c: colors[row[x] ?? 's'] ?? skin })
  })

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 8 8"
      shapeRendering="crispEdges"
      className={`player-head${dim ? ' dim' : ''}`}
      aria-hidden
    >
      {cells.map(({ x, y, c }) => <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={c} />)}
      {/* Top-left light, bottom-right shade for a bit of volume */}
      <rect x={0} y={0} width={8} height={1} fill="#fff" opacity={0.12} />
      <rect x={0} y={7} width={8} height={1} fill="#000" opacity={0.14} />
    </svg>
  )
}
