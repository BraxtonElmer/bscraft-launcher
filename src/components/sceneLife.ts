// ============================================================
// sceneLife.ts — Birds, bats and mobs that live in PixelScene.
//
// By day, flocks of birds cross the sky and scatter when the cursor
// gets close, while sheep, pigs and chickens wander along the real
// terrain — hopping up one-block steps, grazing, drifting on and off
// screen. At night bats flit past the moon and zombies, skeletons,
// spiders (with glowing eyes) and foxes roam; a rare creeper shows up
// at dusk and night.
//
// Every mob reacts to a click the way it would in Minecraft:
//   sheep    — sheared: wool pops off, regrows later
//   pig      — takes a carrot and follows the cursor
//   chicken  — flaps, lays an egg that may hatch a chick
//   fox      — crouches and pounces
//   zombie   — knocked back, then chases the cursor; 3 hits drops rotten flesh
//   skeleton — knocked back and shoots an arrow at the cursor; 3 hits drops bones
//   spider   — pounces at the cursor, then scurries off
//   creeper  — fuse, explosion with screen shake, drops gunpowder
//
// Everything here works in the scene's ¼-resolution canvas pixels.
// ============================================================

export type MobKind = 'sheep' | 'pig' | 'chicken' | 'chick' | 'creeper' | 'zombie' | 'skeleton' | 'spider' | 'fox'

export interface LifeConfig {
  /** Relative flock frequency, 0 = no birds */
  birds: number
  /** Relative bat frequency, 0 = no bats */
  bats: number
  /** Bats need to be lighter than a night sky to be seen; defaults to the bird colour */
  batColor?: string
  /** Which mobs can spawn */
  mobs: MobKind[]
  maxMobs: number
}

export interface LifeEnv {
  W: number
  H: number
  PAD: number
  /** Ground surface y for every x of the front layer */
  groundTop: number[]
  /** Applies this time of day's lighting to a creature or item colour */
  shade: (hex: string) => string
  birdColor: string
  cfg: LifeConfig
}

export interface ScenePointer { x: number; y: number }

type Pair = [HTMLCanvasElement, HTMLCanvasElement] // [facing right, facing left]

// ── Sprites ──────────────────────────────────────────────────

interface MobDef {
  speed: number
  /** Seconds per walk frame */
  step: number
  walk: [string[], string[]]
  /** Standing still — grazing or pecking for animals that do */
  idle: string[]
  /** Colours starting with '!' glow: they skip the scene's lighting */
  colors: Record<string, string>
  /** Spawn weight; 0 = only appears some other way (chicks hatch from eggs) */
  weight: number
}

const DEFS: Record<MobKind, MobDef> = {
  sheep: {
    speed: 3.2, step: 0.2, weight: 4,
    walk: [
      ['.wwwww..', 'wwwwwwff', 'wwwwwwfk', '.WWWWW..', '.l...l..'],
      ['.wwwww..', 'wwwwwwff', 'wwwwwwfk', '.WWWWW..', '..l.l...'],
    ],
    idle: ['.wwwww..', 'wwwwww..', 'wwwwwwff', '.WWWWWfk', '.l...l..'],
    colors: { w: '#f3f1ee', W: '#d6d2cd', f: '#e2c6a6', k: '#2a211e', l: '#c9ad8f' },
  },
  pig: {
    speed: 3.6, step: 0.18, weight: 3,
    walk: [
      ['.ppppp.', 'ppppppk', 'PPPPPPs', '.l..l..'],
      ['.ppppp.', 'ppppppk', 'PPPPPPs', '..l..l.'],
    ],
    idle: ['.ppppp.', 'ppppppk', 'PPPPPPs', '.l..l..'],
    colors: { p: '#f2a7b0', P: '#d98992', k: '#3a2226', s: '#e8808f', l: '#d98992' },
  },
  chicken: {
    speed: 4.2, step: 0.12, weight: 3,
    walk: [
      ['....ww.', '....wkb', 'w..wwr.', 'wwwww..', '.WWW...', '..y.y..'],
      ['....ww.', '....wkb', 'w..wwr.', 'wwwww..', '.WWW...', '...yy..'],
    ],
    idle: ['.......', '....ww.', 'w..wwkb', 'wwwwwr.', '.WWW...', '..y.y..'],
    colors: { w: '#f6f5f0', W: '#d9d8d2', k: '#1f1f1f', b: '#f2b233', r: '#d63c3c', y: '#e9a12b' },
  },
  chick: {
    speed: 4.6, step: 0.1, weight: 0,
    walk: [
      ['..yy.', 'y.ykb', 'yyyy.', '.o.o.'],
      ['..yy.', 'y.ykb', 'yyyy.', '..oo.'],
    ],
    idle: ['.....', '..yy.', 'yyykb', '.o.o.'],
    colors: { y: '#f6d743', k: '#1f1f1f', b: '#f09a2a', o: '#e08a22' },
  },
  creeper: {
    speed: 2.6, step: 0.22, weight: 1,
    walk: [
      ['.gggg', '.gGgk', '.gggg', '..gG.', '..Gg.', '..gg.', '.g..g'],
      ['.gggg', '.gGgk', '.gggg', '..gG.', '..Gg.', '..gg.', '..gg.'],
    ],
    idle: ['.gggg', '.gGgk', '.gggg', '..gG.', '..Gg.', '..gg.', '.g..g'],
    colors: { g: '#62b24f', G: '#43893a', k: '#18261a' },
  },
  zombie: {
    speed: 2.3, step: 0.26, weight: 3,
    walk: [
      ['.ggg..', '.ggk..', '.cccgg', '.ccc..', '.ccc..', '.bbb..', '.b.b..', 'b...b.'],
      ['.ggg..', '.ggk..', '.cccgg', '.ccc..', '.ccc..', '.bbb..', '..b...', '..b...'],
    ],
    idle: ['.ggg..', '.ggk..', '.cccgg', '.ccc..', '.ccc..', '.bbb..', '.b.b..', '.b.b..'],
    colors: { g: '#6aa052', k: '#1d2a18', c: '#38a3ab', b: '#454aa8' },
  },
  skeleton: {
    speed: 2.9, step: 0.22, weight: 2,
    walk: [
      ['.www..', '.wwk..', '..w...', '.wdww.', '.dwd..', '..w...', '.w.w..', 'w...w.'],
      ['.www..', '.wwk..', '..w...', '.wdww.', '.dwd..', '..w...', '..w...', '..w...'],
    ],
    idle: ['.www..', '.wwk..', '..w...', '.wdww.', '.dwd..', '..w...', '.w.w..', '.w.w..'],
    colors: { w: '#dcdcd4', d: '#77776f', k: '#26262a' },
  },
  spider: {
    speed: 4.4, step: 0.1, weight: 2,
    walk: [
      ['..dddd..', '.dDDDDde', 'd.d..d.d', 'd..dd..d'],
      ['..dddd..', '.dDDDDde', '.d.dd.d.', 'd.d..d.d'],
    ],
    idle: ['..dddd..', '.dDDDDde', 'd.d..d.d', 'd..dd..d'],
    colors: { d: '#3a3134', D: '#4b4044', e: '!#ff3434' },
  },
  fox: {
    speed: 5, step: 0.12, weight: 2,
    walk: [
      ['......o.o', 'w.....ooo', 'wooooooko', '.ooWWWo..', '..d...d..'],
      ['......o.o', 'w.....ooo', 'wooooooko', '.ooWWWo..', '...d.d...'],
    ],
    idle: ['......o.o', '......ooo', 'w.oooooko', 'wooWWWo..', '..d...d..'],
    colors: { o: '#e2803e', W: '#f3ece2', w: '#f3ece2', k: '#1f1a18', d: '#3b2b25' },
  },
}

