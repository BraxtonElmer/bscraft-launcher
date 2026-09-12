// ============================================================
// PixelScene.tsx — Procedural pixel-art landscape background.
//
// Rendered on a tiny canvas (¼ of the window) and scaled up with
// nearest-neighbour filtering, so it is cheap and looks like real
// pixel art. Static layers are generated once per time of day; each
// frame only composites them with drifting clouds, stars and a
// little mouse parallax. The loop stops entirely while paused
// (game running / other page / reduced motion).
// ============================================================

import { useEffect, useRef, useState } from 'react'
import { layoutPixelText } from './PixelText'
import {
  createLife, drawBirds, drawMobs, mobAt, pokeLife, stepLife,
  type Life, type LifeConfig, type ScenePointer,
} from './sceneLife'

export type Scenery = 'auto' | 'dawn' | 'day' | 'dusk' | 'night'
export type SceneTime = Exclude<Scenery, 'auto'>

export function resolveScenery(s: Scenery, date = new Date()): SceneTime {
  if (s !== 'auto') return s
  const h = date.getHours()
  if (h >= 5 && h < 8) return 'dawn'
  if (h >= 8 && h < 17) return 'day'
  if (h >= 17 && h < 20) return 'dusk'
  return 'night'
}

/** Current time of day for a scenery setting; re-evaluated every few minutes in auto mode */
export function useSceneTime(scenery: Scenery): SceneTime {
  const [time, setTime] = useState(() => resolveScenery(scenery))
  useEffect(() => {
    setTime(resolveScenery(scenery))
    if (scenery !== 'auto') return
    const id = window.setInterval(() => setTime(resolveScenery('auto')), 5 * 60_000)
    return () => window.clearInterval(id)
  }, [scenery])
  return time
}

// ── Palettes ─────────────────────────────────────────────────

interface Palette {
  sky: string[]                 // top → horizon
  stars: number                 // 0..1 density
  body: 'sun' | 'moon'
  bodyColor: string
  bodyPos: [number, number]     // fraction of width / height
  bodySize: number
  light: number                 // terrain brightness
  tint: string                  // colour the terrain is pulled towards
  tintAmt: number
  cloud: string
  cloudAlpha: number
  fireflies: boolean
  titleAccent: string           // colour of "BS" in the sky title
  titleDepth: string            // the title's extruded edge
  titleOutline: boolean         // dark outline so bright clouds/snow can't eat into the letters
  life: LifeConfig              // birds and mobs
}

const PALETTES: Record<SceneTime, Palette> = {
  night: {
    sky: ['#06041a', '#0c0829', '#140e3a', '#1f1449', '#2b1a57', '#3a2166'],
    stars: 1, body: 'moon', bodyColor: '#efe9ff', bodyPos: [0.8, 0.14], bodySize: 9,
    light: 0.42, tint: '#2a1f66', tintAmt: 0.35, cloud: '#b9a8ff', cloudAlpha: 0.1, fireflies: true,
    titleAccent: '#ff8fd6', titleDepth: '#3a1466', titleOutline: false,
    life: { birds: 0, bats: 1, batColor: '#584a90', mobs: ['zombie', 'skeleton', 'spider', 'fox', 'creeper'], maxMobs: 2 },
  },
  dusk: {
    sky: ['#170d3a', '#351657', '#5c1f6b', '#8f2c72', '#c94b72', '#f07f6c'],
    stars: 0.35, body: 'sun', bodyColor: '#ffc27a', bodyPos: [0.9, 0.36], bodySize: 12,
    light: 0.6, tint: '#6a2466', tintAmt: 0.3, cloud: '#ffb3c1', cloudAlpha: 0.32, fireflies: true,
    titleAccent: '#ff8fd6', titleDepth: '#3a1466', titleOutline: true,
    life: { birds: 0.6, bats: 0.4, mobs: ['sheep', 'pig', 'chicken', 'creeper'], maxMobs: 2 },
  },
  dawn: {
    sky: ['#1a2255', '#373a7e', '#624c98', '#a4669f', '#e18c9b', '#f9c29f'],
    stars: 0.12, body: 'sun', bodyColor: '#fff0c4', bodyPos: [0.12, 0.34], bodySize: 11,
    light: 0.72, tint: '#5a4a96', tintAmt: 0.25, cloud: '#ffe0e6', cloudAlpha: 0.45, fireflies: false,
    titleAccent: '#ff72c0', titleDepth: '#3a1466', titleOutline: true,
    life: { birds: 0.75, bats: 0, mobs: ['sheep', 'pig', 'chicken'], maxMobs: 2 },
  },
  day: {
    sky: ['#2f5fb3', '#3f72c4', '#5588d3', '#6f9fe0', '#90bbea', '#bcd9f3'],
    stars: 0, body: 'sun', bodyColor: '#fff8d8', bodyPos: [0.82, 0.13], bodySize: 10,
    light: 1, tint: '#9cc3ef', tintAmt: 0.08, cloud: '#ffffff', cloudAlpha: 0.85, fireflies: false,
    titleAccent: '#ff5fb4', titleDepth: '#4a1670', titleOutline: true,
    life: { birds: 1, bats: 0, mobs: ['sheep', 'pig', 'chicken'], maxMobs: 3 },
  },
}

