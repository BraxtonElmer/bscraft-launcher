// ============================================================
// BscLogo.tsx — The BSCraft logo: a Minecraft grass block with pixel
// "BSC" on the dirt. Same texture as the app icon, drawn as SVG so it
// stays crisp at any size.
// ============================================================

import { memo, useId } from 'react'
import { layoutPixelText } from './PixelText'

// 16×16 grass block side: grass dripping over dirt with the odd stone
const TEXTURE = [
  'ggghgghhahaahaga',
  'aghhgaggahahaagg',
  'hhhgagaggggghgag',
  'ghghkgkggkgakggh',
  'hdkadkegkdhgekgd',
  'eddkeddgddfhedke',
  'ddfdddehdddpddef',
  'epddddedfedfdefd',
  'deffdddddefdddde',
  'effdedfddedfdded',
  'dfdpdeedeeedfddf',
  'edfddddeedddfddd',
  'deededfdpdddeded',
  'dddddpddddddpeed',
  'deeddeedddddedfd',
  'fddeddepeefdfdfp',
]
const COLORS: Record<string, string> = {
  a: '#9ad65f', g: '#7cbd4a', h: '#62a13b', k: '#4a7f2e',
  d: '#8b5a3b', e: '#6e4630', f: '#a2714b', p: '#8d8a88',
}

// Drawing units: 18 per texel, so the text can sit on a finer grid than the block
const T = 18
const SIZE = 16 * T
const K = 12 // units per font pixel
const TEXT = layoutPixelText('BSC')
const TX = Math.floor((SIZE - (TEXT.width + 1) * K) / 2)
const TY = Math.round(SIZE * 0.66 - 4 * K)

export const BscLogo = memo(function BscLogo({ size = 48, className }: { size?: number; className?: string }) {
  const id = useId().replace(/:/g, '')
  return (
    <svg className={className} width={size} height={size} viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label="BSCraft">
      <defs>
        <clipPath id={`bsc-clip-${id}`}>
          <rect width={SIZE} height={SIZE} rx={SIZE * 0.16} />
        </clipPath>
        <linearGradient id={`bsc-light-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.16" />
          <stop offset="0.45" stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.22" />
        </linearGradient>
      </defs>
      <g clipPath={`url(#bsc-clip-${id})`}>
        <g shapeRendering="crispEdges">
          {TEXTURE.flatMap((row, y) =>
            [...row].map((c, x) => <rect key={`${x}-${y}`} x={x * T} y={y * T} width={T} height={T} fill={COLORS[c]} />),
          )}
        </g>
        <rect width={SIZE} height={SIZE} fill={`url(#bsc-light-${id})`} />
        <g shapeRendering="crispEdges" transform={`translate(${TX} ${TY}) scale(${K})`}>
          <g fill="#2e1b10" fillOpacity="0.82" transform="translate(1 1)">
            {TEXT.runs.map((r, i) => <rect key={i} x={r.x} y={r.y} width={r.w} height={1} />)}
          </g>
          <g fill="#fff6e0">
            {TEXT.runs.map((r, i) => <rect key={i} x={r.x} y={r.y} width={r.w} height={1} />)}
          </g>
        </g>
      </g>
      <rect x="2" y="2" width={SIZE - 4} height={SIZE - 4} rx={SIZE * 0.16 - 2} fill="none" stroke="#2b1a10" strokeOpacity="0.55" strokeWidth="4" />
    </svg>
  )
})
