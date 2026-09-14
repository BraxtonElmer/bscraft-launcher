// ============================================================
// playerRagdoll.ts — Verlet ragdoll for players you pick up and throw.
//
// Seven points (head, neck, hip, both hands, both feet) held together
// by the body's proportions from playerRig. A pinned point follows the
// cursor while the rest dangles and kicks; let go and it keeps the
// throw's momentum, bounces off the blocky ground, splashes into water
// and slides to a stop.
// ============================================================

import { ARM, HEAD, LEG, SHOULDER, TORSO, joints, type Skel } from './playerRig'

export const HEAD_PT = 0, NECK = 1, HIP = 2, HAND_N = 3, HAND_F = 4, FOOT_N = 5, FOOT_F = 6

interface Pt { x: number; y: number; px: number; py: number; wet: boolean }

export interface Ragdoll {
  pts: Pt[]
  /** Index of the point held by the cursor, or -1 */
  pin: number
  pinX: number
  pinY: number
  t: number
  /** Seconds it has lain still */
  still: number
  /** Time not yet simulated, carried to the next frame */
  acc: number
}

export interface RagWorld {
  /** Solid ground under x (the pond's bed inside the pond) */
  floor: (x: number) => number
  /** Water surface at x, or null where there's no water */
  water: (x: number) => number | null
  left: number
  right: number
  /** A point hit the ground at this speed (px/s) */
  impact: (point: number, speed: number, x: number, y: number) => void
  /** A point went into the water at this speed */
  splash: (x: number, speed: number) => void
}

const STEP = 1 / 60
const GRAVITY = 520
const RADIUS = [3.5, 1.5, 1.5, 1, 1, 1, 1]
// Inverse masses: the trunk is heavier than the hands and feet
const INV = [1, 0.7, 0.6, 1.4, 1.4, 1.1, 1.1]

export function ragdollFromSkel(s: Skel, dir: 1 | -1, vx = 0, vy = 0): Ragdoll {
  const j = joints(s, { dir, front: false }, s.x, s.y)
  const at = (p: { x: number; y: number }): Pt => ({ x: p.x, y: p.y, px: p.x - vx * STEP, py: p.y - vy * STEP, wet: false })
  return {
    pts: [at(j.head), at(j.neck), at(j.hip), at(j.handN), at(j.handF), at(j.footN), at(j.footF)],
    pin: -1, pinX: 0, pinY: 0, t: 0, still: 0, acc: 0,
  }
}

/** The ragdoll as a pose, for drawing (and for blending out of it when they get up) */
export function skelFromRagdoll(r: Ragdoll, dir: 1 | -1): Skel {
  const p = r.pts
  const hip = p[HIP], neck = p[NECK]
  const bx = neck.x - hip.x, by = neck.y - hip.y
  const bodyA = Math.atan2(bx, -by)
  const headA = Math.atan2(p[HEAD_PT].x - neck.x, -(p[HEAD_PT].y - neck.y))
  const sh = { x: hip.x + bx * (SHOULDER / TORSO), y: hip.y + by * (SHOULDER / TORSO) }
  const hang = (from: { x: number; y: number }, to: Pt) => Math.atan2(-(to.x - from.x), to.y - from.y)
  return {
    x: hip.x, y: hip.y,
    body: bodyA * dir, head: headA * dir,
    armN: -hang(sh, p[HAND_N]) * dir, armF: -hang(sh, p[HAND_F]) * dir,
    legN: -hang(hip, p[FOOT_N]) * dir, legF: -hang(hip, p[FOOT_F]) * dir,
  }
}

/** Current velocity of a point, px/s */
export function pointVelocity(r: Ragdoll, i: number): { x: number; y: number } {
  const p = r.pts[i]
  return { x: (p.x - p.px) / STEP, y: (p.y - p.py) / STEP }
}

/** Lets go of the held point, giving it the throw's velocity */
export function throwRagdoll(r: Ragdoll, vx: number, vy: number) {
  if (r.pin < 0) return
  const p = r.pts[r.pin]
  p.px = p.x - vx * STEP
  p.py = p.y - vy * STEP
  r.pin = -1
  r.still = 0
}

export function stepRagdoll(r: Ragdoll, dt: number, world: RagWorld) {
  r.acc += dt
  const steps = Math.min(6, Math.floor(r.acc / STEP))
  // After a long hitch, drop what can't be caught up rather than fast-forwarding
  r.acc = steps === 6 ? 0 : r.acc - steps * STEP
  for (let s = 0; s < steps; s++) step(r, world)
}

