// ============================================================
// sceneProps.ts — The places and things online players use in the
// Play screen's landscape: a pond with waves, fish, a lily pad and a
// frog; a campfire; picnic things; a jukebox; fishing buckets; a
// gravestone and the angel who comes for it; speech bubbles.
//
// Everything is in world overlay pixels (the front ground layer at
// twice the scene's resolution) unless it says otherwise.
// ============================================================

import type { LifeEnv } from './sceneLife'

export interface Light {
  /** Brightness multiplier (1 = full daylight) */
  light: number
  tint: string
  tintAmt: number
  /** Dark enough for fires to glow */
  night: boolean
}

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]
const rand = (a: number, b: number) => a + Math.random() * (b - a)

/** A colour lit for the time of day, matching the terrain and mobs */
export function litRGB(hex: string, light: Light): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  const t = parseInt(light.tint.slice(1), 16)
  const ch = (shift: number) => {
    const v = ((n >> shift) & 255) * Math.min(1, light.light)
    return Math.round(v + (((t >> shift) & 255) - v) * light.tintAmt)
  }
  return [ch(16), ch(8), ch(0)]
}

export function lit(hex: string, light: Light, alpha = 1): string {
  const [r, g, b] = litRGB(hex, light)
  return alpha < 1 ? `rgba(${r},${g},${b},${alpha})` : `rgb(${r},${g},${b})`
}

export function drawRows(g: CanvasRenderingContext2D, rows: string[], colors: Record<string, string>, x: number, y: number, flip = false) {
  const w = rows[0].length
  rows.forEach((row, ry) => {
    for (let rx = 0; rx < w; rx++) {
      const col = colors[row[rx]]
      if (!col) continue
      g.fillStyle = col
      g.fillRect(x + (flip ? w - 1 - rx : rx), y + ry, 1, 1)
    }
  })
}

// ── Where things go ──────────────────────────────────────────

/** Ground surface (overlay px) at overlay x */
export function groundAt(env: LifeEnv, x: number): number {
  const g = env.groundTop
  return g[Math.max(0, Math.min(g.length - 1, Math.floor(x / 2)))] * 2
}

/**
 * Where the pond sits, in the scene's own (¼-res) units: five blocks on the flattest
 * stretch, the same for every time of day. PixelScene tells the mobs to keep out of it.
 */
export function pondSpot(groundTop: number[], W: number, PAD: number): { x0: number; x1: number } {
  const WIDTH = 20
  let best = PAD + Math.round(W * 0.3 / 4) * 4
  let bestScore = Infinity
  for (let x0 = Math.ceil((PAD + W * 0.1) / 4) * 4; x0 + WIDTH <= PAD + W * 0.88; x0 += 4) {
    let lo = Infinity, hi = -Infinity
    for (let x = x0 - 10; x < x0 + WIDTH + 10; x++) {
      const y = groundTop[Math.max(0, Math.min(groundTop.length - 1, x))]
      lo = Math.min(lo, y)
      hi = Math.max(hi, y)
    }
    const score = (hi - lo) * 10 + Math.abs(x0 + WIDTH / 2 - (PAD + W * 0.3)) * 0.05
    if (score < bestScore) { bestScore = score; best = x0 }
  }
  return { x0: best, x1: best + WIDTH }
}

/** The flattest stretch `half` wide either side in [from, to], away from the `avoid` ranges */
export function flatSpot(env: LifeEnv, half: number, from: number, to: number, avoid: [number, number][], prefer: number): number {
  let best = (from + to) / 2
  let bestScore = Infinity
  for (let c = Math.ceil(from + half); c <= to - half; c += 2) {
    if (avoid.some(([a, b]) => c + half > a && c - half < b)) continue
    let lo = Infinity, hi = -Infinity
    for (let x = c - half; x <= c + half; x += 2) {
      const y = groundAt(env, x)
      lo = Math.min(lo, y)
      hi = Math.max(hi, y)
    }
    const score = (hi - lo) * 3 + Math.abs(c - prefer) * 0.02
    if (score < bestScore) { bestScore = score; best = c }
  }
  return Math.round(best)
}

/** A high, fairly level spot to watch the sun from */
export function hillSpot(env: LifeEnv, half: number, from: number, to: number, avoid: [number, number][]): number {
  let best = (from + to) / 2
  let bestScore = Infinity
  for (let c = Math.ceil(from + half); c <= to - half; c += 2) {
    if (avoid.some(([a, b]) => c + half > a && c - half < b)) continue
    let sum = 0, lo = Infinity, hi = -Infinity, n = 0
    for (let x = c - half; x <= c + half; x += 2) {
      const y = groundAt(env, x)
      sum += y; n++
      lo = Math.min(lo, y)
      hi = Math.max(hi, y)
    }
    const score = sum / n + (hi - lo) * 1.5
    if (score < bestScore) { bestScore = score; best = c }
  }
  return Math.round(best)
}

