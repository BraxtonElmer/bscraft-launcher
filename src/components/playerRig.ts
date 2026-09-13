// ============================================================
// playerRig.ts — An online player's body in the Play screen.
//
// Body parts are cut from the player's skin (front and side views,
// the outer layer, slim arms). A Skel says how they're posed, and
// drawSkel paints them pixel-exact at any angle, so a waving, sitting,
// swimming or tumbling player stays crisp.
//
// Units are overlay pixels: one skin pixel each.
// ============================================================

import { layoutPixelText } from './PixelText'

export interface OnlinePlayer {
  /** Empty for players the server doesn't name (they hid themselves from listings) */
  name: string
  skin: HTMLImageElement | HTMLCanvasElement
  slim: boolean
}

/** One face of a body part, plus its pixels so it can be rotated without smearing */
export interface Part {
  canvas: HTMLCanvasElement
  /** CSS colour per pixel (null = transparent); null if the skin can't be read back */
  pixels: (string | null)[] | null
}

export interface Rig {
  headF: Part; headBlink: Part; headR: Part; headL: Part
  bodyF: Part; bodyR: Part; bodyL: Part
  armRF: Part; armLF: Part; legRF: Part; legLF: Part
  /** Outer faces, seen on the near side */
  armR: Part; armL: Part; legR: Part; legL: Part
  /** Inner faces, shaded, seen past the body on the far side */
  armRIn: Part; armLIn: Part; legRIn: Part; legLIn: Part
  armW: number
  tag: HTMLCanvasElement | null
}

/**
 * A pose. x/y is the hip joint in world overlay pixels. Angles are radians as seen
 * facing right (facing left mirrors them): body and head lean forward for positive
 * values, limbs swing forward (0 hangs straight down, π points straight up).
 * In the front view limbs swing outwards and body/head tilt sideways instead.
 */
export interface Skel {
  x: number; y: number
  body: number; head: number
  armN: number; armF: number; legN: number; legF: number
}

export interface View { dir: 1 | -1; front: boolean }

export interface XY { x: number; y: number }

export interface Joints {
  hip: XY; neck: XY; head: XY; headTop: XY
  handN: XY; handF: XY; footN: XY; footF: XY
  /** Screen angle of each arm (0 = hanging down), for things held in the hands */
  armN: number; armF: number
}

// Body proportions, in skin pixels
export const TORSO = 12   // hip to neck
export const SHOULDER = 10 // hip to where the arms pivot
export const ARM = 10     // shoulder pivot to hand
export const LEG = 12     // hip to foot
export const HEAD = 8

export function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d')!
  g.imageSmoothingEnabled = false
  return [c, g]
}

export function buildRig(p: OnlinePlayer): Rig {
  const skin = p.skin
  const legacy = (skin instanceof HTMLImageElement ? skin.naturalHeight : skin.height) === 32
  const aw = p.slim && !legacy ? 3 : 4

  // One face of a body part: the base layer with the outer layer on top.
  // Old 64×32 skins have no left limbs or outer layers; their left limbs mirror the right ones.
  type P2 = [number, number]
  const face = (base: P2, over: P2 | null, w: number, h: number, mirror = false, shade = 0, edit?: (g: CanvasRenderingContext2D) => void): Part => {
    const [c, g] = makeCanvas(w, h)
    if (mirror) { g.translate(w, 0); g.scale(-1, 1) }
    g.drawImage(skin, base[0], base[1], w, h, 0, 0, w, h)
    if (over && !legacy) g.drawImage(skin, over[0], over[1], w, h, 0, 0, w, h)
    g.setTransform(1, 0, 0, 1, 0, 0)
    edit?.(g)
    if (shade) {
      g.globalCompositeOperation = 'source-atop'
      g.fillStyle = `rgba(0,0,0,${shade})`
      g.fillRect(0, 0, w, h)
    }
    return { canvas: c, pixels: readPixels(g, w, h) }
  }
  const IN = 0.35

  // Blinking: the eye row (row 4 on nearly every skin) takes the colours of the row below it
  const blink = (g: CanvasRenderingContext2D) => g.drawImage(g.canvas, 0, 5, 8, 1, 0, 4, 8, 1)

  return {
    headF: face([8, 8], [40, 8], 8, 8),
    headBlink: face([8, 8], [40, 8], 8, 8, false, 0, blink),
    headR: face([0, 8], [32, 8], 8, 8),
    headL: face([16, 8], [48, 8], 8, 8),
    bodyF: face([20, 20], [20, 36], 8, 12),
    bodyR: face([16, 20], [16, 36], 4, 12),
    bodyL: face([28, 20], [28, 36], 4, 12),
    armRF: face([44, 20], [44, 36], aw, 12),
    armR: face([40, 20], [40, 36], 4, 12),
    armRIn: face([44 + aw, 20], [44 + aw, 36], 4, 12, false, IN),
    legRF: face([4, 20], [4, 36], 4, 12),
    legR: face([0, 20], [0, 36], 4, 12),
    legRIn: face([8, 20], [8, 36], 4, 12, false, IN),
    ...(legacy
      ? {
          armLF: face([44, 20], null, aw, 12, true),
          armL: face([40, 20], null, 4, 12, true),
          armLIn: face([44 + aw, 20], null, 4, 12, true, IN),
          legLF: face([4, 20], null, 4, 12, true),
          legL: face([0, 20], null, 4, 12, true),
          legLIn: face([8, 20], null, 4, 12, true, IN),
        }
      : {
          armLF: face([36, 52], [52, 52], aw, 12),
          armL: face([36 + aw, 52], [52 + aw, 52], 4, 12),
          armLIn: face([32, 52], [48, 52], 4, 12, false, IN),
          legLF: face([20, 52], [4, 52], 4, 12),
          legL: face([24, 52], [8, 52], 4, 12),
          legLIn: face([16, 52], [0, 52], 4, 12, false, IN),
        }),
    armW: aw,
    tag: p.name ? nameTag(p.name) : null,
  }
}