// Most sheep are white; some grey, and some BSCraft pink
const SHEEP_WOOL: [string, string, string, number][] = [
  ['white', '#f3f1ee', '#d6d2cd', 0.62],
  ['pink', '#f7b3d0', '#e291b4', 0.24],
  ['grey', '#c2bfc6', '#a3a0a8', 0.14],
]
const SHEARED = { w: '#dcbf9f', W: '#c4a585' }

const BIRD_BIG = [
  ['#...#', '.#.#.', '..#..'],
  ['.....', '##.##', '..#..'],
  ['.....', '.###.', '#.#.#'],
]
const BIRD_SMALL = [
  ['#.#', '.#.'],
  ['...', '###'],
  ['.#.', '#.#'],
]
const BAT = [
  ['#.#.#', '.###.', '.....'],
  ['.....', '#####', '..#..'],
  ['..#..', '.###.', '#...#'],
]
const FLAP = [0, 1, 2, 1] // up, level, down, level

const HEART = ['.#.#.', '#####', '#####', '.###.', '..#..']

const ITEM_ROWS = {
  carrot: { rows: ['..gg', '.og.', 'oo..', 'o...'], colors: { o: '#f08a24', g: '#4fa83a' } },
  egg: { rows: ['.e.', 'eee', '.E.'], colors: { e: '#f1e4c6', E: '#d8c8a4' } },
  flesh: { rows: ['rrg', 'grr'], colors: { r: '#9a5a44', g: '#6f8f3e' } },
  bone: { rows: ['bb.', '.b.', '.bb'], colors: { b: '#ece9dd' } },
  gunpowder: { rows: ['.g.', 'gGg'], colors: { g: '#6a6a6e', G: '#4a4a4e' } },
}
type ItemName = keyof typeof ITEM_ROWS

function paint(rows: string[], color: (ch: string) => string | null, flip = false): HTMLCanvasElement {
  const h = rows.length
  const w = rows[0].length
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')!
  rows.forEach((row, y) => {
    for (let x = 0; x < w; x++) {
      const col = color(row[x])
      if (!col) continue
      ctx.fillStyle = col
      ctx.fillRect(flip ? w - 1 - x : x, y, 1, 1)
    }
  })
  return c
}

const pair = (rows: string[], color: (ch: string) => string | null): Pair => [paint(rows, color), paint(rows, color, true)]

interface MobSprites {
  w: number
  h: number
  walk: [Pair, Pair]
  idle: Pair
  white: Pair
  hurt: Pair
  /** Sheep only: the sheared look, and the wool colour it drops */
  sheared?: MobSprites
  wool?: HTMLCanvasElement
}

function mobSprites(kind: MobKind, colors: Record<string, string>, shade: (hex: string) => string): MobSprites {
  const def = DEFS[kind]
  const lit: Record<string, string> = {}
  for (const k in colors) lit[k] = colors[k].startsWith('!') ? colors[k].slice(1) : shade(colors[k])
  const fill = (ch: string) => lit[ch] ?? null
  const solid = (col: string) => (ch: string) => (ch === '.' ? null : col)
  return {
    w: def.walk[0][0].length,
    h: def.walk[0].length,
    walk: [pair(def.walk[0], fill), pair(def.walk[1], fill)],
    idle: pair(def.idle, fill),
    white: pair(def.walk[0], solid('#ffffff')),
    hurt: pair(def.walk[0], solid('#ff4a4a')),
  }
}

// ── State ────────────────────────────────────────────────────

interface Bird { dx: number; dy: number; ph: number }

interface Flock {
  x: number
  y: number
  vx: number
  vy: number
  big: boolean
  birds: Bird[]
  t: number
  flapRate: number
  glideSeed: number
  fleeing: boolean
}