// Daylight terrain colours; palettes darken/tint them
const BASE = {
  mountain: '#5a6485', mountainHi: '#7c88aa', snow: '#eef2fb',
  hill: '#3f7a48', hillHi: '#57985b', tree: '#2a5634',
  grass: '#5f9f42', grassHi: '#86c95a', dirt: '#79553a', dirtLo: '#5f4230',
  stone: '#6c6c78', stoneLo: '#575763', flowerA: '#f2d14a', flowerB: '#e8649a',
}

// ── Colour + noise helpers ───────────────────────────────────

type RGB = [number, number, number]
const toRgb = (h: string): RGB => {
  const n = parseInt(h.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
const css = ([r, g, b]: RGB) => `rgb(${r | 0},${g | 0},${b | 0})`

function sampleStops(stops: string[], t: number): RGB {
  const p = Math.min(Math.max(t, 0), 1) * (stops.length - 1)
  const i = Math.min(Math.floor(p), stops.length - 2)
  return mix(toRgb(stops[i]), toRgb(stops[i + 1]), p - i)
}

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function noise1d(seed: number) {
  const r = rng(seed)
  const pts = Array.from({ length: 256 }, () => r())
  return (x: number) => {
    const i = Math.floor(x)
    const f = x - i
    const a = pts[i & 255]
    const b = pts[(i + 1) & 255]
    return a + (b - a) * f * f * (3 - 2 * f)
  }
}

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return [c, c.getContext('2d')!]
}

// ── Scene generation ─────────────────────────────────────────

const PAD = 12 // horizontal overscan for parallax
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]

// Silhouettes for the hill layer: spruces of a few sizes and a round oak
const TREES = [
  ['..#..', '.###.', '.###.', '#####', '..#..'],
  ['...#...', '..###..', '.#####.', '..###..', '.#####.', '#######', '...#...'],
  ['...#...', '..###..', '..###..', '.#####.', '..###..', '.#####.', '#######', '..###..', '#######', '...#...'],
  ['.###.', '#####', '#####', '.###.', '..#..', '..#..'],
]

// ── Title ────────────────────────────────────────────────────
// "BSCRAFT" drawn into the world: every font pixel becomes a TITLE_SCALE
// block, with a short dark-violet depth and dithered haze towards the
// horizon at the bottom. It sits behind the far mountains, just low enough
// that the tallest peak overlaps its base.

const TITLE_SCALE = 3
const TITLE_DEPTH = 2
const TITLE_SINK = 5 // how far (canvas px) the tallest peak overlaps the letters
const TITLE_WORDS = ['BS', 'CRAFT'] // BS takes the palette's titleAccent, CRAFT is near-white
const TITLE_WHITE = '#fff4fa'

interface SceneTitle { canvas: HTMLCanvasElement; x: number; y: number }