function readPixels(g: CanvasRenderingContext2D, w: number, h: number): Part['pixels'] {
  try {
    const d = g.getImageData(0, 0, w, h).data
    const out: (string | null)[] = []
    for (let i = 0; i < w * h; i++) {
      const a = d[i * 4 + 3]
      out.push(a ? `rgba(${d[i * 4]},${d[i * 4 + 1]},${d[i * 4 + 2]},${(a / 255).toFixed(3)})` : null)
    }
    return out
  } catch {
    return null // a skin served without CORS: fall back to the canvas's own (softer) rotation
  }
}

/** Minecraft-style name tag: white pixel text on a see-through dark plate */
function nameTag(name: string): HTMLCanvasElement {
  const { runs, width } = layoutPixelText(name)
  const rows = Math.max(7, ...runs.map(r => r.y + 1))
  const [c, g] = makeCanvas(width + 4, rows + 2)
  g.fillStyle = 'rgba(0,0,0,0.3)'
  g.fillRect(0, 0, c.width, c.height)
  g.fillStyle = '#ffffff'
  for (const r of runs) g.fillRect(r.x + 2, r.y + 1, r.w, 1)
  return c
}

// ── Geometry ─────────────────────────────────────────────────

const up = (o: XY, len: number, a: number): XY => ({ x: o.x + Math.sin(a) * len, y: o.y - Math.cos(a) * len })
const down = (o: XY, len: number, a: number): XY => ({ x: o.x - Math.sin(a) * len, y: o.y + Math.cos(a) * len })
const across = (o: XY, len: number, a: number): XY => ({ x: o.x + Math.cos(a) * len, y: o.y + Math.sin(a) * len })

interface Layout extends Joints {
  bodyA: number; headA: number; legNA: number; legFA: number
  shN: XY; shF: XY; hipN: XY; hipF: XY
}

function layout(s: Skel, v: View, hip: XY, armW: number): Layout {
  if (v.front) {
    // Facing the screen: N is the player's right side (screen left)
    const bodyA = s.body
    const neck = up(hip, TORSO, bodyA)
    const sh = up(hip, SHOULDER, bodyA)
    const shN = across(sh, -(4 + armW / 2), bodyA), shF = across(sh, 4 + armW / 2, bodyA)
    const hipN = across(hip, -2, bodyA), hipF = across(hip, 2, bodyA)
    const armN = s.armN, armF = -s.armF, legNA = s.legN, legFA = -s.legF
    return {
      hip, neck, head: up(neck, HEAD / 2, s.head), headTop: up(neck, HEAD, s.head),
      handN: down(shN, ARM, armN), handF: down(shF, ARM, armF),
      footN: down(hipN, LEG, legNA), footF: down(hipF, LEG, legFA),
      armN, armF, bodyA, headA: s.head, legNA, legFA, shN, shF, hipN, hipF,
    }
  }
  const d = v.dir
  const bodyA = d * s.body
  const headA = d * s.head
  const neck = up(hip, TORSO, bodyA)
  const sh = up(hip, SHOULDER, bodyA)
  const armN = -d * s.armN, armF = -d * s.armF, legNA = -d * s.legN, legFA = -d * s.legF
  return {
    hip, neck, head: up(neck, HEAD / 2, headA), headTop: up(neck, HEAD, headA),
    handN: down(sh, ARM, armN), handF: down(sh, ARM, armF),
    footN: down(hip, LEG, legNA), footF: down(hip, LEG, legFA),
    armN, armF, bodyA, headA, legNA, legFA, shN: sh, shF: sh, hipN: hip, hipF: hip,
  }
}