interface Bat { x: number; y: number; vx: number; vy: number; t: number; ph: number; turn: number; fleeing: boolean }

interface Mob {
  kind: MobKind
  sprites: MobSprites
  x: number          // left edge, front-layer coordinates
  feet: number       // y of the bottom of the sprite
  vy: number
  kx: number         // horizontal push: knockback, pounces
  dir: 1 | -1
  state: 'walk' | 'idle'
  t: number
  animT: number
  frame: 0 | 1
  mode: 'enter' | 'roam' | 'leave'
  life: number       // seconds of roaming left before it wanders off
  fuse: number       // creeper about to blow
  dying: number      // blinking red, then gone
  hitFlash: number   // brief red blink after a hit
  hits: number
  panic: number      // sprinting away
  follow: number     // pig with a carrot / zombie giving chase: heads for the cursor
  heartT: number     // pig: next heart while following
  aim: number        // skeleton drawing its bow
  aimAt: ScenePointer | null
  crouch: number     // fox about to pounce
  flipOnLand: boolean // spider: turns and runs once its pounce lands
  dustOnLand: boolean // fox: kicks up dust when it lands
  sheared: number    // sheep: seconds until the wool grows back
  dead: boolean
}

type ParticleKind = 'heart' | 'poof' | 'sparkle' | 'item' | 'feather' | 'arrow'

interface Particle {
  kind: ParticleKind
  x: number          // front-layer coordinates
  y: number
  vx: number
  vy: number
  life: number
  max: number
  img?: HTMLCanvasElement
  color?: string
  ground?: boolean   // falls and comes to rest on the terrain
  hatch?: boolean    // egg: may hatch into a chick
  flight?: number    // arrow: 1 while flying, 0 once stuck in the ground
  angle?: number     // arrow: direction once stuck
}

export interface Life {
  env: LifeEnv
  flocks: Flock[]
  bats: Bat[]
  mobs: Mob[]
  particles: Particle[]
  nextFlock: number
  nextBat: number
  nextMob: number
  /** Screen shake left, in seconds (creeper explosions) */
  shake: number
  bird: { big: HTMLCanvasElement[]; small: HTMLCanvasElement[]; bat: HTMLCanvasElement[] }
  heart: HTMLCanvasElement
  items: Record<ItemName, HTMLCanvasElement>
  arrow: { shaft: string; tip: string; fletch: string }
  sprites: Map<string, MobSprites>
}

const G = 140          // gravity, px/s²
const JUMP = 40        // enough to clear a one-block (4px) step
const MAX_STEP = 5     // anything taller is a wall
const ARROW_G = 70     // arrows fall slower than mobs so shots read as arcs
const MAX_PARTICLES = 140

const rand = (a: number, b: number) => a + Math.random() * (b - a)

// ── Setup ────────────────────────────────────────────────────

export function createLife(env: LifeEnv): Life {
  const birdFill = (ch: string) => (ch === '#' ? env.birdColor : null)
  const batFill = (ch: string) => (ch === '#' ? env.cfg.batColor ?? env.birdColor : null)
  const heart = paint(HEART, ch => (ch === '#' ? '#ff5fa8' : null))
  heart.getContext('2d')!.fillStyle = '#ffd1e6'
  heart.getContext('2d')!.fillRect(1, 1, 1, 1)

  const items = {} as Record<ItemName, HTMLCanvasElement>
  for (const name of Object.keys(ITEM_ROWS) as ItemName[]) {
    const { rows, colors } = ITEM_ROWS[name]
    const lit: Record<string, string> = {}
    for (const [k, v] of Object.entries(colors)) lit[k] = env.shade(v)
    items[name] = paint(rows, ch => lit[ch] ?? null)
  }

  const life: Life = {
    env,
    flocks: [],
    bats: [],
    mobs: [],
    particles: [],
    nextFlock: env.cfg.birds ? rand(4, 9) / env.cfg.birds : Infinity,
    nextBat: env.cfg.bats ? rand(6, 14) / env.cfg.bats : Infinity,
    nextMob: rand(10, 22),
    shake: 0,
    bird: {
      big: BIRD_BIG.map(rows => paint(rows, birdFill)),
      small: BIRD_SMALL.map(rows => paint(rows, birdFill)),
      bat: BAT.map(rows => paint(rows, batFill)),
    },
    heart,
    items,
    arrow: { shaft: env.shade('#c9b48a'), tip: env.shade('#a8adb5'), fletch: env.shade('#f2f2f2') },
    sprites: new Map(),
  }

  // Start with something already on screen so the scene never opens empty
  if (env.cfg.birds) spawnFlock(life, rand(0.25, 0.65))
  if (env.cfg.bats) spawnBat(life, rand(0.3, 0.7))
  const initial = Math.min(env.cfg.maxMobs, env.cfg.mobs.length ? (env.cfg.maxMobs > 2 ? 2 : 1) : 0)
  for (let i = 0; i < initial; i++) spawnMob(life, true)
  return life
}

function spritesFor(life: Life, kind: MobKind): MobSprites {
  let colors = DEFS[kind].colors
  let key: string = kind
  let wool: [string, string] | null = null
  if (kind === 'sheep') {
    let roll = Math.random()
    const variant = SHEEP_WOOL.find(v => (roll -= v[3]) < 0) ?? SHEEP_WOOL[0]
    colors = { ...colors, w: variant[1], W: variant[2] }
    key = `sheep:${variant[0]}`
    wool = [variant[1], variant[2]]
  }
  let s = life.sprites.get(key)
  if (!s) {
    const { shade } = life.env
    s = mobSprites(kind, colors, shade)
    if (wool) {
      s.sheared = mobSprites(kind, { ...colors, ...SHEARED }, shade)
      const [light, dark] = wool.map(shade)
      s.wool = paint(['wW', 'WW'], ch => (ch === 'w' ? light : ch === 'W' ? dark : null))
    }
    life.sprites.set(key, s)
  }
  return s
}

