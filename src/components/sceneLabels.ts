// ============================================================
// sceneLabels.ts — Name tags and speech bubbles for the players in the
// Play screen. They're drawn on a full-resolution layer above the
// scene, so they can be smaller than the scene's chunky pixels while
// staying crisp: one art pixel is `unit` device pixels.
// ============================================================

import type { Icon } from './sceneProps'

/** Device pixels per art pixel for this display: an integer near 1.6 CSS pixels */
export function labelUnit(dpr: number): number {
  return Math.max(1, Math.round(dpr * 1.6))
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d')!
  g.imageSmoothingEnabled = false
  return [c, g]
}

// ── Name tags ────────────────────────────────────────────────
// A compact font for Minecraft names (letters, digits, underscore): capitals are
// 5 rows, lowercase 4, and descenders use a 6th row.

const TAG_FONT: Record<string, string[]> = {
  A: ['.#.', '#.#', '###', '#.#', '#.#'],
  B: ['##.', '#.#', '##.', '#.#', '##.'],
  C: ['.##', '#..', '#..', '#..', '.##'],
  D: ['##.', '#.#', '#.#', '#.#', '##.'],
  E: ['###', '#..', '##.', '#..', '###'],
  F: ['###', '#..', '##.', '#..', '#..'],
  G: ['.##', '#..', '#.#', '#.#', '.##'],
  H: ['#.#', '#.#', '###', '#.#', '#.#'],
  I: ['###', '.#.', '.#.', '.#.', '###'],
  J: ['..#', '..#', '..#', '#.#', '.#.'],
  K: ['#.#', '#.#', '##.', '#.#', '#.#'],
  L: ['#..', '#..', '#..', '#..', '###'],
  M: ['#...#', '##.##', '#.#.#', '#...#', '#...#'],
  N: ['#..#', '##.#', '#.##', '#..#', '#..#'],
  O: ['.#.', '#.#', '#.#', '#.#', '.#.'],
  P: ['##.', '#.#', '##.', '#..', '#..'],
  Q: ['.#.', '#.#', '#.#', '##.', '.##'],
  R: ['##.', '#.#', '##.', '#.#', '#.#'],
  S: ['.##', '#..', '.#.', '..#', '##.'],
  T: ['###', '.#.', '.#.', '.#.', '.#.'],
  U: ['#.#', '#.#', '#.#', '#.#', '.##'],
  V: ['#.#', '#.#', '#.#', '.#.', '.#.'],
  W: ['#...#', '#...#', '#.#.#', '##.##', '#...#'],
  X: ['#.#', '#.#', '.#.', '#.#', '#.#'],
  Y: ['#.#', '#.#', '.#.', '.#.', '.#.'],
  Z: ['###', '..#', '.#.', '#..', '###'],
  a: ['...', '##.', '.##', '#.#', '###'],
  b: ['#..', '##.', '#.#', '#.#', '##.'],
  c: ['...', '.##', '#..', '#..', '.##'],
  d: ['..#', '.##', '#.#', '#.#', '.##'],
  e: ['...', '.#.', '###', '#..', '.##'],
  f: ['..#', '.#.', '###', '.#.', '.#.'],
  g: ['...', '.##', '#.#', '.##', '..#', '##.'],
  h: ['#..', '##.', '#.#', '#.#', '#.#'],
  i: ['#', '.', '#', '#', '#'],
  j: ['..#', '...', '..#', '..#', '#.#', '.#.'],
  k: ['#..', '#.#', '##.', '##.', '#.#'],
  l: ['#', '#', '#', '#', '#'],
  m: ['.....', '####.', '#.#.#', '#.#.#', '#.#.#'],
  n: ['...', '##.', '#.#', '#.#', '#.#'],
  o: ['...', '.#.', '#.#', '#.#', '.#.'],
  p: ['...', '##.', '#.#', '##.', '#..', '#..'],
  q: ['...', '.##', '#.#', '.##', '..#', '..#'],
  r: ['...', '#.#', '##.', '#..', '#..'],
  s: ['...', '.##', '#..', '..#', '##.'],
  t: ['.#.', '###', '.#.', '.#.', '..#'],
  u: ['...', '#.#', '#.#', '#.#', '.##'],
  v: ['...', '#.#', '#.#', '#.#', '.#.'],
  w: ['.....', '#...#', '#...#', '#.#.#', '.#.#.'],
  x: ['...', '#.#', '.#.', '.#.', '#.#'],
  y: ['...', '#.#', '#.#', '.##', '..#', '##.'],
  z: ['...', '###', '..#', '.#.', '###'],
  0: ['###', '#.#', '#.#', '#.#', '###'],
  1: ['.#.', '##.', '.#.', '.#.', '###'],
  2: ['##.', '..#', '.#.', '#..', '###'],
  3: ['##.', '..#', '.#.', '..#', '##.'],
  4: ['#.#', '#.#', '###', '..#', '..#'],
  5: ['###', '#..', '##.', '..#', '##.'],
  6: ['.##', '#..', '###', '#.#', '###'],
  7: ['###', '..#', '.#.', '.#.', '.#.'],
  8: ['###', '#.#', '###', '#.#', '###'],
  9: ['###', '#.#', '###', '..#', '##.'],
  _: ['...', '...', '...', '...', '...', '###'],
  '-': ['...', '...', '###', '...', '...'],
  '.': ['.', '.', '.', '.', '#'],
  ' ': ['..', '..', '..', '..', '..'],
}
const TAG_ROWS = 6