// ── Pond ─────────────────────────────────────────────────────

interface Fish { x: number; y: number; dir: 1 | -1; speed: number; t: number; color: string; target: number | null; gone: number }
interface Frog { x: number; y: number; state: 'pad' | 'bank' | 'hop'; t: number; from: [number, number]; to: [number, number]; toPad: boolean; dir: 1 | -1; puff: number }

export interface Pond {
  x0: number
  x1: number
  /** Resting water surface */
  level: number
  depth: number
  h: Float32Array
  v: Float32Array
  fish: Fish[]
  lily: { x: number; home: number }
  frog: Frog
  reeds: { x: number; h: number; ph: number }[]
  weeds: { x: number; h: number; ph: number }[]
  bubbles: { x: number; y: number }[]
  t: number
  nextDrip: number
  base: { key: string; canvas: HTMLCanvasElement } | null
}

const FISH_COLORS = ['#e8842a', '#a9b8c6', '#e2707a', '#d9c34a']

export function createPond(env: LifeEnv, spot: { x0: number; x1: number }): Pond {
  const x0 = spot.x0 * 2, x1 = spot.x1 * 2
  let low = -Infinity
  for (let x = x0; x < x1; x++) low = Math.max(low, groundAt(env, x))
  const n = x1 - x0
  const pond: Pond = {
    x0, x1, level: low + 1, depth: 15,
    h: new Float32Array(n), v: new Float32Array(n),
    fish: [], lily: { x: x0 + n * 0.62, home: x0 + n * 0.62 },
    frog: { x: 0, y: 0, state: 'pad', t: rand(3, 8), from: [0, 0], to: [0, 0], toPad: true, dir: -1, puff: 0 },
    reeds: [
      { x: x0 - 3, h: 12, ph: 0 }, { x: x0 - 5, h: 9, ph: 1.3 }, { x: x0 + 1, h: 7, ph: 2.1 },
      { x: x1 + 2, h: 11, ph: 0.7 }, { x: x1 - 2, h: 8, ph: 2.6 },
    ],
    weeds: [
      { x: x0 + Math.round(n * 0.3), h: 6, ph: 0 }, { x: x0 + Math.round(n * 0.34), h: 4, ph: 1 },
      { x: x0 + Math.round(n * 0.72), h: 5, ph: 2 },
    ],
    bubbles: [], t: 0, nextDrip: 1, base: null,
  }
  for (let i = 0; i < 3; i++) {
    pond.fish.push({
      x: x0 + n * rand(0.25, 0.75), y: rand(5, 10), dir: Math.random() < 0.5 ? 1 : -1,
      speed: rand(3, 6), t: rand(0, 5), color: FISH_COLORS[i % FISH_COLORS.length], target: null, gone: 0,
    })
  }
  return pond
}

/** Water surface at x including waves, or null outside the pond */
export function surfaceAt(p: Pond, x: number): number | null {
  const i = Math.floor(x) - p.x0
  if (i < 0 || i >= p.h.length) return null
  return p.level - 1 + p.h[i]
}

/** The pond's bed: a rounded bowl dug into the ground */
export function bedAt(p: Pond, x: number): number | null {
  const n = p.x1 - p.x0
  const u = (x - p.x0 - n / 2 + 0.5) / (n / 2)
  if (u < -1 || u > 1) return null
  return Math.round(p.level + 1 + Math.max(2, p.depth * Math.pow(1 - Math.pow(Math.abs(u), 2.4), 0.55)))
}

export function inPond(p: Pond, x: number): boolean {
  return x >= p.x0 && x < p.x1
}

/** Something hits the water: waves spread out from it */
export function splash(p: Pond, x: number, force: number) {
  const c = Math.round(x) - p.x0
  const r = Math.min(8, 2 + Math.abs(force) * 0.8)
  for (let i = Math.floor(c - r); i <= c + r; i++) {
    if (i < 0 || i >= p.h.length) continue
    const k = 1 - Math.abs(i - c) / (r + 1)
    p.v[i] += force * 14 * k
  }
  // A big splash sends the frog hopping for the bank
  if (Math.abs(force) > 2 && p.frog.state === 'pad') p.frog.t = 0
}

/** Sends a fish to swim under x (the bobber); returns how many seconds it'll take */
export function lure(p: Pond, x: number): number {
  const f = p.fish.find(f => !f.gone && f.target === null) ?? p.fish[0]
  f.target = x
  return Math.min(6, Math.abs(f.x - x) / 6 + 1.2)
}