function spawnFlock(life: Life, atFraction?: number) {
  const { W, H } = life.env
  const big = Math.random() < 0.55
  const fromLeft = Math.random() < 0.5
  const low = Math.random() < 0.3
  const speed = big ? rand(13, 19) : rand(9, 13)
  const count = [1, 2, 3, 3, 4, 5][Math.floor(Math.random() * 6)]
  const gapX = big ? 6 : 4
  const gapY = big ? 3 : 2
  const birds: Bird[] = []
  for (let i = 0; i < count; i++) {
    const rank = Math.ceil(i / 2)
    const side = i % 2 ? 1 : -1
    birds.push({ dx: -rank * gapX + rand(-1, 1), dy: side * rank * gapY + rand(-0.5, 0.5), ph: Math.random() * 4 })
  }
  life.flocks.push({
    x: atFraction !== undefined ? W * atFraction : fromLeft ? -12 : W + 12,
    y: low ? rand(H * 0.38, H * 0.46) : rand(H * 0.05, H * 0.16),
    vx: fromLeft ? speed : -speed,
    vy: 0,
    big,
    birds,
    t: Math.random() * 10,
    flapRate: big ? rand(5, 7) : rand(7, 9),
    glideSeed: Math.random() * 10,
    fleeing: false,
  })
}

function spawnBat(life: Life, atFraction?: number) {
  const { W, H } = life.env
  const fromLeft = Math.random() < 0.5
  const speed = rand(14, 22)
  // Some cut across the moon, the rest flit lower over the mountains
  const y = Math.random() < 0.4 ? rand(H * 0.08, H * 0.2) : rand(H * 0.24, H * 0.45)
  life.bats.push({
    x: atFraction !== undefined ? W * atFraction : fromLeft ? -8 : W + 8,
    y,
    vx: fromLeft ? speed : -speed,
    vy: 0,
    t: 0,
    ph: Math.random() * 10,
    turn: rand(0.2, 0.6),
    fleeing: false,
  })
}

function groundAt(env: LifeEnv, x: number) {
  const g = env.groundTop
  return g[Math.max(0, Math.min(g.length - 1, Math.round(x)))]
}

function groundUnder(env: LifeEnv, x0: number, w: number) {
  let top = Infinity
  for (let x = Math.floor(x0) + 1; x < x0 + w - 1; x++) top = Math.min(top, groundAt(env, x))
  return top
}

function pickKind(cfg: LifeConfig): MobKind | null {
  const kinds = cfg.mobs.filter(k => DEFS[k].weight > 0)
  if (!kinds.length) return null
  const total = kinds.reduce((s, k) => s + DEFS[k].weight, 0)
  let roll = Math.random() * total
  for (const k of kinds) if ((roll -= DEFS[k].weight) < 0) return k
  return kinds[0]
}

function makeMob(life: Life, kind: MobKind, x: number, mode: Mob['mode'], dir: 1 | -1): Mob {
  const sprites = spritesFor(life, kind)
  return {
    kind, sprites, x,
    feet: groundUnder(life.env, x, sprites.w),
    vy: 0, kx: 0, dir,
    state: mode === 'roam' && Math.random() < 0.5 ? 'idle' : 'walk',
    t: rand(1.5, 4),
    animT: 0, frame: 0, mode,
    life: rand(25, 60),
    fuse: 0, dying: 0, hitFlash: 0, hits: 0, panic: 0,
    follow: 0, heartT: 0, aim: 0, aimAt: null, crouch: 0,
    flipOnLand: false, dustOnLand: false, sheared: 0,
    dead: false,
  }
}

function spawnMob(life: Life, onScreen = false) {
  const { env } = life
  const kind = pickKind(env.cfg)
  if (!kind) return
  const w = DEFS[kind].walk[0][0].length
  const fromLeft = Math.random() < 0.5
  const x = onScreen
    ? env.PAD + rand(0.12, 0.8) * env.W
    : fromLeft ? env.PAD - w - 2 : env.PAD + env.W + 2
  const dir = onScreen ? (Math.random() < 0.5 ? 1 : -1) : fromLeft ? 1 : -1
  life.mobs.push(makeMob(life, kind, x, onScreen ? 'roam' : 'enter', dir))
}

// ── Particles ────────────────────────────────────────────────

function emit(life: Life, p: Omit<Particle, 'max'> & { max?: number }) {
  if (life.particles.length >= MAX_PARTICLES) life.particles.shift()
  life.particles.push({ max: p.life, ...p })
}

function heartAbove(life: Life, m: Mob) {
  emit(life, { kind: 'heart', x: m.x + m.sprites.w / 2 - 2.5, y: m.feet - m.sprites.h - 6, vx: rand(-1.5, 1.5), vy: -9, life: 1.3, img: life.heart })
}

function puff(life: Life, x: number, y: number, n: number, colors: string[], speed = 16) {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rand(-0.25, 0.25)
    const s = rand(speed * 0.6, speed * 1.3)
    emit(life, { kind: 'poof', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 4, life: rand(0.5, 0.8), color: colors[i % colors.length] })
  }
}

/** An item that pops out, falls and rests on the ground for a while */
function drop(life: Life, img: HTMLCanvasElement, x: number, y: number, extra: Partial<Particle> = {}) {
  const vx = rand(7, 16) * (Math.random() < 0.5 ? -1 : 1)
  emit(life, { kind: 'item', x, y, vx, vy: rand(-26, -16), life: rand(3.5, 5), img, ground: true, ...extra })
}