const tags = new Map<string, HTMLCanvasElement>()

/** Minecraft-style tag: white pixel text on a see-through plate with softened corners */
export function nameTag(name: string, unit: number): HTMLCanvasElement {
  const key = `${name}|${unit}`
  const hit = tags.get(key)
  if (hit) return hit
  const glyphs = [...name].map(ch => TAG_FONT[ch] ?? TAG_FONT[ch.toUpperCase()] ?? TAG_FONT[' '])
  const width = glyphs.reduce((w, g) => w + g[0].length + 1, -1)
  const w = Math.max(1, width) + 4, h = TAG_ROWS + 2
  const [c, g] = canvas(w * unit, h * unit)
  const px = (x: number, y: number, pw = 1) => g.fillRect(x * unit, y * unit, pw * unit, unit)
  g.fillStyle = 'rgba(20, 12, 36, 0.45)'
  for (let y = 0; y < h; y++) {
    const inset = y === 0 || y === h - 1 ? 1 : 0
    px(inset, y, w - inset * 2)
  }
  g.fillStyle = '#ffffff'
  let cx = 2
  for (const glyph of glyphs) {
    glyph.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) if (row[x] === '#') px(cx + x, y + 1)
    })
    cx += glyph[0].length + 1
  }
  tags.set(key, c)
  return c
}

// ── Speech bubbles ───────────────────────────────────────────
// Little sticker-style icons: a base colour with a highlight and a darker
// edge, and a soft shade one pixel down-right, so they read as one set.

const ICONS: Record<Icon, { rows: string[]; colors: Record<string, string> }> = {
  heart: {
    rows: ['.rr.rr.', 'rwrrrrr', 'rrrrrrd', '.rrrrd.', '..rrd..', '...d...'],
    colors: { r: '#ff6b8b', w: '#ffd9e1', d: '#e0476c' },
  },
  star: {
    rows: ['...y...', '..yyy..', 'yywyyyy', '.yyyyy.', '..yyo..', '.yo.yo.', '.o...o.'],
    colors: { y: '#ffd04a', w: '#fff7d1', o: '#f0a030' },
  },
  note: {
    rows: ['..nnnnn', '..n...n', '..n...n', '.nn..nn', 'nnn.nnn', 'nn..nn.'],
    colors: { n: '#a07cff' },
  },
  excl: {
    rows: ['ee', 'ee', 'ee', 'ed', '..', 'ed'],
    colors: { e: '#ff8a4c', d: '#e0662c' },
  },
  quest: {
    rows: ['.qqq.', 'q...q', '...qd', '..qd.', '.....', '..q..'],
    colors: { q: '#5aa6ff', d: '#3f86e0' },
  },
  zzz: {
    rows: ['zzzz...', '..z....', '.z..zzz', 'zzzz.z.', '....zzz'],
    colors: { z: '#98a4ff' },
  },
  dots: {
    rows: ['dd.dd.dd', 'dd.dd.dd'],
    colors: { d: '#7a6c9e' },
  },
  tear: {
    rows: ['..t..', '..t..', '.ttt.', 'tttwt', 'ttwtt', '.tdt.'],
    colors: { t: '#6ab8ff', w: '#dff0ff', d: '#4a96e0' },
  },
  fish: {
    rows: ['...ff..', 't.ffff.', 'ttfffkf', 't.fwwf.', '...ff..'],
    colors: { f: '#ff9e45', t: '#e27a2a', k: '#3b2418', w: '#ffd6a8' },
  },
  sun: {
    rows: ['...s...', '.s...s.', '..wyy..', 's.yyy.s', '..yyy..', '.s...s.', '...s...'],
    colors: { s: '#ffa02a', y: '#ffd04a', w: '#fff3b8' },
  },
}