/** The fish under the bobber got caught: it's gone for a while */
export function catchFish(p: Pond, x: number) {
  const f = p.fish.find(f => f.target !== null && Math.abs(f.x - x) < 6)
  if (f) { f.gone = rand(8, 16); f.target = null }
}

export function stepPond(p: Pond, dt: number) {
  p.t += dt
  const n = p.h.length
  // Waves: a damped 1D wave equation, a few sub-steps per frame
  const steps = Math.ceil(dt * 120)
  const h = p.h, v = p.v
  for (let s = 0; s < steps; s++) {
    const d = dt / steps
    for (let i = 0; i < n; i++) {
      const l = h[Math.max(0, i - 1)], r = h[Math.min(n - 1, i + 1)]
      v[i] += ((l + r - 2 * h[i]) * 700 - v[i] * 3.2 - h[i] * 5) * d
    }
    for (let i = 0; i < n; i++) h[i] += v[i] * d
  }
  // Now and then a leaf or a fish dimples the surface, so it never looks frozen
  p.nextDrip -= dt
  if (p.nextDrip <= 0) {
    p.nextDrip = rand(0.8, 2.2)
    splash(p, p.x0 + rand(4, n - 4), rand(-0.5, 0.5))
  }

  for (const f of p.fish) {
    if (f.gone > 0) {
      f.gone -= dt
      if (f.gone <= 0) { f.x = p.x0 + n * rand(0.3, 0.7); f.y = 12 }
      continue
    }
    f.t += dt
    const lo = p.x0 + 5, hi = p.x1 - 6
    if (f.target !== null) {
      const d = f.target - f.x
      f.dir = d >= 0 ? 1 : -1
      f.x += Math.sign(d) * Math.min(Math.abs(d), 7 * dt)
      f.y += (4 - f.y) * Math.min(1, dt * 2)
    } else {
      f.x += f.dir * f.speed * dt * (0.6 + 0.4 * Math.sin(f.t * 1.3))
      if (f.x < lo) f.dir = 1
      if (f.x > hi) f.dir = -1
      if (Math.random() < dt * 0.15) f.dir = f.dir === 1 ? -1 : 1
      f.y += Math.sin(f.t * 0.9) * dt * 1.5
    }
    const bed = bedAt(p, f.x) ?? p.level + 6
    f.y = Math.max(3, Math.min(bed - p.level - 3, f.y))
  }

  if (Math.random() < dt * 0.5) {
    const x = p.x0 + rand(6, n - 6)
    p.bubbles.push({ x, y: (bedAt(p, x) ?? p.level + 6) - 2 })
  }
  for (const b of p.bubbles) b.y -= dt * 9
  p.bubbles = p.bubbles.filter(b => b.y > p.level + 1)

  // The lily pad drifts a little around its spot
  p.lily.x = p.lily.home + Math.sin(p.t * 0.21) * 4

  stepFrog(p, dt)
}

function stepFrog(p: Pond, dt: number) {
  const f = p.frog
  const padY = () => Math.round(surfaceAt(p, p.lily.x + 3) ?? p.level) - 4
  const bank: [number, number] = [p.x1 + 5, p.level - 1]
  f.puff = Math.max(0, f.puff - dt)
  if (f.state === 'pad') {
    f.x = p.lily.x + 1
    f.y = padY()
  } else if (f.state === 'bank') {
    f.x = bank[0]
    f.y = bank[1] - 3
  }
  f.t -= dt
  if (f.state === 'hop') {
    const k = Math.min(1, 1 - f.t / 0.55)
    const tx = f.toPad ? p.lily.x + 1 : f.to[0]
    const ty = f.toPad ? padY() : f.to[1]
    f.x = f.from[0] + (tx - f.from[0]) * k
    f.y = f.from[1] + (ty - f.from[1]) * k - Math.sin(k * Math.PI) * 9
    if (f.t <= 0) {
      f.state = f.toPad ? 'pad' : 'bank'
      f.t = rand(4, 10)
      if (f.toPad) splash(p, f.x + 2, 0.8)
    }
    return
  }
  if (f.t <= 0) {
    // Hop between the lily pad and the bank, with the odd ribbit in between
    if (Math.random() < 0.4) {
      f.puff = 0.6
      f.t = rand(2, 5)
      return
    }
    f.from = [f.x, f.y]
    f.toPad = f.state === 'bank'
    f.to = f.toPad ? [p.lily.x + 1, padY()] : [bank[0], bank[1] - 3]
    f.dir = f.to[0] > f.x ? 1 : -1
    f.state = 'hop'
    f.t = 0.55
    if (!f.toPad) splash(p, f.x + 2, 0.6)
  }
}