function center(m: Mob) {
  return { x: m.x + m.sprites.w / 2, y: m.feet - m.sprites.h / 2 }
}

function die(life: Life, m: Mob) {
  m.dead = true
  const c = center(m)
  if (m.kind === 'creeper') {
    puff(life, c.x, c.y, 18, ['#f4f4f4', '#c4c4c8', '#ffb347', '#ff7a3d'], 24)
    life.shake = 0.35
    drop(life, life.items.gunpowder, c.x - 1, c.y)
    return
  }
  puff(life, c.x, c.y, 10, ['#e8e6ea'])
  if (m.kind === 'zombie') drop(life, life.items.flesh, c.x - 1, c.y)
  if (m.kind === 'skeleton') {
    drop(life, life.items.bone, c.x - 2, c.y)
    drop(life, life.items.bone, c.x, c.y)
  }
}

/** Shoots at wherever the cursor is when the bow is released; too close, and it's a warning shot into the ground */
function fireArrow(life: Life, m: Mob, cursor: ScenePointer | null) {
  let target = cursor ?? m.aimAt
  if (!target) return
  const x0 = m.x + (m.dir === 1 ? m.sprites.w : 0)
  const y0 = m.feet - m.sprites.h + 3
  if (Math.hypot(target.x - x0, target.y - y0) < 16) {
    const tx = x0 + m.dir * 26
    target = { x: tx, y: groundAt(life.env, tx) }
  }
  m.dir = target.x > m.x + m.sprites.w / 2 ? 1 : -1
  const dx = target.x - x0
  const dy = target.y - y0
  const T = Math.min(Math.max(Math.hypot(dx, dy) / 75, 0.35), 0.9)
  emit(life, {
    kind: 'arrow', x: x0, y: y0,
    vx: dx / T, vy: dy / T - 0.5 * ARROW_G * T,
    life: 6, flight: 1,
  })
  m.aimAt = null
}

function stepParticles(life: Life, dt: number) {
  const { env } = life
  for (const p of life.particles) {
    p.life -= dt
    switch (p.kind) {
      case 'poof':
        p.vx *= 0.9
        p.vy *= 0.9
        break
      case 'sparkle':
        p.vy *= 0.94
        break
      case 'feather':
        p.vx = Math.sin(p.life * 5) * 5
        p.vy = Math.min(p.vy + 20 * dt, 7)
        break
      case 'arrow':
        if (p.flight) {
          // Flies through the aim point and keeps arcing until it hits the ground.
          // Only a falling arrow can hit it, so shots fired past a step don't stop dead.
          p.vy += ARROW_G * dt
          const nx = p.x + p.vx * dt
          const ny = p.y + p.vy * dt
          if (p.vy > 0 && ny >= groundAt(env, nx)) {
            p.angle = Math.atan2(p.vy, p.vx)
            p.flight = 0
            p.vx = p.vy = 0
            p.y = groundAt(env, nx)
            p.life = 1.6
          } else {
            p.y = ny
          }
          p.x = nx
          if (p.x < 0 || p.x > env.groundTop.length || p.y > env.H) p.life = 0
        }
        break
    }
    if (p.kind === 'arrow') continue
    if (p.ground || p.kind === 'feather') {
      if (p.kind !== 'feather') p.vy += G * dt
      const h = p.img?.height ?? 2
      const floor = groundAt(env, p.x + (p.img?.width ?? 1) / 2) - h
      p.x += p.vx * dt
      p.y += p.vy * dt
      if (p.y >= floor) {
        p.y = floor
        p.vy = 0
        p.vx *= 0.7
      }
      continue
    }
    p.x += p.vx * dt
    p.y += p.vy * dt
  }

  // Eggs that run out may hatch into a chick
  for (const p of life.particles) {
    if (p.life <= 0 && p.hatch && life.mobs.length < env.cfg.maxMobs + 2) {
      const chick = makeMob(life, 'chick', p.x - 2, 'roam', Math.random() < 0.5 ? 1 : -1)
      chick.vy = -JUMP * 0.5
      life.mobs.push(chick)
      puff(life, p.x + 1, p.y + 1, 5, ['#f1e4c6'], 8)
    }
  }
  life.particles = life.particles.filter(p => p.life > 0)
}

// ── Simulation ───────────────────────────────────────────────