const OUTLINE = '#3b2a52' // the launcher's deep purple
const PAPER = '#fffaf4'
const PAPER_SHADE = '#f1e6f2'
const ICON_SHADE = 'rgba(59, 42, 82, 0.22)'

interface Bubble { canvas: HTMLCanvasElement; w: number; h: number; tip: number }
const bubbles = new Map<string, Bubble>()

/** A rounded bubble with its icon and a little tail pointing down from the middle */
function bubble(icon: Icon, unit: number, dots = 3): Bubble {
  const key = `${icon}|${unit}|${dots}`
  const hit = bubbles.get(key)
  if (hit) return hit
  const art = ICONS[icon]
  const rows = icon === 'dots' ? art.rows.map(r => r.slice(0, dots * 3 - 1).padEnd(r.length, '.')) : art.rows
  const iw = rows[0].length, ih = rows.length
  let w = Math.max(11, iw + 6)
  if (w % 2 === 0) w++
  const h = Math.max(9, ih + 5)
  const tip = (w - 1) / 2
  // +1 for the soft shadow, +2 for the tail
  const [c, g] = canvas((w + 1) * unit, (h + 3) * unit)
  const px = (x: number, y: number, pw = 1, ph = 1) => g.fillRect(x * unit, y * unit, pw * unit, ph * unit)

  const shape = (dx: number, dy: number, fill: string, edge: string) => {
    // Body with rounded corners and a one-pixel outline
    g.fillStyle = edge
    px(dx + 2, dy, w - 4); px(dx + 2, dy + h - 1, w - 4)
    px(dx, dy + 2, 1, h - 4); px(dx + w - 1, dy + 2, 1, h - 4)
    px(dx + 1, dy + 1); px(dx + w - 2, dy + 1); px(dx + 1, dy + h - 2); px(dx + w - 2, dy + h - 2)
    // Tail: a small V under the middle
    px(dx + tip - 2, dy + h - 1); px(dx + tip + 2, dy + h - 1)
    px(dx + tip - 1, dy + h); px(dx + tip + 1, dy + h)
    px(dx + tip, dy + h + 1)
    g.fillStyle = fill
    px(dx + 2, dy + 1, w - 4, h - 2); px(dx + 1, dy + 2, w - 2, h - 4)
    px(dx + tip - 1, dy + h - 1, 3); px(dx + tip, dy + h)
  }
  shape(1, 1, 'rgba(20, 10, 40, 0.2)', 'rgba(20, 10, 40, 0.2)')
  shape(0, 0, PAPER, OUTLINE)
  g.fillStyle = PAPER_SHADE
  px(2, h - 2, w - 4)
  px(tip - 1, h - 1, 3)

  // The icon, centred, over its soft shade
  const ox = Math.floor((w - iw) / 2), oy = Math.floor((h - 1 - ih) / 2)
  g.fillStyle = ICON_SHADE
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] !== '.') px(ox + x + 1, oy + y + 1)
  })
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const col = art.colors[row[x]]
      if (!col) continue
      g.fillStyle = col
      px(ox + x, oy + y)
    }
  })
  const b = { canvas: c, w, h, tip }
  bubbles.set(key, b)
  return b
}

/** A bubble's size in device pixels, tail included */
export function speechSize(icon: Icon, unit: number): { w: number; h: number } {
  const b = bubble(icon, unit)
  return { w: b.w * unit, h: (b.h + 2) * unit }
}

/**
 * Draws a bubble whose tail tip sits at (x, y) in device pixels. `age` and `life` are
 * in seconds: it hops up with a little overshoot, floats gently and fades out at the end.
 */
export function drawSpeech(ctx: CanvasRenderingContext2D, icon: Icon, x: number, y: number, unit: number, age: number, life: number) {
  const a = Math.min(1, age / 0.12, (life - age) / 0.3)
  if (a <= 0) return
  const b = bubble(icon, unit, icon === 'dots' ? 1 + (Math.floor(age * 3.5) % 3) : 3)
  // Rises from 4 art pixels low, overshoots by one, settles; then a slow float
  const t = Math.min(1, age / 0.32)
  const rise = 1 - Math.pow(1 - t, 3)
  const overshoot = Math.sin(t * Math.PI) * 1.2
  const float = Math.sin(age * 2.6) * 0.5
  const dy = (4 * (1 - rise) - overshoot + float) * unit
  ctx.globalAlpha = a
  ctx.drawImage(b.canvas, Math.round(x - (b.tip + 0.5) * unit), Math.round(y - (b.h + 2) * unit + dy))
  ctx.globalAlpha = 1
}
