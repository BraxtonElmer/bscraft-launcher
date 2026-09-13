// ============================================================
// scenePlayers.ts — Who's online, living in the Play screen.
//
// Every player on the BSCraft server shows up in the landscape as a
// little figure cut from their actual skin (front and side views, the
// outer layer, slim arms), with a Minecraft name tag. A small director
// gets them doing things together depending on the time of day:
// sitting round a campfire, fishing at a pond, chasing a runaway
// chicken, or just wandering about. Click one and they wave back.
//
// Positions are in the scene's quarter-resolution world coordinates
// (the front ground layer, like the mobs); drawing happens on a
// half-resolution overlay so one skin pixel is one overlay pixel.
// ============================================================

import { layoutPixelText } from './PixelText'
import type { LifeEnv, ScenePointer } from './sceneLife'

export interface OnlinePlayer {
  /** Empty for players the server doesn't name (they hid themselves from listings) */
  name: string
  skin: HTMLImageElement | HTMLCanvasElement
  slim: boolean
}

export interface PartyLight {
  /** Brightness multiplier (1 = full daylight) */
  light: number
  tint: string
  tintAmt: number
  /** Dark enough for the campfire to glow */
  night: boolean
}

type Activity = 'campfire' | 'fishing' | 'chase' | 'wander'
type Pose = 'stand' | 'walk' | 'run' | 'sit' | 'fish' | 'wave'
type SlotPose = 'sit' | 'fish' | 'chase'

/** One face of a body part, plus its pixels so limbs can be rotated without smearing */
interface Part {
  canvas: HTMLCanvasElement
  /** CSS colour per pixel (null = transparent); null if the skin can't be read back */
  pixels: (string | null)[] | null
}

interface Rig {
  headF: Part; headR: Part; headL: Part
  bodyF: Part; bodyR: Part; bodyL: Part
  armRF: Part; armLF: Part; legRF: Part; legLF: Part
  /** Outer faces, seen on the near side */
  armR: Part; armL: Part; legR: Part; legL: Part
  /** Inner faces, shaded, seen past the body on the far side */
  armRIn: Part; armLIn: Part; legRIn: Part; legLIn: Part
  armW: number
  tag: HTMLCanvasElement | null
}

interface Slot { x: number; dir: 1 | -1; pose: SlotPose }

interface Figure {
  key: string
  skin: OnlinePlayer['skin']
  rig: Rig
  x: number
  dir: 1 | -1
  /** Turned to face the screen */
  front: boolean
  pose: Pose
  slot: Slot | null
  /** Where a wandering player is headed */
  target: number | null
  t: number
  idle: number
  wave: number
  jump: number
  jumpV: number
  leaving: boolean
  /** Seconds until a fish bites */
  bite: number
  reel: number
  /** How far the name tag is raised to clear its neighbours' tags */
  tagLift: number
}

interface Particle {
  x: number; y: number; vx: number; vy: number
  life: number; max: number
  kind: 'dot' | 'smoke' | 'heart' | 'fish'
  color: string
  gravity: number
}

/** A campfire or pond; fades in when an activity starts and out when it ends */
interface Prop { x: number; a: number; dying: boolean }

interface Chicken { x: number; dir: 1 | -1; hop: number; hopV: number; t: number; rest: number; flap: number }

export interface Party {
  env: LifeEnv
  night: boolean
  figures: Figure[]
  activity: Activity
  timer: number
  anchor: number
  fire: Prop | null
  pond: Prop | null
  chicken: Chicken | null
  particles: Particle[]
  started: boolean
}

const WALK = 7 // world px per second
const RUN = 13
const CHICKEN_SPEED = 15
const POND_HALF = 8
/** How far past the scene's edges players walk in from and off to */
const EDGE = 22

const rand = (a: number, b: number) => a + Math.random() * (b - a)
const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)]

// ── Rig: body parts cut from the skin texture ──────────────

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d')!
  g.imageSmoothingEnabled = false
  return [c, g]
}