function buildTitle(W: number, H: number, pal: Palette, horizon: RGB, tint: RGB, farTop: number[]): SceneTitle {
  const S = TITLE_SCALE
  // Face pixels in canvas coordinates, inset by 1 for the outline
  const tint2 = (hex: string) => mix(toRgb(hex), tint, pal.tintAmt * 0.3)
  const cells: { x: number; y: number; c: RGB }[] = []
  let ox = 0
  TITLE_WORDS.forEach((word, wi) => {
    const { runs, width } = layoutPixelText(word)
    const c = tint2(wi === 0 ? pal.titleAccent : TITLE_WHITE)
    for (const r of runs) for (let i = 0; i < r.w; i++) cells.push({ x: ox + r.x + i, y: r.y, c })
    ox += width + 1
  })
  const tw = (ox - 1) * S
  const th = 7 * S
  const GW = tw + TITLE_DEPTH + 2
  const GH = th + TITLE_DEPTH + 2

  // 0 = empty, 1 = face, 2 = depth
  const kind = new Uint8Array(GW * GH)
  const face: (RGB | null)[] = Array(GW * GH).fill(null)
  for (const cell of cells) {
    for (let yy = 0; yy < S; yy++) for (let xx = 0; xx < S; xx++) {
      const i = (cell.y * S + yy + 1) * GW + cell.x * S + xx + 1
      kind[i] = 1
      face[i] = cell.c
    }
  }
  for (let y = GH - 1; y >= 0; y--) for (let x = GW - 1; x >= 0; x--) {
    if (kind[y * GW + x]) continue
    for (let d = 1; d <= TITLE_DEPTH; d++) {
      if (x >= d && y >= d && kind[(y - d) * GW + x - d] === 1) { kind[y * GW + x] = 2; break }
    }
  }

  const [canvas, ctx] = makeCanvas(GW, GH)
  const img = ctx.createImageData(GW, GH)
  const depthCol = mix(toRgb(pal.titleDepth), tint, 0.2)
  const outlineCol = mix(depthCol, [8, 4, 16], 0.55)
  const STEP = 0.1
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
    const i = y * GW + x
    let c: RGB | null = null
    if (kind[i] === 1) {
      // Clean top half, fading towards the horizon colour near the base in dithered steps
      const v = (Math.max(0, (y - 1) / (th - 1) - 0.45) / 0.55) * 0.3 / STEP
      const lo = Math.floor(v)
      const step = v - lo > (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16 ? lo + 1 : lo
      c = mix(face[i]!, horizon, step * STEP)
    } else if (kind[i] === 2) {
      c = depthCol
    } else if (pal.titleOutline) {
      // 1px outline around face + depth keeps letter shapes readable over clouds and snow
      for (let dy = -1; dy <= 1 && !c; dy++) for (let dx = -1; dx <= 1 && !c; dx++) {
        const nx = x + dx, ny = y + dy
        if (nx >= 0 && ny >= 0 && nx < GW && ny < GH && kind[ny * GW + nx]) c = outlineCol
      }
    }
    if (!c) continue
    const o = i * 4
    img.data[o] = c[0]
    img.data[o + 1] = c[1]
    img.data[o + 2] = c[2]
    img.data[o + 3] = 255
  }
  ctx.putImageData(img, 0, 0)

  const x = Math.round((W - tw) / 2) - 1
  let peak = Infinity
  for (let sx = x; sx < x + tw; sx++) peak = Math.min(peak, farTop[sx + PAD] ?? Infinity)
  const y = Math.min(Math.max(Math.round(peak + TITLE_SINK - th), Math.round(H * 0.12)), Math.round(H * 0.3)) - 1
  return { canvas, x, y }
}

interface Star { x: number; y: number; b: number; sp: number; ph: number }
interface Cloud { x: number; y: number; w: number; speed: number; rects: [number, number, number, number][] }
interface Fly { x: number; y: number; ph: number; sp: number }

interface Scene {
  W: number
  H: number
  pal: Palette
  sky: HTMLCanvasElement
  far: HTMLCanvasElement
  mid: HTMLCanvasElement
  front: HTMLCanvasElement
  title: SceneTitle
  life: Life
  cloudLayer: [HTMLCanvasElement, CanvasRenderingContext2D]
  stars: Star[]
  clouds: Cloud[]
  flies: Fly[]
  shooting: { x: number; y: number; life: number } | null
  nextShooting: number
}