/** Where a pose's joints are, for a hip drawn at (hx, hy) */
export function joints(s: Skel, v: View, hx: number, hy: number, armW = 4): Joints {
  return layout(s, v, { x: hx, y: hy }, armW)
}

// ── Drawing ──────────────────────────────────────────────────

/**
 * Draws a part rotated about a pivot, `top` pixels of it above the pivot.
 * Rotation samples the skin pixel by pixel (nearest neighbour); the canvas's
 * own rotation would smear the edges.
 */
export function blit(g: CanvasRenderingContext2D, part: Part, px: number, py: number, angle: number, top = 0) {
  const img = part.canvas
  const w = img.width, h = img.height
  const a = Math.atan2(Math.sin(angle), Math.cos(angle))
  if (Math.abs(a) < 0.03) {
    g.drawImage(img, Math.round(px - w / 2), Math.round(py - top))
    return
  }
  const pixels = part.pixels
  if (!pixels) {
    g.save()
    g.translate(px, py)
    g.rotate(a)
    g.drawImage(img, -w / 2, -top)
    g.restore()
    return
  }
  const cos = Math.cos(a), sin = Math.sin(a)
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const [cx, cy] of [[-w / 2, -top], [w / 2, -top], [-w / 2, h - top], [w / 2, h - top]]) {
    const x = cx * cos - cy * sin, y = cx * sin + cy * cos
    minX = Math.min(minX, x); maxX = Math.max(maxX, x)
    minY = Math.min(minY, y); maxY = Math.max(maxY, y)
  }
  const X0 = Math.floor(px + minX), X1 = Math.ceil(px + maxX)
  const Y0 = Math.floor(py + minY), Y1 = Math.ceil(py + maxY)
  for (let Y = Y0; Y < Y1; Y++) {
    const dy = Y + 0.5 - py
    for (let X = X0; X < X1; X++) {
      const dx = X + 0.5 - px
      const sx = Math.floor(dx * cos + dy * sin + w / 2)
      const sy = Math.floor(-dx * sin + dy * cos + top)
      if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue
      const col = pixels[sy * w + sx]
      if (!col) continue
      g.fillStyle = col
      g.fillRect(X, Y, 1, 1)
    }
  }
}

export interface DrawOpts {
  /** In side view, turn the head to look out of the screen */
  faceCam?: boolean
  blink?: boolean
  /** Draws whatever the player holds, just before the near arm goes over it */
  held?: (j: Joints) => void
}

/** Paints a posed player with the hip at (hx, hy) and returns where the joints ended up */
export function drawSkel(g: CanvasRenderingContext2D, r: Rig, s: Skel, v: View, hx: number, hy: number, o: DrawOpts = {}): Joints {
  const L = layout(s, v, { x: hx, y: hy }, r.armW)
  const face = o.blink ? r.headBlink : r.headF
  if (v.front) {
    blit(g, r.legRF, L.hipN.x, L.hipN.y, L.legNA)
    blit(g, r.legLF, L.hipF.x, L.hipF.y, L.legFA)
    blit(g, r.bodyF, hx, hy, L.bodyA, TORSO)
    blit(g, r.armRF, L.shN.x, L.shN.y, L.armN, 2)
    blit(g, r.armLF, L.shF.x, L.shF.y, L.armF, 2)
    blit(g, face, L.neck.x, L.neck.y, L.headA, HEAD)
    o.held?.(L)
    return L
  }
  // Side view: facing right shows the right side, with the left limbs' inner faces behind
  const right = v.dir === 1
  blit(g, right ? r.armLIn : r.armRIn, L.shF.x, L.shF.y, L.armF, 2)
  blit(g, right ? r.legLIn : r.legRIn, hx, hy, L.legFA)
  blit(g, right ? r.bodyR : r.bodyL, hx, hy, L.bodyA, TORSO)
  blit(g, right ? r.legR : r.legL, hx, hy, L.legNA)
  blit(g, o.faceCam ? face : right ? r.headR : r.headL, L.neck.x, L.neck.y, L.headA, HEAD)
  o.held?.(L)
  blit(g, right ? r.armR : r.armL, L.shN.x, L.shN.y, L.armN, 2)
  return L
}

// ── Pose maths ───────────────────────────────────────────────

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))

/** Moves pose `a` towards `b` by fraction t (angles take the short way round) */
export function blendSkel(a: Skel, b: Skel, t: number, tx = t): Skel {
  const ang = (p: number, q: number) => p + wrap(q - p) * t
  return {
    x: a.x + (b.x - a.x) * tx, y: a.y + (b.y - a.y) * t,
    body: ang(a.body, b.body), head: ang(a.head, b.head),
    armN: ang(a.armN, b.armN), armF: ang(a.armF, b.armF),
    legN: ang(a.legN, b.legN), legF: ang(a.legF, b.legF),
  }
}