const WATER = ['#5a9cf5', '#4a86e8', '#3d73d6', '#3262c2', '#2a52a8', '#23458f']

/** The pond's water body and bed, drawn under the players */
export function drawPondBack(ctx: CanvasRenderingContext2D, p: Pond, offX: number, offY: number, light: Light) {
  const key = `${light.light}|${light.tint}|${light.tintAmt}`
  if (!p.base || p.base.key !== key) p.base = { key, canvas: pondBase(p, light) }
  ctx.drawImage(p.base.canvas, p.x0 - 1 + offX, p.level - 2 + offY)

  // Swaying weed, pebbles are in the base
  const weed = lit('#3f8f4a', light)
  for (const w of p.weeds) {
    const bed = bedAt(p, w.x) ?? p.level + 6
    ctx.fillStyle = weed
    for (let k = 0; k < w.h; k++) {
      const sway = Math.round(Math.sin(p.t * 1.4 + w.ph + k * 0.5) * (k / w.h) * 1.3)
      ctx.fillRect(w.x + sway + offX, bed - 1 - k + offY, 1, 1)
    }
  }
  for (const f of p.fish) {
    if (f.gone > 0) continue
    drawFish(ctx, Math.round(f.x) + offX, Math.round(p.level + f.y) + offY, f.dir, lit(f.color, light), Math.floor(f.t * 6) % 2 === 0)
  }
  ctx.fillStyle = lit('#b8dcff', light)
  for (const b of p.bubbles) ctx.fillRect(Math.round(b.x) + offX, Math.round(b.y) + offY, 1, 1)
}

function drawFish(ctx: CanvasRenderingContext2D, x: number, y: number, dir: 1 | -1, color: string, wag: boolean) {
  const rows = wag ? ['t.bb.', 'tbbbk', 't.bb.'] : ['..bb.', 'tbbbk', '..bb.']
  drawRows(ctx, rows, { b: color, t: color, k: '#1d1d24' }, x - 2, y - 1, dir < 0)
}