function buildScene(W: number, H: number, time: SceneTime): Scene {
  const pal = PALETTES[time]
  const horizon = toRgb(pal.sky[pal.sky.length - 1])
  const tint = toRgb(pal.tint)
  const shade = (hex: string, fog: number) => {
    const base = toRgb(hex).map(v => v * pal.light) as RGB
    return css(mix(mix(base, tint, pal.tintAmt), horizon, fog))
  }
  const LW = W + PAD * 2

  // Sky: banded gradient with ordered dithering between bands
  const [sky, sctx] = makeCanvas(W, H)
  const img = sctx.createImageData(W, H)
  const BANDS = 14
  const bands = Array.from({ length: BANDS + 1 }, (_, i) => sampleStops(pal.sky, i / BANDS))
  const skyEnd = H * 0.78
  for (let y = 0; y < H; y++) {
    const v = Math.min(y / skyEnd, 1) * BANDS
    const base = Math.floor(v)
    const frac = v - base
    for (let x = 0; x < W; x++) {
      const idx = frac > (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16 ? Math.min(base + 1, BANDS) : base
      const c = bands[idx]
      const o = (y * W + x) * 4
      img.data[o] = c[0]
      img.data[o + 1] = c[1]
      img.data[o + 2] = c[2]
      img.data[o + 3] = 255
    }
  }
  sctx.putImageData(img, 0, 0)

  // Far mountains
  const [far, fctx] = makeCanvas(LW, H)
  const n1 = noise1d(11), n2 = noise1d(29)
  const farCol = shade(BASE.mountain, 0.55)
  const farHi = shade(BASE.mountainHi, 0.5)
  const snow = shade(BASE.snow, 0.4)
  const farTop: number[] = []
  for (let x = 0; x < LW; x += 2) {
    const n = n1(x * 0.022) * 0.72 + n2(x * 0.09) * 0.28
    const top = Math.round((H * 0.3 + (1 - n) * H * 0.3) / 2) * 2
    farTop[x] = farTop[x + 1] = top
    fctx.fillStyle = farCol
    fctx.fillRect(x, top, 2, H - top)
    fctx.fillStyle = top < H * 0.42 ? snow : farHi
    fctx.fillRect(x, top, 2, top < H * 0.38 ? 3 : 1)
  }

  // Mid hills with spruce trees
  const [mid, mctx] = makeCanvas(LW, H)
  const n3 = noise1d(47), n4 = noise1d(83)
  const r = rng(5)
  const hillCol = shade(BASE.hill, 0.3)
  const hillHi = shade(BASE.hillHi, 0.28)
  const treeCol = shade(BASE.tree, 0.26)
  const hillTop: number[] = []
  for (let x = 0; x < LW; x += 3) {
    const n = n3(x * 0.03) * 0.7 + n4(x * 0.11) * 0.3
    const top = Math.round((H * 0.49 + (1 - n) * H * 0.13) / 3) * 3
    hillTop.push(top)
    mctx.fillStyle = hillCol
    mctx.fillRect(x, top, 3, H - top)
    mctx.fillStyle = hillHi
    mctx.fillRect(x, top, 3, 1)
  }
  mctx.fillStyle = treeCol
  for (let i = 1; i < hillTop.length - 1; i++) {
    if (r() > 0.32) continue
    const sprite = TREES[Math.floor(r() * TREES.length)]
    const w = sprite[0].length
    const x0 = i * 3 + 1 - (w >> 1)
    const y0 = hillTop[i] + 1 - sprite.length
    sprite.forEach((row, y) => {
      for (let x = 0; x < w; x++) if (row[x] === '#') mctx.fillRect(x0 + x, y0 + y, 1, 1)
    })
  }

  // Front: grass-block terrain on a 4px block grid
  const [front, gctx] = makeCanvas(LW, H)
  const n5 = noise1d(131), n6 = noise1d(173)
  const groundTop: number[] = []
  const c = {
    grass: shade(BASE.grass, 0), grassHi: shade(BASE.grassHi, 0),
    dirt: shade(BASE.dirt, 0), dirtLo: shade(BASE.dirtLo, 0),
    stone: shade(BASE.stone, 0), stoneLo: shade(BASE.stoneLo, 0),
    flowerA: shade(BASE.flowerA, 0), flowerB: shade(BASE.flowerB, 0),
  }
  for (let bx = 0; bx < LW; bx += 4) {
    const n = n5(bx * 0.02) * 0.75 + n6(bx * 0.09) * 0.25
    const top = Math.round((H * 0.62 + (1 - n) * H * 0.1) / 4) * 4
    for (let i = 0; i < 4; i++) groundTop[bx + i] = top
    for (let y = top; y < H; y++) {
      const d = y - top
      gctx.fillStyle = d < 1 ? c.grassHi : d < 3 ? c.grass : d < 14 ? c.dirt : c.stone
      gctx.fillRect(bx, y, 4, 1)
    }
    // Grass side overhang, dirt/stone speckles
    gctx.fillStyle = c.grass
    for (let i = 0; i < 4; i++) if (r() < 0.45) gctx.fillRect(bx + i, top + 3, 1, 1)
    for (let i = 0; i < 4; i++) {
      const sy = top + 4 + Math.floor(r() * (H - top - 4))
      gctx.fillStyle = sy - top < 14 ? c.dirtLo : c.stoneLo
      gctx.fillRect(bx + Math.floor(r() * 4), sy, 1, 1)
    }
    // Block seams
    gctx.fillStyle = 'rgba(0,0,0,0.09)'
    gctx.fillRect(bx, top + 4, 1, H - top - 4)
    for (let y = top + 4; y < H; y += 4) gctx.fillRect(bx, y, 4, 1)
    // Flowers and tufts on top
    const roll = r()
    if (roll < 0.14) {
      const fx = bx + 1 + Math.floor(r() * 2)
      gctx.fillStyle = r() < 0.5 ? c.flowerA : c.flowerB
      gctx.fillRect(fx, top - 2, 1, 1)
      gctx.fillStyle = c.grassHi
      gctx.fillRect(fx, top - 1, 1, 1)
    } else if (roll < 0.4) {
      gctx.fillStyle = c.grassHi
      gctx.fillRect(bx + Math.floor(r() * 4), top - 1, 1, 1)
    }
  }

  const stars: Star[] = Array.from({ length: Math.round(90 * pal.stars) }, () => ({
    x: Math.floor(r() * W),
    y: Math.floor(r() * H * 0.55),
    b: 0.35 + r() * 0.65,
    sp: 0.6 + r() * 2.2,
    ph: r() * Math.PI * 2,
  }))

  const clouds: Cloud[] = Array.from({ length: 6 }, () => {
    const w = 14 + Math.floor(r() * 22)
    const rects: Cloud['rects'] = [[0, 0, w, 3]]
    const bumps = 1 + Math.floor(r() * 3)
    for (let i = 0; i < bumps; i++) {
      const bw = 4 + Math.floor(r() * (w / 2))
      rects.push([Math.floor(r() * (w - bw)), -2, bw, 2])
    }
    return {
      x: Math.floor(r() * (W + 40)) - 20,
      y: Math.floor(H * 0.06 + r() * H * 0.28),
      w,
      speed: 0.5 + r() * 1.1,
      rects,
    }
  })

  const flies: Fly[] = pal.fireflies
    ? Array.from({ length: 12 }, () => ({
        x: r() * W,
        y: H * 0.5 + r() * H * 0.14,
        ph: r() * Math.PI * 2,
        sp: 0.4 + r() * 0.8,
      }))
    : []

  return {
    W, H, pal, sky, far, mid, front,
    title: buildTitle(W, H, pal, horizon, tint, farTop),
    life: createLife({
      W, H, PAD, groundTop,
      // Creatures are lit a little brighter than the terrain so they still read at night
      shade: hex => css(mix(toRgb(hex).map(v => v * Math.min(1, pal.light + 0.25)) as RGB, tint, pal.tintAmt * 0.7)),
      birdColor: css(mix(toRgb('#1f2433'), tint, Math.min(pal.tintAmt * 1.5, 0.6))),
      cfg: pal.life,
    }),
    cloudLayer: makeCanvas(W, H),
    stars, clouds, flies,
    shooting: null,
    nextShooting: 6000 + r() * 10000,
  }
}

// ── Per-frame drawing ────────────────────────────────────────

function drawBody(ctx: CanvasRenderingContext2D, s: Scene) {
  const { pal, W, H } = s
  const size = pal.bodySize
  const x = Math.round(W * pal.bodyPos[0] - size / 2)
  const y = Math.round(H * pal.bodyPos[1] - size / 2)
  ctx.fillStyle = pal.bodyColor
  ctx.globalAlpha = 0.06
  ctx.fillRect(x - 8, y - 8, size + 16, size + 16)
  ctx.globalAlpha = 0.12
  ctx.fillRect(x - 4, y - 4, size + 8, size + 8)
  ctx.globalAlpha = 1
  ctx.fillRect(x, y, size, size)
  if (pal.body === 'moon') {
    ctx.fillStyle = 'rgba(80,60,140,0.28)'
    ctx.fillRect(x + 2, y + 2, 2, 2)
    ctx.fillRect(x + 5, y + 5, 2, 1)
    ctx.fillRect(x + 6, y + 2, 1, 1)
  } else {
    ctx.fillStyle = 'rgba(255,255,255,0.45)'
    ctx.fillRect(x + 2, y + 2, size - 4, size - 4)
  }
}

function drawFrame(
  ctx: CanvasRenderingContext2D, s: Scene, now: number, dt: number, px: number, py: number, showTitle: boolean,
) {
  const { W, pal } = s
  // Creeper explosions shake the whole scene for a moment
  const shake = s.life.shake > 0
  if (shake) {
    ctx.save()
    ctx.translate(Math.round(Math.random() * 2 - 1), Math.round(Math.random() * 2 - 1))
  }
  ctx.drawImage(s.sky, 0, 0)

  for (const st of s.stars) {
    const a = st.b * (0.55 + 0.45 * Math.sin(now * 0.001 * st.sp + st.ph))
    ctx.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`
    ctx.fillRect(st.x, st.y, 1, 1)
  }

  // Occasional shooting star on starry skies
  if (pal.stars >= 0.3) {
    s.nextShooting -= dt * 1000
    if (!s.shooting && s.nextShooting <= 0) {
      s.shooting = { x: W * (0.2 + Math.random() * 0.5), y: 4 + Math.random() * 18, life: 1 }
      s.nextShooting = 9000 + Math.random() * 14000
    }
    if (s.shooting) {
      const sh = s.shooting
      sh.x += 70 * dt
      sh.y += 26 * dt
      sh.life -= dt * 1.4
      for (let i = 0; i < 6; i++) {
        ctx.fillStyle = `rgba(255,255,255,${(Math.max(sh.life, 0) * (1 - i / 6)).toFixed(3)})`
        ctx.fillRect(Math.round(sh.x - i * 2.7), Math.round(sh.y - i), 1, 1)
      }
      if (sh.life <= 0) s.shooting = null
    }
  }

  drawBody(ctx, s)

  // Flat, blocky clouds — drawn opaque offscreen, then composited once so overlaps don't stack
  const [cc, cctx] = s.cloudLayer
  cctx.clearRect(0, 0, cc.width, cc.height)
  cctx.fillStyle = pal.cloud
  const cloudOff = Math.round(px * 2)
  for (const cl of s.clouds) {
    cl.x += cl.speed * dt
    if (cl.x > W + 6) cl.x = -cl.w - 6
    for (const [rx, ry, rw, rh] of cl.rects) {
      cctx.fillRect(Math.round(cl.x + rx) + cloudOff, cl.y + ry, rw, rh)
    }
  }
  ctx.globalAlpha = pal.cloudAlpha
  ctx.drawImage(cc, 0, 0)
  ctx.globalAlpha = 1

  if (showTitle) ctx.drawImage(s.title.canvas, s.title.x + Math.round(px * 2), s.title.y + Math.round((py + 1) * 1))

  ctx.drawImage(s.far, -PAD + Math.round(px * 3), Math.round((py + 1) * 1))
  ctx.drawImage(s.mid, -PAD + Math.round(px * 6), Math.round((py + 1) * 1.5))
  drawBirds(ctx, s.life, px)

  for (const f of s.flies) {
    const a = 0.5 + 0.5 * Math.sin(now * 0.002 * f.sp + f.ph)
    const fx = Math.round(f.x + Math.sin(now * 0.0004 * f.sp + f.ph) * 6 + px * 8)
    const fy = Math.round(f.y + Math.cos(now * 0.0005 * f.sp + f.ph) * 3)
    // Plus-shaped glow reads as a soft light rather than a square at 4× scale
    ctx.fillStyle = `rgba(250,245,140,${(a * 0.18).toFixed(3)})`
    ctx.fillRect(fx - 1, fy, 3, 1)
    ctx.fillRect(fx, fy - 1, 1, 3)
    ctx.fillStyle = `rgba(255,252,190,${(a * 0.95).toFixed(3)})`
    ctx.fillRect(fx, fy, 1, 1)
  }

  ctx.drawImage(s.front, -PAD + Math.round(px * 10), Math.round((py + 1) * 2))
  drawMobs(ctx, s.life, px, py)
  if (shake) ctx.restore()
}

// ── Component ────────────────────────────────────────────────

const PIXEL = 4
const FRAME_MS = 1000 / 30

interface Props {
  time: SceneTime
  paused: boolean
  /** Draw the BSCRAFT title into the sky */
  title?: boolean
  className?: string
}

export function PixelScene({ time, paused, title = false, className }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sceneRef = useRef<{ time: SceneTime; scene: Scene } | null>(null)
  // tx/ty: parallax target, x/y: eased parallax, cx/cy: cursor in canvas pixels
  const pointer = useRef({ tx: 0, ty: 0, x: 0, y: 0, cx: 0, cy: 0, inside: false })

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const p = pointer.current
      // Inverted: pointing left slides the world right, like turning to look that way
      p.tx = 1 - (e.clientX / window.innerWidth) * 2
      p.ty = (e.clientY / window.innerHeight) * 2 - 1
      const c = canvasRef.current
      if (!c) return
      const r = c.getBoundingClientRect()
      p.inside = e.clientX >= r.left && e.clientX < r.right && e.clientY >= r.top && e.clientY < r.bottom
      p.cx = ((e.clientX - r.left) / r.width) * c.width
      p.cy = ((e.clientY - r.top) / r.height) * c.height
    }
    const onLeave = () => { pointer.current.inside = false }
    window.addEventListener('mousemove', onMove)
    document.documentElement.addEventListener('mouseleave', onLeave)
    return () => {
      window.removeEventListener('mousemove', onMove)
      document.documentElement.removeEventListener('mouseleave', onLeave)
    }
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const W = Math.ceil(canvas.clientWidth / PIXEL) || 221
    const H = Math.ceil(canvas.clientHeight / PIXEL) || 145
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W
      canvas.height = H
      sceneRef.current = null
    }
    if (!sceneRef.current || sceneRef.current.time !== time) {
      sceneRef.current = { time, scene: buildScene(W, H, time) }
    }
    const scene = sceneRef.current.scene
    const ctx = canvas.getContext('2d')!
    ctx.imageSmoothingEnabled = false

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const p = pointer.current
    let last = performance.now()

    if (paused || reduced) {
      drawFrame(ctx, scene, last, 0, p.x, p.y, title)
      return
    }

    // Birds and mobs react to the cursor: hovering a mob shows a pointer, clicking pets it
    const stage = canvas.parentElement
    let hovering = false
    const setHover = (on: boolean) => {
      if (on === hovering) return
      hovering = on
      stage?.classList.toggle('scene-hover', on)
    }
    const cursor = (): ScenePointer | null => (p.inside ? { x: p.cx, y: p.cy } : null)
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return
      const target = e.target as Element | null
      if (target?.closest('button, a, input, select, textarea, label, .dock, .callout, .titlebar, [class*="modal"], [class*="toast"]')) return
      const r = canvas.getBoundingClientRect()
      if (e.clientX < r.left || e.clientX >= r.right || e.clientY < r.top || e.clientY >= r.bottom) return
      const hit = { x: ((e.clientX - r.left) / r.width) * canvas.width, y: ((e.clientY - r.top) / r.height) * canvas.height }
      pokeLife(scene.life, hit, p.x, p.y)
    }
    window.addEventListener('pointerdown', onDown)

    let raf = 0
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop)
      if (now - last < FRAME_MS || document.hidden) return
      const dt = Math.min((now - last) / 1000, 0.1)
      last = now
      p.x += (p.tx - p.x) * 0.06
      p.y += (p.ty - p.y) * 0.06
      const at = cursor()
      stepLife(scene.life, dt, at, p.x, p.y)
      drawFrame(ctx, scene, now, dt, p.x, p.y, title)
      setHover(!!at && !!mobAt(scene.life, at, p.x, p.y))
    }
    drawFrame(ctx, scene, last, 0, p.x, p.y, title)
    raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('pointerdown', onDown)
      setHover(false)
    }
  }, [time, paused, title])

  return <canvas ref={canvasRef} className={`pixel-scene ${className ?? ''}`} aria-hidden />
}