function buildRig(p: OnlinePlayer): Rig {
  const skin = p.skin
  const legacy = (skin instanceof HTMLImageElement ? skin.naturalHeight : skin.height) === 32
  const aw = p.slim && !legacy ? 3 : 4

  // One face of a body part: the base layer with the outer layer on top.
  // Old 64×32 skins have no left limbs or outer layers; their left limbs mirror the right ones.
  type XY = [number, number]
  const face = (base: XY, over: XY | null, w: number, h: number, mirror = false, shade = 0): Part => {
    const [c, g] = makeCanvas(w, h)
    if (mirror) { g.translate(w, 0); g.scale(-1, 1) }
    g.drawImage(skin, base[0], base[1], w, h, 0, 0, w, h)
    if (over && !legacy) g.drawImage(skin, over[0], over[1], w, h, 0, 0, w, h)
    if (shade) {
      g.setTransform(1, 0, 0, 1, 0, 0)
      g.globalCompositeOperation = 'source-atop'
      g.fillStyle = `rgba(0,0,0,${shade})`
      g.fillRect(0, 0, w, h)
    }
    let pixels: Part['pixels'] = null
    try {
      const d = g.getImageData(0, 0, w, h).data
      pixels = []
      for (let i = 0; i < w * h; i++) {
        const a = d[i * 4 + 3]
        pixels.push(a ? `rgba(${d[i * 4]},${d[i * 4 + 1]},${d[i * 4 + 2]},${(a / 255).toFixed(3)})` : null)
      }
    } catch { /* a skin served without CORS: fall back to plain rotated drawing */ }
    return { canvas: c, pixels }
  }
  const IN = 0.35

  return {
    headF: face([8, 8], [40, 8], 8, 8),
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

// ── Props and small sprites ─────────────────────────────────

const FLAME = [
  ['...y....', '..yoy...', '..yoy.y.', '.yoroyo.', '.yorroy.', 'yorrrroy'],
  ['....y...', '...yoy..', '.y.yoy..', '.yoryoy.', '.yorroy.', 'yorrrroy'],
  ['...y.y..', '..yoyoy.', '..yooy..', '.yorroy.', 'yorrrooy', 'yorrrroy'],
]
const FLAME_COLORS: Record<string, string> = { y: '#ffe066', o: '#ff9a1f', r: '#e8481a' }

const CHICKEN_ROWS = [
  ['.....ww.', '....wwkw', '.w..wwyy', 'wwwwwwr.', 'wwwwwww.', '.wwwww..', '..y.y...', '..y.y...'],
  ['.....ww.', '....wwkw', '.w..wwyy', 'wwwwwwr.', 'wwwwwww.', '.wwwww..', '...yy...', '..y..y..'],
]
const CHICKEN_FLAP = ['.....ww.', '....wwkw', 'ww..wwyy', 'wwwwwwr.', '.wwwwww.', '.wwwww..', '..y.y...', '........']
const CHICKEN_COLORS: Record<string, string> = { w: '#f4f1ea', r: '#d8342a', y: '#f2b233', k: '#1d1d24' }

const HEART = ['.#.#.', '#####', '#####', '.###.', '..#..']

function drawRows(g: CanvasRenderingContext2D, rows: string[], colors: Record<string, string>, x: number, y: number, flip = false) {
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

// ── The director ─────────────────────────────────────────────

export function createParty(env: LifeEnv, night: boolean): Party {
  return {
    env, night, figures: [], activity: 'wander', timer: 0, anchor: env.PAD + env.W / 2,
    fire: null, pond: null, chicken: null, particles: [], started: false,
  }
}

/** The scene was rebuilt (resized, or the time of day changed): same players, new ground */
export function retargetParty(party: Party, env: LifeEnv, night: boolean) {
  const changed = night !== party.night
  party.env = env
  party.night = night
  for (const f of party.figures) f.x = Math.min(Math.max(f.x, env.PAD + 4), env.PAD + env.W - 4)
  party.fire = party.pond = null
  party.chicken = null
  if (party.figures.some(f => !f.leaving)) setUp(party, changed ? pickActivity(party) : party.activity, true)
}

/** Top of the ground around x (the highest block the figure would stand on) */
function ground(env: LifeEnv, x: number): number {
  const g = env.groundTop
  let top = Infinity
  for (let i = Math.floor(x - 1.5); i <= Math.ceil(x + 1.5); i++) top = Math.min(top, g[Math.max(0, Math.min(g.length - 1, i))])
  return top
}

/** A level stretch of ground `half` wide either side, somewhere across the middle of the scene */
function flatSpot(env: LifeEnv, half: number): number {
  let best = env.PAD + env.W / 2
  let bestScore = Infinity
  for (let c = env.PAD + env.W * 0.2; c <= env.PAD + env.W * 0.8; c += 2) {
    let lo = Infinity, hi = -Infinity
    for (let x = Math.floor(c - half); x <= c + half; x++) {
      const y = env.groundTop[Math.max(0, Math.min(env.groundTop.length - 1, x))]
      lo = Math.min(lo, y)
      hi = Math.max(hi, y)
    }
    const score = (hi - lo) * 4 + Math.random() * 6
    if (score < bestScore) { bestScore = score; best = c }
  }
  return Math.round(best)
}

function pickActivity(party: Party): Activity {
  const n = party.figures.filter(f => !f.leaving).length
  const w: Record<Activity, number> = party.night
    ? { campfire: 7, fishing: 2, chase: 0.5, wander: 1.5 }
    : { campfire: 1, fishing: 4, chase: n > 1 ? 4 : 2.5, wander: 3 }
  w[party.activity] *= 0.2
  const total = w.campfire + w.fishing + w.chase + w.wander
  let roll = Math.random() * total
  for (const a of ['campfire', 'fishing', 'chase', 'wander'] as Activity[]) {
    roll -= w[a]
    if (roll <= 0) return a
  }
  return 'wander'
}

/** Starts an activity: puts out the old props, sets up new ones and sends everyone to a spot */
function setUp(party: Party, activity: Activity, instant = false) {
  const { env } = party
  if (party.fire) party.fire.dying = true
  if (party.pond) party.pond.dying = true
  if (party.chicken) {
    // Caught it! A puff of feathers and it's gone
    burst(party, party.chicken.x, ground(env, party.chicken.x) - 3, 8, ['#f4f1ea', '#e6e1d6', '#ffffff'], 16, 24)
    party.chicken = null
  }
  party.activity = activity
  party.timer = rand(45, 75)

  if (activity === 'campfire') {
    party.anchor = flatSpot(env, 12)
    party.fire = { x: party.anchor, a: instant ? 1 : 0, dying: false }
  } else if (activity === 'fishing') {
    party.anchor = flatSpot(env, POND_HALF + 3)
    party.pond = { x: party.anchor, a: instant ? 1 : 0, dying: false }
  } else if (activity === 'chase') {
    party.anchor = Math.round(env.PAD + env.W * rand(0.3, 0.7))
    party.chicken = { x: party.anchor, dir: Math.random() < 0.5 ? 1 : -1, hop: 0, hopV: 0, t: 0, rest: 2, flap: 0 }
  }
  assignSlots(party)
}

/** Gives every player a place in the current activity (again, when someone joins or leaves) */
function assignSlots(party: Party) {
  const live = party.figures.filter(f => !f.leaving)
  const a = party.activity
  const ring = (i: number, from: number, gap: number, pose: SlotPose): Slot => {
    const side = i % 2 === 0 ? -1 : 1
    return { x: party.anchor + side * (from + Math.floor(i / 2) * gap), dir: side === -1 ? 1 : -1, pose }
  }
  live.forEach((f, i) => {
    if (a === 'campfire') f.slot = ring(i, 9, 10, 'sit')
    else if (a === 'fishing') f.slot = i < 2 ? ring(i, POND_HALF + 3, 0, 'fish') : ring(i - 2, POND_HALF + 13, 10, 'sit')
    else if (a === 'chase') f.slot = { x: party.anchor, dir: 1, pose: 'chase' }
    else { f.slot = null; f.target = null; f.idle = rand(0, 3) }
    f.bite = rand(5, 14)
  })
}

/** Players who came online walk in from the sides; players who left walk off */
export function syncParty(party: Party, players: OnlinePlayer[]) {
  const { env } = party
  const wanted = new Map<string, OnlinePlayer>()
  players.forEach((p, i) => wanted.set(p.name ? p.name.toLowerCase() : `?${i}`, p))

  let changed = false
  for (const f of party.figures) {
    const p = wanted.get(f.key)
    if (!p) {
      if (!f.leaving) { f.leaving = true; f.slot = null; changed = true }
      continue
    }
    // Their skin finished loading, or they changed it
    if (p.skin !== f.skin) { f.rig = buildRig(p); f.skin = p.skin }
    if (f.leaving) { f.leaving = false; changed = true }
    wanted.delete(f.key)
  }

  const first = !party.started
  for (const [key, p] of wanted) {
    const fromLeft = Math.random() < 0.5
    party.figures.push({
      key, skin: p.skin, rig: buildRig(p),
      x: first ? env.PAD + env.W * rand(0.25, 0.75) : fromLeft ? env.PAD - EDGE + 2 : env.PAD + env.W + EDGE - 2,
      dir: fromLeft ? 1 : -1, front: false, pose: 'stand', slot: null, target: null,
      t: Math.random() * 10, idle: 0, wave: 0, jump: 0, jumpV: 0, leaving: false,
      bite: rand(5, 14), reel: 0, tagLift: 0,
    })
    changed = true
  }
  if (players.length) party.started = true
  if (!changed) return

  const live = party.figures.some(f => !f.leaving)
  if (first && live) {
    // The first players are already hanging out when the launcher opens
    setUp(party, pickActivity(party), true)
    for (const f of party.figures) if (f.slot && f.slot.pose !== 'chase') f.x = f.slot.x
  } else if (live) {
    // Coming back to an empty scene restarts the activity; otherwise just make room
    const idle = party.activity !== 'wander' && !party.chicken && (!party.fire || party.fire.dying) && (!party.pond || party.pond.dying)
    if (idle) setUp(party, party.activity)
    else assignSlots(party)
  }
}

// ── Simulation ───────────────────────────────────────────────

export function stepParty(party: Party, dt: number) {
  const { env } = party
  const live = party.figures.filter(f => !f.leaving)
  party.timer -= dt
  if (party.timer <= 0 && live.length) setUp(party, pickActivity(party))
  if (!live.length) {
    // Everyone logged off: tidy up after them
    if (party.fire) party.fire.dying = true
    if (party.pond) party.pond.dying = true
    party.chicken = null
  }

  for (const prop of [party.fire, party.pond]) {
    if (prop) prop.a = prop.dying ? prop.a - dt / 1.5 : Math.min(1, prop.a + dt / 1.5)
  }
  if (party.fire && party.fire.a <= 0) {
    burst(party, party.fire.x, ground(env, party.fire.x) - 2, 5, ['#8a8a96', '#a3a3ad'], 5, 12)
    party.fire = null
  }
  if (party.pond && party.pond.a <= 0) party.pond = null

  stepChicken(party, dt)

  for (const f of party.figures) {
    f.t += dt
    f.wave = Math.max(0, f.wave - dt)
    f.jumpV += 150 * dt
    f.jump = Math.min(0, f.jump + f.jumpV * dt)
    if (f.jump === 0) f.jumpV = 0
    f.front = false

    if (f.leaving) {
      moveTo(f, f.x < env.PAD + env.W / 2 ? env.PAD - EDGE : env.PAD + env.W + EDGE, WALK, dt)
      continue
    }
    if (f.wave > 0) { f.pose = 'wave'; f.front = true; continue }

    const ch = party.chicken
    if (f.slot?.pose === 'chase') {
      if (ch) {
        // Everyone runs after the chicken, strung out behind it
        const i = live.indexOf(f)
        const behind = ch.x - ch.dir * (5 + (i % 4) * 4.5)
        if (Math.abs(behind - f.x) > 1.2) moveTo(f, behind, RUN, dt)
        else { f.pose = 'stand'; f.dir = ch.x >= f.x ? 1 : -1 }
        if (f.pose === 'run' && f.jump === 0 && Math.random() < dt * 0.3) f.jumpV = -32
        continue
      }
      f.slot = null
    }
    const slot = f.slot
    if (slot) {
      // Jog over from far away (someone who just logged in), stroll the last bit
      const gap = Math.abs(slot.x - f.x)
      if (gap > 0.6) { moveTo(f, slot.x, gap > 30 ? RUN : WALK, dt); continue }
      f.x = slot.x
      f.dir = slot.dir
      f.pose = slot.pose === 'sit' ? 'sit' : party.pond ? 'fish' : 'stand'
      if (f.pose === 'fish' && party.pond && !party.pond.dying && party.pond.a >= 1) {
        f.reel = Math.max(0, f.reel - dt)
        f.bite -= dt
        if (f.bite <= 0) {
          // A bite: the rod jerks up and a fish flies out of the water
          f.bite = rand(8, 20)
          f.reel = 0.8
          const bob = f.x + f.dir * 9
          catchFish(party, bob, ground(env, bob), f.dir)
        }
      }
      continue
    }

    // Wandering: stroll somewhere, stop and look at whoever's nearby, the odd hop or wave
    if (f.target !== null) {
      if (Math.abs(f.target - f.x) > 0.6) { moveTo(f, f.target, WALK, dt); continue }
      f.target = null
      f.idle = rand(2.5, 7)
    }
    f.pose = 'stand'
    const other = live.find(o => o !== f && Math.abs(o.x - f.x) < 16 && o.target === null)
    if (other) {
      f.dir = other.x >= f.x ? 1 : -1
      if (Math.random() < dt * 0.06) f.wave = 1.2
    } else {
      f.front = f.idle > 1.5 && Math.sin(f.t * 0.6) > 0.4
    }
    if (f.jump === 0 && Math.random() < dt * 0.04) f.jumpV = -30
    f.idle -= dt
    if (f.idle <= 0) f.target = Math.round(env.PAD + env.W * rand(0.15, 0.85))
  }
  party.figures = party.figures.filter(f => !(f.leaving && (f.x <= env.PAD - EDGE + 0.5 || f.x >= env.PAD + env.W + EDGE - 0.5)))

  // Campfire smoke and sparks
  if (party.fire && !party.fire.dying) {
    const fx = party.fire.x
    const fy = ground(env, fx)
    if (Math.random() < dt * 4) {
      party.particles.push({ x: fx * 2 + rand(-2, 2), y: fy * 2 - 12, vx: rand(-2, 2), vy: rand(-12, -7), life: 2.4, max: 2.4, kind: 'smoke', color: '', gravity: -1 })
    }
    if (Math.random() < dt * 2.5) {
      party.particles.push({ x: fx * 2 + rand(-3, 3), y: fy * 2 - 8, vx: rand(-5, 5), vy: rand(-28, -16), life: 0.9, max: 0.9, kind: 'dot', color: '#ffb347', gravity: 6 })
    }
  }

  for (const p of party.particles) {
    p.life -= dt
    p.vy += p.gravity * dt
    p.x += p.vx * dt
    p.y += p.vy * dt
  }
  party.particles = party.particles.filter(p => p.life > 0)
}

function stepChicken(party: Party, dt: number) {
  const ch = party.chicken
  if (!ch) return
  const { env } = party
  ch.t += dt
  ch.flap = Math.max(0, ch.flap - dt)
  let nearest: Figure | null = null
  for (const f of party.figures) {
    if (f.leaving || f.slot?.pose !== 'chase') continue
    if (!nearest || Math.abs(f.x - ch.x) < Math.abs(nearest.x - ch.x)) nearest = f
  }
  const gap = nearest ? Math.abs(nearest.x - ch.x) : Infinity

  if (ch.rest > 0) {
    ch.rest -= dt
    if (gap < 8) ch.rest = 0
  } else {
    ch.x += ch.dir * CHICKEN_SPEED * (ch.flap > 0 ? 1.5 : 1) * dt
    if (Math.random() < dt * 0.3) ch.rest = rand(0.5, 1.4)
  }
  if (nearest && gap < 3.5 && ch.flap <= 0) {
    // Nearly caught: it flaps up, loses a feather or two and bolts the other way
    ch.flap = 0.7
    ch.hopV = -28
    ch.dir = nearest.x > ch.x ? -1 : 1
    burst(party, ch.x, ground(env, ch.x) - 4, 3, ['#f4f1ea', '#e6e1d6'], 8, 18)
  }
  if (ch.x < env.PAD + 8) ch.dir = 1
  if (ch.x > env.PAD + env.W - 8) ch.dir = -1
  ch.hopV += 90 * dt
  ch.hop = Math.min(0, ch.hop + ch.hopV * dt)
  if (ch.hop === 0) ch.hopV = 0
}

function moveTo(f: Figure, x: number, speed: number, dt: number) {
  const d = x - f.x
  f.dir = d >= 0 ? 1 : -1
  f.pose = speed > WALK ? 'run' : 'walk'
  f.x += Math.sign(d) * Math.min(Math.abs(d), speed * dt)
}

// Particles live in world coordinates at overlay resolution (world x × 2)
function burst(party: Party, x: number, y: number, n: number, colors: string[], speed: number, up: number) {
  for (let i = 0; i < n; i++) {
    party.particles.push({
      x: x * 2 + rand(-3, 3), y: y * 2, vx: rand(-speed, speed), vy: rand(-up, -up * 0.4),
      life: rand(0.6, 1.1), max: 1.1, kind: 'dot', color: pick(colors), gravity: 40,
    })
  }
}

function catchFish(party: Party, x: number, y: number, dir: 1 | -1) {
  burst(party, x, y, 6, ['#9fd3ff', '#cfeaff'], 10, 26)
  party.particles.push({ x: x * 2, y: y * 2 - 2, vx: -dir * 24, vy: -54, life: 1.1, max: 1.1, kind: 'fish', color: '', gravity: 80 })
}

// ── Pointer ──────────────────────────────────────────────────

/** Figure height in overlay pixels */
const figureHeight = (f: Figure) => (f.pose === 'sit' ? 22 : 32)

function hitFigure(party: Party, p: ScenePointer, px: number, py: number): Figure | null {
  const { env } = party
  const x = p.x * 2
  const y = p.y * 2
  for (let i = party.figures.length - 1; i >= 0; i--) {
    const f = party.figures[i]
    if (f.leaving) continue
    const fx = (f.x - env.PAD + Math.round(px * 10)) * 2
    const foot = (ground(env, f.x) + Math.round((py + 1) * 2)) * 2 + f.jump
    if (Math.abs(x - fx) <= 7 && y >= foot - figureHeight(f) - 2 && y <= foot + 1) return f
  }
  return null
}

/** Whether a player is under a point given in scene (quarter-resolution) pixels */
export function figureAt(party: Party, p: ScenePointer, px: number, py: number): boolean {
  return !!hitFigure(party, p, px, py)
}

/** A click: the player hops, turns to you and waves, with a heart. Returns true if someone was hit. */
export function pokeParty(party: Party, p: ScenePointer, px: number, py: number): boolean {
  const f = hitFigure(party, p, px, py)
  if (!f) return false
  f.wave = 1.8
  if (f.jump === 0) f.jumpV = -34
  const head = ground(party.env, f.x) * 2 - figureHeight(f)
  const side = Math.random() < 0.5 ? -1 : 1
  party.particles.push({ x: f.x * 2 + side * 7, y: head + 2, vx: side * 3, vy: -12, life: 1.3, max: 1.3, kind: 'heart', color: '', gravity: 0 })
  return true
}

// ── Drawing ──────────────────────────────────────────────────

/** A colour lit for the time of day, matching the terrain and mobs */
function lit(hex: string, light: PartyLight): string {
  const n = parseInt(hex.slice(1), 16)
  const t = parseInt(light.tint.slice(1), 16)
  const ch = (shift: number) => {
    const v = ((n >> shift) & 255) * Math.min(1, light.light)
    return Math.round(v + (((t >> shift) & 255) - v) * light.tintAmt)
  }
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`
}

export function drawParty(ctx: CanvasRenderingContext2D, party: Party, now: number, px: number, py: number, light: PartyLight) {
  const { env } = party
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  if (!party.figures.length && !party.fire && !party.pond && !party.particles.length) return
  ctx.imageSmoothingEnabled = false
  const offX = (Math.round(px * 10) - env.PAD) * 2
  const offY = Math.round((py + 1) * 2) * 2
  const gy = (x: number) => ground(env, x) * 2 + offY
  const fire = party.fire

  if (party.pond) drawPond(ctx, party, party.pond, now, offX, offY, light)
  if (fire) drawFire(ctx, fire, fire.x * 2 + offX, gy(fire.x), now, light)

  // Back to front by x so overlapping players read naturally
  const figures = [...party.figures].sort((a, b) => a.x - b.x)
  for (const f of figures) {
    const foot = Math.round(gy(f.x) + f.jump)
    const warm = fire && light.night ? fire.a * Math.max(0, 1 - Math.abs(f.x - fire.x) / 28) : 0
    const water = gy(f.x + f.dir * 9) + 1 - foot
    drawFigure(ctx, f, Math.round(f.x * 2 + offX), foot, now, light, warm, water)
  }

  const ch = party.chicken
  if (ch) {
    const rows = ch.flap > 0 ? CHICKEN_FLAP : ch.rest > 0 ? CHICKEN_ROWS[0] : CHICKEN_ROWS[Math.floor(ch.t * 10) % 2]
    const colors: Record<string, string> = {}
    for (const [k, v] of Object.entries(CHICKEN_COLORS)) colors[k] = lit(v, light)
    drawRows(ctx, rows, colors, Math.round(ch.x * 2 + offX) - 4, Math.round(gy(ch.x) + ch.hop) - 8, ch.dir < 0)
  }

  for (const p of party.particles) {
    const a = Math.max(0, p.life / p.max)
    const x = Math.round(p.x + offX)
    const y = Math.round(p.y + offY)
    if (p.kind === 'smoke') {
      ctx.fillStyle = `rgba(160,160,172,${(a * 0.4).toFixed(3)})`
      ctx.fillRect(x, y, 2, 2)
      continue
    }
    ctx.globalAlpha = p.kind === 'fish' ? Math.min(1, a * 2) : a
    if (p.kind === 'heart') {
      drawRows(ctx, HEART, { '#': '#ff5fa8' }, x - 2, y)
    } else if (p.kind === 'fish') {
      ctx.fillStyle = lit('#c2915c', light)
      ctx.fillRect(x - 2, y, 5, 2)
      ctx.fillStyle = lit('#8a6440', light)
      ctx.fillRect(p.vx > 0 ? x - 3 : x + 3, y - 1, 1, 4)
    } else {
      ctx.fillStyle = p.color
      ctx.fillRect(x, y, 1, 1)
    }
    ctx.globalAlpha = 1
  }

  // Name tags last, so nothing passes in front of one. A tag that would overlap one already placed
  // (going left to right) is raised a row at a time until it's clear, easing as people move about.
  const placed: { x: number; y: number; w: number; h: number }[] = []
  for (const f of figures) {
    const tag = f.rig.tag
    if (!tag) continue
    const x = Math.round(f.x * 2 + offX - tag.width / 2)
    const base = Math.round(gy(f.x)) - figureHeight(f) - tag.height - 3
    const hits = (y: number) => placed.some(r => x < r.x + r.w + 2 && x + tag.width > r.x - 2 && y < r.y + r.h + 1 && y + tag.height > r.y - 1)
    let lift = 0
    while (lift < 80 && hits(base - lift)) lift += tag.height + 1
    placed.push({ x, y: base - lift, w: tag.width, h: tag.height })
    f.tagLift += (lift - f.tagLift) * 0.3
    ctx.drawImage(tag, x, base + Math.round(f.jump) - Math.round(f.tagLift))
  }
}

function drawPond(ctx: CanvasRenderingContext2D, party: Party, pond: Prop, now: number, offX: number, offY: number, light: PartyLight) {
  const { env } = party
  const x0 = (pond.x - POND_HALF) * 2
  const x1 = (pond.x + POND_HALF) * 2
  const top = (x: number) => env.groundTop[Math.floor(x / 2)] * 2 + offY
  const water = lit('#3b6fdc', light)
  const deep = lit('#2c58ad', light)
  const edge = lit('#5f4230', light)
  ctx.globalAlpha = Math.max(0, pond.a)
  for (let x = x0; x < x1; x++) {
    const rim = x === x0 || x === x1 - 1
    ctx.fillStyle = rim ? edge : water
    ctx.fillRect(x + offX, top(x) + 1, 1, 10)
    ctx.fillStyle = rim ? edge : deep
    ctx.fillRect(x + offX, top(x) + 11, 1, 4)
  }
  // Ripples drifting across the surface
  ctx.fillStyle = lit('#9cc4ff', light)
  const span = x1 - x0 - 8
  for (let i = 0; i < 4; i++) {
    const rx = Math.round(x0 + 3 + ((now * 0.01 + i * 9.7) % span))
    ctx.fillRect(rx + offX, top(rx) + 3 + (i % 3) * 2, 3, 1)
  }
  ctx.globalAlpha = 1
}

function drawFire(ctx: CanvasRenderingContext2D, fire: Prop, cx: number, base: number, now: number, light: PartyLight) {
  const a = Math.max(0, fire.a)
  if (light.night) {
    const flick = 0.85 + Math.sin(now * 0.013) * 0.07 + Math.random() * 0.05
    const glow = ctx.createRadialGradient(cx, base - 6, 2, cx, base - 6, 72)
    glow.addColorStop(0, `rgba(255,165,70,${(0.3 * flick * a).toFixed(3)})`)
    glow.addColorStop(1, 'rgba(255,140,40,0)')
    ctx.globalCompositeOperation = 'lighter'
    ctx.fillStyle = glow
    ctx.fillRect(cx - 72, base - 78, 144, 100)
    ctx.globalCompositeOperation = 'source-over'
  }
  // Logs
  ctx.fillStyle = lit('#6b4526', light)
  ctx.fillRect(cx - 7, base - 3, 14, 3)
  ctx.fillStyle = lit('#8a5d34', light)
  ctx.fillRect(cx - 6, base - 5, 12, 2)
  ctx.fillStyle = lit('#3c2612', light)
  ctx.fillRect(cx - 7, base - 1, 14, 1)
  ctx.fillRect(cx - 3, base - 5, 1, 2)
  ctx.fillRect(cx + 3, base - 5, 1, 2)
  // Flames grow in as it's lit and shrink as it goes out
  const frame = FLAME[Math.floor(now / 140) % FLAME.length]
  const rows = frame.slice(Math.round((1 - a) * frame.length))
  if (rows.length) drawRows(ctx, rows, FLAME_COLORS, cx - 4, base - 5 - rows.length)
}

/** A crisp one-pixel line (Bresenham), since stroked paths come out anti-aliased */
function pixelLine(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, color: string) {
  g.fillStyle = color
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0)
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1
  let err = dx + dy
  for (;;) {
    g.fillRect(x0, y0, 1, 1)
    if (x0 === x1 && y0 === y1) return
    const e2 = 2 * err
    if (e2 >= dy) { err += dy; x0 += sx }
    if (e2 <= dx) { err += dx; y0 += sy }
  }
}

// Each figure is posed on a scratch canvas, lit, then composited
let scratch: [HTMLCanvasElement, CanvasRenderingContext2D] | null = null
const SX = 32 // foot point inside the scratch canvas
const SY = 52

function drawFigure(
  ctx: CanvasRenderingContext2D, f: Figure, x: number, foot: number, now: number,
  light: PartyLight, warm: number, water: number,
) {
  if (!scratch) scratch = makeCanvas(64, 64)
  const [sc, g] = scratch
  g.setTransform(1, 0, 0, 1, 0, 0)
  g.globalCompositeOperation = 'source-over'
  g.clearRect(0, 0, sc.width, sc.height)
  const r = f.rig
  const dir = f.dir
  const t = f.t

  // A limb hanging from its pivot (hip or shoulder), rotated; `top` is how far above the pivot it starts.
  // Rotation samples the skin pixel by pixel (nearest neighbour): the canvas would smear the edges.
  const limb = ({ canvas: img, pixels }: Part, px: number, py: number, angle: number, top = 0) => {
    const w = img.width, h = img.height
    if (Math.abs(angle) < 0.03) {
      g.drawImage(img, Math.round(px - w / 2), Math.round(py - top))
      return
    }
    if (!pixels) {
      g.save()
      g.translate(px, py)
      g.rotate(angle)
      g.drawImage(img, -w / 2, -top)
      g.restore()
      return
    }
    const cos = Math.cos(angle), sin = Math.sin(angle)
    const xs: number[] = [], ys: number[] = []
    for (const [cx, cy] of [[-w / 2, -top], [w / 2, -top], [-w / 2, h - top], [w / 2, h - top]]) {
      xs.push(cx * cos - cy * sin)
      ys.push(cx * sin + cy * cos)
    }
    const X0 = Math.floor(px + Math.min(...xs)), X1 = Math.ceil(px + Math.max(...xs))
    const Y0 = Math.floor(py + Math.min(...ys)), Y1 = Math.ceil(py + Math.max(...ys))
    for (let Y = Y0; Y < Y1; Y++) {
      for (let X = X0; X < X1; X++) {
        const dx = X + 0.5 - px, dy = Y + 0.5 - py
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

  if (f.front) {
    const aw = r.armW
    const sway = Math.sin(t * 1.4) * 0.04
    const waving = f.pose === 'wave'
    limb(r.legRF, SX - 2, SY - 12, 0)
    limb(r.legLF, SX + 2, SY - 12, 0)
    g.drawImage(r.bodyF.canvas, SX - 4, SY - 24)
    limb(r.armRF, SX - 4 - aw / 2, SY - 22, sway, 2)
    limb(r.armLF, SX + 4 + aw / 2, SY - 22, waving ? -2.7 + Math.sin(t * 14) * 0.35 : -sway, 2)
    g.drawImage(r.headF.canvas, SX - 4, SY - 32)
  } else {
    // Side view. Facing right shows the player's right side, with the left limbs' inner faces behind.
    const right = dir === 1
    const head = (right ? r.headR : r.headL).canvas
    const body = (right ? r.bodyR : r.bodyL).canvas
    const armN = right ? r.armR : r.armL
    const armF = right ? r.armLIn : r.armRIn
    const legN = right ? r.legR : r.legL
    const legF = right ? r.legLIn : r.legRIn

    // Now and then they look over at you, so you can see who it is
    const lookUp = f.pose !== 'walk' && f.pose !== 'run' && Math.sin(t * 0.33 + f.x * 1.7) > 0.35
    const face = lookUp ? r.headF.canvas : head

    if (f.pose === 'sit') {
      // Sitting on the grass: legs out in front, hands resting on the knees, the odd nod
      const hip = SY - 2
      const nod = Math.sin(t * 0.5 + f.x) > 0.96 ? 1 : 0
      limb(legF, SX, hip, -dir * (Math.PI / 2 - 0.1))
      g.drawImage(body, SX - 2, hip - 12)
      limb(legN, SX, hip, -dir * (Math.PI / 2))
      g.drawImage(face, SX - 4, hip - 20 + nod)
      limb(armN, SX, hip - 10, -dir * (0.6 + Math.sin(t * 0.8 + f.x) * 0.04), 2)
    } else {
      let swing = 0, armSwing = 0, lift = 0, reach = 0
      if (f.pose === 'walk') {
        swing = Math.sin(t * 9) * 0.5
        armSwing = -swing * 0.8
        lift = Math.abs(Math.sin(t * 9)) > 0.92 ? -1 : 0
      } else if (f.pose === 'run') {
        swing = Math.sin(t * 15) * 0.85
        armSwing = -swing
        lift = Math.abs(Math.sin(t * 15)) > 0.7 ? -1 : 0
      } else if (f.pose === 'fish') {
        reach = 0.8 + (f.reel > 0 ? 0.8 * Math.min(1, f.reel / 0.4) : Math.sin(t * 2) * 0.05)
      } else {
        armSwing = Math.sin(t * 1.4) * 0.05
      }
      const hip = SY - 12 + lift
      limb(armF, SX, hip - 10, -dir * (-armSwing + reach * 0.7), 2)
      limb(legF, SX, hip, dir * swing)
      g.drawImage(body, SX - 2, hip - 12)
      limb(legN, SX, hip, -dir * swing)
      g.drawImage(f.pose === 'fish' ? head : face, SX - 4, hip - 20)
      const armA = armSwing + reach
      limb(armN, SX, hip - 10, -dir * armA, 2)

      if (f.pose === 'fish') {
        // Rod from the hand, line down to a float bobbing on the water
        const hx = Math.round(SX + Math.sin(armA) * 9 * dir)
        const hy = Math.round(hip - 10 + Math.cos(armA) * 9)
        const lift = f.reel > 0 ? 3 : 0
        const tipX = hx + dir * (8 - lift)
        const tipY = hy - 8 - lift
        const bobX = SX + dir * 18
        const bobY = SY + water + Math.round(Math.sin(now * 0.004 + f.x) * 0.7) + (f.bite < 0.6 ? 2 : 0)
        pixelLine(g, tipX, tipY, bobX, bobY - 2, 'rgba(230,230,240,0.55)')
        pixelLine(g, hx, hy, tipX, tipY, '#6b4a2b')
        g.fillStyle = '#e8342a'
        g.fillRect(bobX, bobY - 2, 2, 1)
        g.fillStyle = '#f4f4f4'
        g.fillRect(bobX, bobY - 1, 2, 1)
      }
    }
  }

  // Light the figure like the rest of the scene, warmer and brighter near the fire
  g.globalCompositeOperation = 'source-atop'
  const dark = 1 - Math.min(1, light.light + warm * 0.4)
  if (dark > 0.01) {
    g.fillStyle = `rgba(0,0,0,${dark.toFixed(3)})`
    g.fillRect(0, 0, sc.width, sc.height)
  }
  if (light.tintAmt > 0) {
    g.globalAlpha = light.tintAmt * (1 - warm * 0.7)
    g.fillStyle = light.tint
    g.fillRect(0, 0, sc.width, sc.height)
  }
  if (warm > 0) {
    g.globalAlpha = warm * 0.22
    g.fillStyle = '#ff9a3c'
    g.fillRect(0, 0, sc.width, sc.height)
  }
  g.globalAlpha = 1
  g.globalCompositeOperation = 'source-over'

  ctx.drawImage(sc, x - SX, foot - SY)
}