function pondBase(p: Pond, light: Light): HTMLCanvasElement {
  const n = p.x1 - p.x0
  const c = document.createElement('canvas')
  c.width = n + 2
  c.height = p.depth + 8
  const g = c.getContext('2d')!
  const shades = WATER.map(h => lit(h, light))
  const clay = lit('#7a5a3e', light), sand = lit('#b89a68', light), pebble = lit('#8d8a86', light)
  for (let i = 0; i < n; i++) {
    const x = p.x0 + i
    const bed = bedAt(p, x)!
    const top = p.level - 1
    // Deeper water is darker, in dithered bands like the sky
    for (let y = top; y < bed; y++) {
      const v = ((y - top) / (p.depth + 1)) * (shades.length - 1)
      const lo = Math.floor(v)
      const band = v - lo > (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16 ? lo + 1 : lo
      g.fillStyle = shades[Math.min(shades.length - 1, band)]
      g.fillRect(i + 1, y - p.level + 2, 1, 1)
    }
    // Sandy bed with a clay edge under it, and a few pebbles
    g.fillStyle = sand
    g.fillRect(i + 1, bed - p.level + 2, 1, 1)
    g.fillStyle = clay
    g.fillRect(i + 1, bed - p.level + 3, 1, 2)
    if ((x * 7) % 11 === 0) {
      g.fillStyle = pebble
      g.fillRect(i + 1, bed - p.level + 1, 1, 1)
    }
  }
  return c
}

/** The water's surface, drawn over the players so anyone in the pond is in it, not on it */
export function drawPondFront(ctx: CanvasRenderingContext2D, p: Pond, offX: number, offY: number, light: Light) {
  const n = p.x1 - p.x0
  const [wr, wg, wb] = litRGB(WATER[1], light)
  const veil = `rgba(${wr},${wg},${wb},0.5)`
  const crest = lit('#7fb6ff', light)
  const foam = lit('#d8ecff', light)
  const top = p.level - 1
  for (let i = 0; i < n; i++) {
    const x = p.x0 + i
    const bed = bedAt(p, x)!
    const s = Math.round(top + p.h[i])
    // Anything below the surface looks underwater
    ctx.fillStyle = veil
    ctx.fillRect(x + offX, s + 1 + offY, 1, bed - s - 1)
    // A wave crest rising above the resting level
    if (s < top) {
      ctx.fillStyle = crest
      ctx.fillRect(x + offX, s + 1 + offY, 1, top - s)
    }
    const rough = Math.abs(p.v[i]) > 6
    ctx.fillStyle = rough ? foam : crest
    ctx.fillRect(x + offX, s + offY, 1, 1)
  }
  // Glints sliding along the surface
  ctx.fillStyle = foam
  for (let k = 0; k < 3; k++) {
    const gx = Math.floor((p.t * (5 + k * 2) + k * 17) % (n - 4)) + 2
    const s = Math.round(top + p.h[gx])
    ctx.fillRect(p.x0 + gx + offX, s + offY, 2, 1)
  }

  // Lily pad riding the waves, with a flower
  const lx = Math.round(p.lily.x)
  const ly = Math.round(surfaceAt(p, lx + 3) ?? top)
  ctx.fillStyle = lit('#3c8b3a', light)
  ctx.fillRect(lx + offX, ly - 1 + offY, 7, 1)
  ctx.fillStyle = lit('#2f6e2d', light)
  ctx.fillRect(lx + offX, ly + offY, 7, 1)
  ctx.fillStyle = lit('#f29ac2', light)
  ctx.fillRect(lx + 5 + offX, ly - 2 + offY, 1, 1)
  ctx.fillStyle = lit('#ffd24a', light)
  ctx.fillRect(lx + 6 + offX, ly - 2 + offY, 1, 1)

  // Frog
  const f = p.frog
  const frog = f.puff > 0 && Math.floor(f.puff * 8) % 2 === 0
    ? ['.e.e', 'gggg', 'gppg']
    : ['.e.e', 'gggg', 'g..g']
  drawRows(ctx, frog, { e: lit('#3a2a1a', light), g: lit('#5aa73c', light), p: lit('#e9f2c8', light) }, Math.round(f.x) + offX, Math.round(f.y) + offY, f.dir < 0)
}

/** Reeds and cattails on the banks, swaying */
export function drawReeds(ctx: CanvasRenderingContext2D, p: Pond, offX: number, offY: number, light: Light) {
  const stalk = lit('#4f8f3a', light), tail = lit('#6b4526', light)
  for (const r of p.reeds) {
    const base = p.level - 1
    for (let k = 0; k < r.h; k++) {
      const sway = Math.round(Math.sin(p.t * 1.1 + r.ph) * (k / r.h) * 1.4)
      ctx.fillStyle = k >= r.h - 5 && k < r.h - 1 ? tail : stalk
      ctx.fillRect(r.x + sway + offX, base - k + offY, 1, 1)
    }
  }
}

// ── Campfire ─────────────────────────────────────────────────

export interface Fire { x: number; a: number; lit: boolean }

const FLAME = [
  ['...y....', '..yoy...', '..yoy.y.', '.yoroyo.', '.yorroy.', 'yorrrroy'],
  ['....y...', '...yoy..', '.y.yoy..', '.yoryoy.', '.yorroy.', 'yorrrroy'],
  ['...y.y..', '..yoyoy.', '..yooy..', '.yorroy.', 'yorrrooy', 'yorrrroy'],
  ['..y.....', '..yo.y..', '.yoyoy..', '.yorroy.', 'yorrroy.', 'yorrrroy'],
]
const FLAME_COLORS: Record<string, string> = { y: '#ffe066', o: '#ff9a1f', r: '#e8481a' }

export function drawFire(ctx: CanvasRenderingContext2D, fire: Fire, cx: number, base: number, now: number, light: Light) {
  const a = fire.a
  if (light.night && a > 0) {
    const flick = 0.85 + Math.sin(now * 0.013) * 0.07 + Math.sin(now * 0.031) * 0.04
    const glow = ctx.createRadialGradient(cx, base - 6, 2, cx, base - 6, 78)
    glow.addColorStop(0, `rgba(255,165,70,${(0.3 * flick * a).toFixed(3)})`)
    glow.addColorStop(1, 'rgba(255,140,40,0)')
    ctx.globalCompositeOperation = 'lighter'
    ctx.fillStyle = glow
    ctx.fillRect(cx - 78, base - 84, 156, 106)
    ctx.globalCompositeOperation = 'source-over'
  }
  // Ring of stones
  for (const [sx, h] of [[-11, 2], [-9, 3], [8, 3], [10, 2]] as [number, number][]) {
    ctx.fillStyle = lit('#7d7f88', light)
    ctx.fillRect(cx + sx, base - h, 2, h)
    ctx.fillStyle = lit('#a3a6af', light)
    ctx.fillRect(cx + sx, base - h, 2, 1)
  }
  // Logs, charred when it's out
  const warm = a > 0.2
  ctx.fillStyle = lit(warm ? '#6b4526' : '#4a3a2e', light)
  ctx.fillRect(cx - 7, base - 3, 14, 3)
  ctx.fillStyle = lit(warm ? '#8a5d34' : '#5b4a3c', light)
  ctx.fillRect(cx - 6, base - 5, 12, 2)
  ctx.fillStyle = lit('#2e2118', light)
  ctx.fillRect(cx - 7, base - 1, 14, 1)
  ctx.fillRect(cx - 3, base - 5, 1, 2)
  ctx.fillRect(cx + 3, base - 5, 1, 2)
  if (a <= 0.02) {
    ctx.fillStyle = lit('#9c9a97', light)
    ctx.fillRect(cx - 4, base - 6, 8, 1)
    return
  }
  // Embers glow on the logs; flames grow in as it's lit and shrink as it goes out
  ctx.fillStyle = `rgba(255,120,40,${(0.6 * a).toFixed(3)})`
  ctx.fillRect(cx - 5, base - 4, 10, 1)
  const frame = FLAME[Math.floor(now / 110) % FLAME.length]
  const rows = frame.slice(Math.round((1 - a) * frame.length))
  if (rows.length) drawRows(ctx, rows, FLAME_COLORS, cx - 4, base - 5 - rows.length)
}

// ── Picnic ───────────────────────────────────────────────────

export interface Picnic { x: number; half: number; a: number; dying: boolean; cake: number }

export function drawPicnic(ctx: CanvasRenderingContext2D, pk: Picnic, x: number, base: number, light: Light) {
  const k = Math.min(1, pk.a)
  const ease = 1 - Math.pow(1 - k, 3)
  // The blanket unrolls from the middle out
  const half = Math.round(pk.half * ease)
  const red = lit('#d9464f', light), white = lit('#f1ece4', light), redLo = lit('#a8323a', light), whiteLo = lit('#c9c2b7', light)
  for (let i = -half; i < half; i++) {
    const check = Math.floor((i + 100) / 2) % 2 === 0
    ctx.fillStyle = check ? red : white
    ctx.fillRect(x + i, base - 2, 1, 1)
    ctx.fillStyle = check ? whiteLo : redLo
    ctx.fillRect(x + i, base - 1, 1, 1)
  }
  if (k < 1) {
    // The rolled-up ends
    ctx.fillStyle = red
    ctx.fillRect(x - half - 3, base - 3, 3, 3)
    ctx.fillRect(x + half, base - 3, 3, 3)
    return
  }
  // Basket and a cake, a slice missing for every bite taken
  drawRows(ctx, ['..####..', '.#....#.', 'bbbbbbbb', 'bwbwbwbw', 'bbbbbbbb', '.bbbbbb.'],
    { '#': lit('#7a5230', light), b: lit('#b07a42', light), w: lit('#8a5a30', light) }, x - 12, base - 8)
  const slices = Math.max(0, 6 - pk.cake)
  const cake = ['wwrwwr', 'wwwwww', 'pppppp', 'bbbbbb']
  drawRows(ctx, cake.map(r => r.slice(0, slices).padEnd(6, '.')),
    { w: lit('#fbf7f0', light), r: lit('#e0303a', light), p: lit('#f2c0cf', light), b: lit('#b0703a', light) }, x + 5, base - 6)
}

// ── Jukebox ──────────────────────────────────────────────────

export interface Jukebox { x: number; a: number; dying: boolean }

export function drawJukebox(ctx: CanvasRenderingContext2D, jb: Jukebox, x: number, base: number, light: Light, beat: number) {
  const s = Math.min(1, jb.a)
  const h = Math.round(10 * (1 - Math.pow(1 - s, 3)))
  if (h <= 0) return
  const bounce = beat < 0.12 ? 1 : 0
  const top = base - h - bounce
  ctx.fillStyle = lit('#6b4526', light)
  ctx.fillRect(x - 5, top, 10, h + bounce)
  ctx.fillStyle = lit('#8a5d34', light)
  ctx.fillRect(x - 4, top + 1, 8, h - 2 + bounce)
  ctx.fillStyle = lit('#4a2f1a', light)
  ctx.fillRect(x - 5, top, 10, 1)
  ctx.fillStyle = '#1d1d24'
  ctx.fillRect(x - 2, top, 4, 1)
  ctx.fillStyle = lit('#63e0d8', light)
  if (h > 4) ctx.fillRect(x - 1, top + Math.round(h / 2), 2, 2)
}

// ── Fishing bucket ───────────────────────────────────────────

export function drawBucket(ctx: CanvasRenderingContext2D, x: number, base: number, fish: number, light: Light) {
  if (fish > 0) {
    ctx.fillStyle = lit('#e8842a', light)
    ctx.fillRect(x + 1, base - 7, 1, 2)
    ctx.fillRect(x, base - 8, 1, 1)
    ctx.fillRect(x + 2, base - 8, 1, 1)
  }
  drawRows(ctx, ['#bbbb#', '#wwww#', '.####.', '.####.', '..##..'],
    { '#': lit('#6d7078', light), b: lit('#4a86e8', light), w: lit('#3d73d6', light) }, x - 2, base - 5)
}

// ── Gravestone and angel ─────────────────────────────────────

const GRAVE = [
  '..######..',
  '.#======#.',
  '#===##===#',
  '#===##===#',
  '#=######=#',
  '#===##===#',
  '#===##===#',
  '#========#',
  '#========#',
  'mm======mm',
]

export function drawGrave(ctx: CanvasRenderingContext2D, x: number, base: number, rise: number, glow: number, light: Light) {
  const h = GRAVE.length
  const shown = Math.round(h * Math.min(1, rise))
  if (shown <= 0) return
  const colors = { '#': lit('#4f535f', light), '=': lit('#8f94a3', light), m: lit('#4f8f3a', light) }
  drawRows(ctx, GRAVE.slice(0, shown), colors, x - 5, base - shown)
  // A little flower in front
  if (rise >= 1) {
    ctx.fillStyle = lit('#4f8f3a', light)
    ctx.fillRect(x + 6, base - 2, 1, 2)
    ctx.fillStyle = lit('#e8649a', light)
    ctx.fillRect(x + 6, base - 3, 1, 1)
  }
  if (glow > 0) {
    ctx.globalAlpha = Math.min(1, glow)
    ctx.fillStyle = '#fff8dc'
    for (let r = 0; r < shown; r++) {
      const row = GRAVE[r]
      for (let i = 0; i < row.length; i++) if (row[i] !== '.') ctx.fillRect(x - 5 + i, base - shown + r, 1, 1)
    }
    ctx.globalAlpha = 1
  }
}

// Wings, attached at their left edge to the angel's back (mirrored for the left wing)
const WINGS = [
  ['......##', '....####', '..######', '.#######', '########', '#######.', '.####...', '..##....'],
  ['........', '..######', '.#######', '########', '########', '.######.', '..####..', '...##...'],
  ['........', '........', '########', '########', '#######.', '.######.', '..#####.', '...###..', '....##..'],
]

/** A little angel, facing out of the screen; (x, y) is the hem of the robe */
export function drawAngel(ctx: CanvasRenderingContext2D, x: number, y: number, t: number, arms: number, alpha: number) {
  ctx.globalAlpha = alpha
  const glow = ctx.createRadialGradient(x, y - 14, 2, x, y - 14, 30)
  glow.addColorStop(0, 'rgba(255,248,220,0.55)')
  glow.addColorStop(1, 'rgba(255,248,220,0)')
  ctx.fillStyle = glow
  ctx.fillRect(x - 30, y - 44, 60, 60)

  const frame = WINGS[Math.floor(t * 7) % WINGS.length]
  const wing = { '#': '#f7f9ff' }
  drawRows(ctx, frame, wing, x + 3, y - 20)
  drawRows(ctx, frame, wing, x - 11, y - 20, true)
  // Shade along the wings' lower feathers
  ctx.fillStyle = '#c9d8f2'
  ctx.fillRect(x + 4, y - 20 + frame.length - 2, 3, 1)
  ctx.fillRect(x - 7, y - 20 + frame.length - 2, 3, 1)

  // Robe
  for (let r = 0; r < 15; r++) {
    const half = 3 + Math.floor(r / 5)
    ctx.fillStyle = r === 5 ? '#f2c94c' : '#fbfaff'
    ctx.fillRect(x - half, y - 15 + r, half * 2, 1)
    ctx.fillStyle = r === 5 ? '#d9a93a' : '#dcdff0'
    ctx.fillRect(x + half - 1, y - 15 + r, 1, 1)
  }
  // Arms: at the sides, or raised as she works her magic
  ctx.fillStyle = '#fbfaff'
  const lift = Math.round(arms * 8)
  ctx.fillRect(x - 5, y - 14 - lift, 2, 6)
  ctx.fillRect(x + 3, y - 14 - lift, 2, 6)
  ctx.fillStyle = '#f6d2b4'
  ctx.fillRect(x - 5, y - 15 - lift + (arms > 0.5 ? 0 : 6), 2, 1)
  ctx.fillRect(x + 3, y - 15 - lift + (arms > 0.5 ? 0 : 6), 2, 1)

  // Head: golden hair, blue eyes, rosy cheeks
  drawRows(ctx, ['.hhhh.', 'hhhhhh', 'hssssh', 'sesses', 'pssssp', '.ssss.'],
    { h: '#f5d77a', s: '#f6d2b4', e: '#4a6fd8', p: '#f2a3b0' }, x - 3, y - 21)
  // Halo, bobbing
  const hy = y - 25 + Math.round(Math.sin(t * 3) * 0.6)
  drawRows(ctx, ['.####.', '#....#', '.####.'], { '#': '#ffd84a' }, x - 3, hy)
  ctx.globalAlpha = 1
}

/** Soft light pouring down from the sky onto x */
export function drawBeam(ctx: CanvasRenderingContext2D, x: number, bottom: number, a: number) {
  if (a <= 0) return
  const grad = ctx.createLinearGradient(0, 0, 0, bottom)
  grad.addColorStop(0, `rgba(255,246,214,${(0.05 * a).toFixed(3)})`)
  grad.addColorStop(1, `rgba(255,246,214,${(0.32 * a).toFixed(3)})`)
  ctx.globalCompositeOperation = 'lighter'
  ctx.fillStyle = grad
  ctx.fillRect(x - 9, 0, 18, bottom)
  ctx.fillStyle = `rgba(255,250,230,${(0.18 * a).toFixed(3)})`
  ctx.fillRect(x - 4, 0, 8, bottom)
  ctx.globalCompositeOperation = 'source-over'
}

// ── Speech bubbles ───────────────────────────────────────────

export type Icon = 'heart' | 'note' | 'excl' | 'quest' | 'zzz' | 'dots' | 'star' | 'tear' | 'fish' | 'sun'

const ICONS: Record<Icon, { rows: string[]; colors: Record<string, string> }> = {
  heart: { rows: ['.##.##.', '#######', '#######', '.#####.', '..###..', '...#...'], colors: { '#': '#ff4d6d' } },
  note: { rows: ['...###', '...#.#', '...#.#', '.###.#', '####..', '.##...'], colors: { '#': '#6a4cff' } },
  excl: { rows: ['..##...', '..##...', '..##...', '..##...', '.......', '..##...'], colors: { '#': '#ff5a3a' } },
  quest: { rows: ['.####.', '##..##', '...##.', '..##..', '......', '..##..'], colors: { '#': '#3a8dff' } },
  zzz: { rows: ['####...', '..#....', '.#.###.', '####.#.', '....#..', '....###'], colors: { '#': '#6b7aa8' } },
  dots: { rows: ['.......', '.......', '.......', '#.#.#..', '.......', '.......'], colors: { '#': '#4b4f5c' } },
  star: { rows: ['...#...', '..###..', '#######', '.#####.', '.##.##.', '#.....#'], colors: { '#': '#ffc93a' } },
  tear: { rows: ['...#...', '..###..', '.#####.', '.#####.', '..###..', '.......'], colors: { '#': '#4aa3ff' } },
  fish: { rows: ['.......', '#..###.', '######k', '#..###.', '.......', '.......'], colors: { '#': '#e8842a', k: '#1d1d24' } },
  sun: { rows: ['#..#..#', '..###..', '#######', '..###..', '#..#..#', '.......'], colors: { '#': '#ffb020' } },
}

/** A speech bubble with an icon; `pop` (0..1) is how far it has popped in */
export function drawBubble(ctx: CanvasRenderingContext2D, icon: Icon, x: number, y: number, pop: number, alpha: number) {
  const s = pop < 1 ? Math.max(0.3, 1 + Math.sin(pop * Math.PI) * 0.25 - (1 - pop) * 0.4) : 1
  const w = Math.round(11 * s), h = Math.round(9 * s)
  if (w < 3) return
  ctx.globalAlpha = alpha
  const bx = x - Math.round(w / 2), by = y - h
  ctx.fillStyle = '#2b2440'
  ctx.fillRect(bx + 1, by, w - 2, h)
  ctx.fillRect(bx, by + 1, w, h - 2)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(bx + 1, by + 1, w - 2, h - 2)
  // Tail pointing down at the speaker
  ctx.fillStyle = '#2b2440'
  ctx.fillRect(bx + 2, by + h, 2, 1)
  ctx.fillRect(bx + 2, by + h + 1, 1, 1)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(bx + 3, by + h - 1, 1, 1)
  if (s >= 0.95) {
    const ic = ICONS[icon]
    drawRows(ctx, ic.rows, ic.colors, bx + 2, by + 2)
  }
  ctx.globalAlpha = 1
}