export function stepLife(life: Life, dt: number, pointer: ScenePointer | null, px: number, py: number) {
  const { env } = life
  const { W, PAD } = env
  life.shake = Math.max(0, life.shake - dt)

  // Birds
  life.nextFlock -= dt
  if (life.nextFlock <= 0) {
    if (life.flocks.length < 2) spawnFlock(life)
    life.nextFlock = rand(5, 12) / Math.max(env.cfg.birds, 0.01)
  }
  const birdOff = Math.round(px * 4)
  for (const f of life.flocks) {
    f.t += dt
    if (f.fleeing) {
      f.vy -= 26 * dt
    } else if (pointer) {
      const r = f.big ? 18 : 14
      for (const b of f.birds) {
        const bx = f.x + b.dx * Math.sign(f.vx) + birdOff
        const by = f.y + b.dy
        if (Math.abs(pointer.x - bx) < r && Math.abs(pointer.y - by) < r * 0.8) {
          scatter(f)
          break
        }
      }
    }
    f.x += f.vx * dt
    f.y += f.vy * dt
  }
  life.flocks = life.flocks.filter(f => f.x > -40 && f.x < W + 40 && f.y > -30)

  // Bats: fast, erratic, and quick to dart off
  life.nextBat -= dt
  if (life.nextBat <= 0) {
    if (life.bats.length < 2) {
      spawnBat(life)
      if (Math.random() < 0.35) spawnBat(life)
    }
    life.nextBat = rand(12, 26) / Math.max(env.cfg.bats, 0.01)
  }
  for (const b of life.bats) {
    b.t += dt
    b.turn -= dt
    if (b.turn <= 0) {
      b.turn = rand(0.15, 0.5)
      b.vy = rand(-14, 14)
      b.vx = Math.sign(b.vx) * rand(12, 24) * (b.fleeing ? 1.8 : 1)
    }
    if (b.fleeing) {
      b.vy -= 24 * dt
    } else if (pointer && Math.hypot(pointer.x - (b.x + birdOff), pointer.y - b.y) < 14) {
      fleeBat(b, pointer.x - birdOff)
    }
    b.x += b.vx * dt
    b.y += b.vy * dt
    if (!b.fleeing) b.y = Math.min(Math.max(b.y, env.H * 0.05), env.H * 0.5)
  }
  life.bats = life.bats.filter(b => b.x > -20 && b.x < W + 20 && b.y > -15)

  // Mobs
  life.nextMob -= dt
  if (life.nextMob <= 0) {
    if (life.mobs.length < env.cfg.maxMobs) spawnMob(life)
    life.nextMob = rand(9, 24)
  }
  // The cursor in front-layer coordinates, for mobs that follow or shoot at it
  const cursor = pointer ? { x: pointer.x + PAD - Math.round(px * 10), y: pointer.y - Math.round((py + 1) * 2) } : null
  for (const m of life.mobs) stepMob(life, m, dt, cursor)
  life.mobs = life.mobs.filter(m => !m.dead && m.x > PAD - m.sprites.w - 12 && m.x < PAD + W + 12)

  stepParticles(life, dt)
}

function scatter(f: Flock) {
  f.fleeing = true
  f.vy = -rand(16, 24)
  f.vx = Math.sign(f.vx) * Math.max(Math.abs(f.vx) * 1.8, 24)
  f.flapRate *= 2.2
}

function fleeBat(b: Bat, fromX: number) {
  b.fleeing = true
  b.vy = -rand(18, 26)
  b.vx = (b.x >= fromX ? 1 : -1) * rand(28, 36)
  b.turn = rand(0.3, 0.6)
}

function applyGravity(life: Life, m: Mob, dt: number) {
  const g = groundUnder(life.env, m.x, m.sprites.w)
  if (m.vy !== 0 || m.feet < g - 0.01) {
    m.vy += G * dt
    m.feet += m.vy * dt
    if (m.vy > 0 && m.feet >= g) {
      m.feet = g
      m.vy = 0
      landed(life, m)
    }
  } else {
    m.feet = g
  }
}

function landed(life: Life, m: Mob) {
  if (m.flipOnLand) {
    m.flipOnLand = false
    m.dir = m.dir === 1 ? -1 : 1
    m.panic = 1.6
    m.mode = 'leave'
  }
  if (m.dustOnLand) {
    m.dustOnLand = false
    const c = center(m)
    puff(life, c.x, m.feet - 1, 6, [life.env.shade('#7a6a52'), life.env.shade('#8fb86a')], 10)
    heartAbove(life, m)
  }
}

