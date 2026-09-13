// ============================================================
// BscMark.tsx — The small "BSC" mark at the top of the nav rail, in the
// same style as the BSCRAFT title in the sky: pixel letters, "BS" pink
// and "C" white, with a short dark-violet extruded edge.
// ============================================================

import { memo } from 'react'
import { layoutPixelText } from './PixelText'

const TEXT = layoutPixelText('BSC')
const DEPTH = 2
const ACCENT = '#ff8fd6'
const WHITE = '#fff4fa'
const EDGE = '#3a1466'
// "B" and "S" end before x = 12, where "C" starts
const C_START = 12

export const BscMark = memo(function BscMark({ scale = 3 }: { scale?: number }) {
  const w = TEXT.width + DEPTH
  const h = TEXT.rows + DEPTH
  const rects = (dx: number, dy: number, fill: (x: number) => string) =>
    TEXT.runs.map((r, i) => <rect key={i} x={r.x + dx} y={r.y + dy} width={r.w} height={1} fill={fill(r.x)} />)
  return (
    <svg width={w * scale} height={h * scale} viewBox={`0 0 ${w} ${h}`} shapeRendering="crispEdges" role="img" aria-label="BSCraft">
      {Array.from({ length: DEPTH }, (_, i) => DEPTH - i).map(d => <g key={d}>{rects(d, d, () => EDGE)}</g>)}
      {rects(0, 0, x => (x < C_START ? ACCENT : WHITE))}
    </svg>
  )
})