function step(r: Ragdoll, world: RagWorld) {
  r.t += STEP
  const p = r.pts
  let moved = 0

  for (let i = 0; i < p.length; i++) {
    const q = p[i]
    if (i === r.pin) {
      q.px = q.x
      q.py = q.y
      q.x = r.pinX
      q.y = r.pinY
      continue
    }
    let vx = (q.x - q.px) * 0.995
    let vy = (q.y - q.py) * 0.995
    // Dangling from the cursor, they kick and flail
    if (r.pin >= 0 && i >= HAND_N) {
      vx += Math.sin(r.t * 17 + i * 1.7) * 0.05
      vy += Math.cos(r.t * 13 + i) * 0.03
    }
    const surface = world.water(q.x)
    const inWater = surface !== null && q.y > surface
    if (inWater) {
      if (!q.wet) {
        q.wet = true
        world.splash(q.x, vy / STEP)
      }
      vx *= 0.9
      vy *= 0.9
    } else if (surface === null || q.y < surface - 2) {
      q.wet = false
    }
    q.px = q.x
    q.py = q.y
    q.x += vx
    // Water holds up the head and trunk
    const g = inWater ? (i <= HIP ? -GRAVITY * 0.45 : GRAVITY * 0.3) : GRAVITY
    q.y += vy + g * STEP * STEP
    moved = Math.max(moved, Math.abs(vx) + Math.abs(vy))
  }

  for (let k = 0; k < 8; k++) {
    stick(r, NECK, HIP, TORSO)
    stick(r, HEAD_PT, NECK, HEAD / 2)
    apart(r, HEAD_PT, HIP, TORSO + 2)
    arm(r, HAND_N)
    arm(r, HAND_F)
    stick(r, FOOT_N, HIP, LEG)
    stick(r, FOOT_F, HIP, LEG)
    apart(r, FOOT_N, NECK, 7)
    apart(r, FOOT_F, NECK, 7)
    for (let i = 0; i < p.length; i++) if (i !== r.pin) collide(p[i], RADIUS[i], i, world)
  }

  r.still = r.pin < 0 && moved < 0.12 ? r.still + STEP : 0
}

function move(r: Ragdoll, i: number, dx: number, dy: number, share: number) {
  if (i === r.pin) return
  r.pts[i].x += dx * share
  r.pts[i].y += dy * share
}

function weights(r: Ragdoll, a: number, b: number): [number, number] {
  const wa = a === r.pin ? 0 : INV[a], wb = b === r.pin ? 0 : INV[b]
  const sum = wa + wb || 1
  return [wa / sum, wb / sum]
}

function stick(r: Ragdoll, a: number, b: number, len: number) {
  const pa = r.pts[a], pb = r.pts[b]
  const dx = pb.x - pa.x, dy = pb.y - pa.y
  const d = Math.hypot(dx, dy) || 0.001
  const diff = (d - len) / d
  const [wa, wb] = weights(r, a, b)
  move(r, a, dx * diff, dy * diff, wa)
  move(r, b, -dx * diff, -dy * diff, wb)
}

function apart(r: Ragdoll, a: number, b: number, min: number) {
  const pa = r.pts[a], pb = r.pts[b]
  if (Math.hypot(pb.x - pa.x, pb.y - pa.y) < min) stick(r, a, b, min)
}

/** Keeps a hand an arm's length from the shoulder (a point partway down the torso) */
function arm(r: Ragdoll, hand: number) {
  const p = r.pts
  const f = (TORSO - SHOULDER) / TORSO
  const sx = p[NECK].x + (p[HIP].x - p[NECK].x) * f
  const sy = p[NECK].y + (p[HIP].y - p[NECK].y) * f
  const h = p[hand]
  const dx = h.x - sx, dy = h.y - sy
  const d = Math.hypot(dx, dy) || 0.001
  const diff = (d - ARM) / d
  const wh = hand === r.pin ? 0 : INV[hand]
  const wb = r.pin === NECK || r.pin === HIP ? 0 : 0.5
  const sum = wh + wb || 1
  move(r, hand, -dx * diff, -dy * diff, wh / sum)
  move(r, NECK, dx * diff, dy * diff, (wb / sum) * (1 - f))
  move(r, HIP, dx * diff, dy * diff, (wb / sum) * f)
}

function collide(q: Pt, rad: number, i: number, world: RagWorld) {
  if (q.x < world.left + rad) { q.x = world.left + rad; q.px = q.x + Math.abs(q.x - q.px) * 0.5 }
  if (q.x > world.right - rad) { q.x = world.right - rad; q.px = q.x - Math.abs(q.x - q.px) * 0.5 }
  const floor = world.floor(q.x) - rad
  if (q.y <= floor) return
  const before = world.floor(q.px) - rad
  if (q.py <= before + 1.5 || floor >= before - 0.5) {
    // Landed on top: bounce a little, with friction along the ground
    const vy = q.y - q.py
    const vx = q.x - q.px
    if (vy > 1) world.impact(i, vy / STEP, q.x, q.y)
    q.y = floor
    q.py = q.y + vy * 0.28
    q.px = q.x - vx * 0.62
  } else {
    // Ran into the side of a higher block
    const vx = q.x - q.px
    q.x = q.px
    q.px = q.x + vx * 0.3
  }
}

/** Highest and lowest points, for picking the ragdoll up and placing its name tag */
export function ragdollTop(r: Ragdoll): number {
  return Math.min(...r.pts.map(p => p.y)) - 4
}