function stepMob(life: Life, m: Mob, dt: number, cursor: ScenePointer | null) {
  const { env } = life
  const def = DEFS[m.kind]
  const { w } = m.sprites
  const cursorX = cursor?.x ?? null

  // Last moments: creeper fuse or a defeated mob blinking out
  if (m.fuse > 0 || m.dying > 0) {
    if (m.fuse > 0) m.fuse -= dt
    if (m.dying > 0) m.dying -= dt
    if (m.fuse <= 0 && m.dying <= 0) die(life, m)
    m.x += m.kx * dt
    m.kx *= 1 - Math.min(1, 6 * dt)
    applyGravity(life, m, dt)
    return
  }

  m.hitFlash = Math.max(0, m.hitFlash - dt)

  if (m.sheared > 0) {
    m.sheared -= dt
    if (m.sheared <= 0) {
      const c = center(m)
      for (let i = 0; i < 5; i++) {
        emit(life, { kind: 'sparkle', x: c.x + rand(-4, 4), y: c.y + rand(-3, 1), vx: 0, vy: rand(-8, -4), life: rand(0.5, 0.9), color: '#fff8d6' })
      }
    }
  }

  // Special actions take over from wandering
  let busy = false
  let speedMul = 1
  if (m.aim > 0) {
    busy = true
    m.state = 'idle'
    const look = cursor ?? m.aimAt
    if (look) m.dir = look.x > m.x + w / 2 ? 1 : -1
    m.aim -= dt
    if (m.aim <= 0) fireArrow(life, m, cursor)
  } else if (m.crouch > 0) {
    busy = true
    m.state = 'idle'
    m.crouch -= dt
    if (m.crouch <= 0 && m.vy === 0) {
      m.vy = -JUMP * 1.45
      m.kx = m.dir * 26
      m.dustOnLand = true
    }
  } else if (m.panic > 0) {
    busy = true
    m.panic -= dt
    m.state = 'walk'
    speedMul = 3
  } else if (m.follow > 0) {
    busy = true
    m.follow -= dt
    if (cursorX !== null && Math.abs(cursorX - (m.x + w / 2)) > 3) {
      m.dir = cursorX > m.x + w / 2 ? 1 : -1
      m.state = 'walk'
      speedMul = m.kind === 'zombie' ? 1.8 : 1.5
    } else {
      m.state = 'idle'
    }
    if (m.kind === 'pig') {
      m.heartT -= dt
      if (m.heartT <= 0) {
        heartAbove(life, m)
        m.heartT = 1.4
      }
    }
  } else if (m.kind === 'chick') {
    // Stick close to the nearest chicken
    let mum: Mob | null = null
    for (const o of life.mobs) {
      if (o.kind === 'chicken' && !o.dead && (!mum || Math.abs(o.x - m.x) < Math.abs(mum.x - m.x))) mum = o
    }
    if (mum && Math.abs(mum.x - m.x) < 70) {
      busy = true
      const gap = mum.x + mum.sprites.w / 2 - (m.x + w / 2)
      if (Math.abs(gap) > 7) {
        m.dir = gap > 0 ? 1 : -1
        m.state = 'walk'
        speedMul = Math.abs(gap) > 20 ? 1.4 : 1
      } else {
        m.state = 'idle'
      }
    }
  }

  // Wandering
  m.t -= dt
  if (m.mode === 'roam') {
    m.life -= dt
    if (m.life <= 0) m.mode = 'leave'
  }
  if (!busy && m.t <= 0) {
    if (m.state === 'walk' && m.mode !== 'enter') {
      m.state = 'idle'
      m.t = m.mode === 'leave' ? rand(0.6, 1.5) : rand(1.5, 4.5)
    } else {
      m.state = 'walk'
      m.t = rand(2, 5)
      if (m.mode === 'roam' && Math.random() < 0.35) m.dir = m.dir === 1 ? -1 : 1
    }
  }

  const left = env.PAD + 2
  const right = env.PAD + env.W - w - 2
  if (m.mode === 'enter' && m.x >= left && m.x <= right) m.mode = 'roam'
  if (m.mode === 'roam' && m.panic <= 0) {
    if (m.x < left && m.dir < 0) m.dir = 1
    if (m.x > right && m.dir > 0) m.dir = -1
  }
  if (m.mode === 'leave' && !busy) m.dir = m.x + w / 2 < env.PAD + env.W / 2 ? -1 : 1

  // Walking, hopping up single blocks and turning back at walls
  const ground = groundUnder(env, m.x, w)
  const onGround = m.vy === 0 && m.feet >= ground - 0.01
  if (m.state === 'walk') {
    const nx = m.x + m.dir * def.speed * speedMul * dt
    const ahead = groundUnder(env, nx, w)
    if (ahead < m.feet - 0.5) {
      if (m.feet - ahead > MAX_STEP) {
        if (m.mode === 'leave') m.mode = 'roam'
        m.dir = m.dir === 1 ? -1 : 1
        if (!busy) {
          m.state = 'idle'
          m.t = rand(0.5, 1.2)
        }
      } else if (onGround) {
        m.vy = -JUMP
      } else if (m.feet <= ahead + 0.5) {
        m.x = nx
      }
    } else {
      m.x = nx
    }
    m.animT += dt * (speedMul > 2 ? 2.5 : 1)
    if (m.animT >= def.step) {
      m.animT = 0
      m.frame = m.frame ? 0 : 1
    }
  }

  // Knockback and pounces carry the mob sideways until it lands
  if (Math.abs(m.kx) > 0.2) {
    const nx = m.x + m.kx * dt
    if (groundUnder(env, nx, w) >= m.feet - 0.5) m.x = nx
    else m.kx = 0
    if (m.vy === 0) m.kx *= 1 - Math.min(1, 8 * dt)
  } else {
    m.kx = 0
  }

  applyGravity(life, m, dt)
}

// ── Interaction ──────────────────────────────────────────────

function mobScreenBox(life: Life, m: Mob, px: number, py: number) {
  const x = Math.round(m.x) - life.env.PAD + Math.round(px * 10)
  const y = Math.round(m.feet) - m.sprites.h + Math.round((py + 1) * 2)
  return { x, y, w: m.sprites.w, h: m.sprites.h }
}

export function mobAt(life: Life, p: ScenePointer, px: number, py: number): Mob | null {
  for (let i = life.mobs.length - 1; i >= 0; i--) {
    const m = life.mobs[i]
    if (m.dead || m.fuse > 0 || m.dying > 0) continue
    const b = mobScreenBox(life, m, px, py)
    if (p.x >= b.x - 1.5 && p.x <= b.x + b.w + 1.5 && p.y >= b.y - 2 && p.y <= b.y + b.h + 1) return m
  }
  return null
}

/** A click on the scene: interact with a mob, or startle nearby birds and bats. Returns true if something reacted. */
export function pokeLife(life: Life, p: ScenePointer, px: number, py: number): boolean {
  const m = mobAt(life, p, px, py)
  if (m) {
    pokeMob(life, m, p, px, py)
    return true
  }
  const birdOff = Math.round(px * 4)
  let hit = false
  for (const f of life.flocks) {
    if (f.fleeing) continue
    if (f.birds.some(b => Math.hypot(p.x - (f.x + b.dx * Math.sign(f.vx) + birdOff), p.y - (f.y + b.dy)) < 26)) {
      scatter(f)
      hit = true
    }
  }
  for (const b of life.bats) {
    if (!b.fleeing && Math.hypot(p.x - (b.x + birdOff), p.y - b.y) < 26) {
      fleeBat(b, p.x - birdOff)
      hit = true
    }
  }
  return hit
}

function pokeMob(life: Life, m: Mob, p: ScenePointer, px: number, py: number) {
  const onGround = m.vy === 0
  const box = mobScreenBox(life, m, px, py)
  const towardCursor: 1 | -1 = p.x > box.x + box.w / 2 ? 1 : -1
  const c = center(m)
  // The click position in front-layer coordinates (where arrows aim)
  const target = { x: p.x + life.env.PAD - Math.round(px * 10), y: p.y - Math.round((py + 1) * 2) }

  const hitBack = (strength: number) => {
    m.hits++
    m.hitFlash = 0.3
    m.kx = -towardCursor * strength
    if (onGround) m.vy = -JUMP * 0.55
    m.dir = towardCursor
  }

  switch (m.kind) {
    case 'sheep':
      if (m.sheared > 0) {
        if (onGround) m.vy = -JUMP * 0.7
        return
      }
      m.sheared = rand(30, 45)
      if (onGround) m.vy = -JUMP * 0.6
      for (let i = 0, n = 2 + Math.floor(Math.random() * 2); i < n; i++) {
        drop(life, m.sprites.wool!, c.x - 1 + rand(-2, 2), c.y - 1)
      }
      break

    case 'pig':
      m.follow = 6
      m.heartT = 0.6
      emit(life, { kind: 'item', x: c.x - 2, y: m.feet - m.sprites.h - 7, vx: 0, vy: -4, life: 0.9, img: life.items.carrot })
      break

    case 'chicken':
      if (onGround) m.vy = -JUMP * 1.15
      for (let i = 0; i < 3; i++) {
        emit(life, { kind: 'feather', x: c.x + rand(-3, 3), y: c.y + rand(-2, 1), vx: 0, vy: rand(-10, -4), life: rand(1.4, 2.2), color: life.env.shade('#f6f5f0') })
      }
      drop(life, life.items.egg, m.x + (m.dir === 1 ? 0 : m.sprites.w - 3), m.feet - 4, {
        vx: -m.dir * rand(2, 6), vy: -6, life: rand(4, 6), hatch: Math.random() < 0.35,
      })
      break

    case 'chick':
      if (onGround) m.vy = -JUMP * 0.8
      heartAbove(life, m)
      break

    case 'fox':
      if (m.crouch > 0 || !onGround) return
      m.dir = towardCursor
      m.crouch = 0.35
      break

    case 'spider':
      m.dir = towardCursor
      if (onGround) m.vy = -JUMP * 1.25
      m.kx = towardCursor * 32
      m.flipOnLand = true
      break

    case 'zombie':
      hitBack(34)
      if (m.hits >= 3) m.dying = 0.4
      else m.follow = 4.5
      break

    case 'skeleton':
      hitBack(26)
      if (m.hits >= 3) {
        m.dying = 0.4
      } else {
        m.aim = 0.45
        m.aimAt = target
      }
      break

    case 'creeper':
      m.fuse = 0.9
      if (onGround) m.vy = -JUMP * 0.5
      break
  }
}

// ── Drawing ──────────────────────────────────────────────────

export function drawBirds(ctx: CanvasRenderingContext2D, life: Life, px: number) {
  const off = Math.round(px * 4)
  for (const f of life.flocks) {
    const frames = f.big ? life.bird.big : life.bird.small
    const gliding = !f.fleeing && Math.sin(f.t * 0.45 + f.glideSeed) > 0.55
    const dirSign = Math.sign(f.vx)
    for (const b of f.birds) {
      const frame = gliding ? 1 : FLAP[Math.floor(f.t * f.flapRate + b.ph) % 4]
      const img = frames[frame]
      const bob = gliding ? 0 : Math.sin(f.t * 3 + b.ph) * 0.8
      ctx.drawImage(img, Math.round(f.x + b.dx * dirSign + off - img.width / 2), Math.round(f.y + b.dy + bob))
    }
  }
  for (const b of life.bats) {
    const img = life.bird.bat[FLAP[Math.floor(b.t * 14 + b.ph) % 4]]
    ctx.drawImage(img, Math.round(b.x + off - img.width / 2), Math.round(b.y))
  }
}

export function drawMobs(ctx: CanvasRenderingContext2D, life: Life, px: number, py: number) {
  const offX = -life.env.PAD + Math.round(px * 10)
  const offY = Math.round((py + 1) * 2)
  for (const m of life.mobs) {
    const s = m.sheared > 0 && m.sprites.sheared ? m.sprites.sheared : m.sprites
    const face = m.dir === 1 ? 0 : 1
    let img = m.state === 'walk' ? s.walk[m.frame][face] : s.idle[face]
    if (m.fuse > 0 && Math.floor(m.fuse * 10) % 2 === 0) img = s.white[face]
    if ((m.dying > 0 && Math.floor(m.dying * 14) % 2 === 0) || m.hitFlash > 0.15) img = s.hurt[face]
    const swell = m.fuse > 0 ? 1 : 0           // creepers swell as the fuse burns
    const squat = m.crouch > 0 ? 1 : 0          // foxes drop low before pouncing
    ctx.drawImage(
      img,
      Math.round(m.x) + offX - swell,
      Math.round(m.feet) - s.h + offY - swell + squat,
      s.w + swell * 2,
      s.h + swell - squat,
    )
  }

  for (const p of life.particles) {
    const fade = p.ground || p.kind === 'arrow' ? Math.min(1, p.life / 0.6) : Math.min(1, (p.life / p.max) * 1.4)
    ctx.globalAlpha = Math.max(0, fade)
    const x = Math.round(p.x) + offX
    const y = Math.round(p.y) + offY
    if (p.kind === 'arrow') {
      const a = p.flight ? Math.atan2(p.vy, p.vx) : p.angle ?? 0
      const dx = Math.cos(a)
      const dy = Math.sin(a)
      for (let i = 0; i < 5; i++) {
        ctx.fillStyle = i === 0 ? life.arrow.tip : i === 4 ? life.arrow.fletch : life.arrow.shaft
        ctx.fillRect(Math.round(p.x - dx * i) + offX, Math.round(p.y - dy * i) + offY, 1, 1)
      }
    } else if (p.img) {
      ctx.drawImage(p.img, x, y)
    } else {
      ctx.fillStyle = p.color ?? '#e8e6ea'
      const size = p.kind === 'poof' ? 2 : 1
      ctx.fillRect(x, y, size, p.kind === 'feather' ? 2 : size)
    }
  }
  ctx.globalAlpha = 1
}
