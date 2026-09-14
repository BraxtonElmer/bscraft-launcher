// ============================================================
// scenePlayers.ts — Who's online, living in the Play screen.
//
// Every player on the BSCraft server is in the landscape, drawn from
// their own skin with a Minecraft name tag, and they spend their time
// in little groups (joining up, splitting off, moving on): round the
// campfire toasting marshmallows, fishing at the
// pond, watching the sunset from the hill, lying under the stars,
// picnicking, dancing round a jukebox, chasing a chicken, playing tag,
// picking flowers for each other, or just wandering about, hugging and
// high-fiving whoever they bump into.
//
// You can join in: click someone and they wave; grab them and they
// dangle and kick; throw them and they ragdoll, splash into the pond
// or tumble to a stop, then dust themselves off. Overdo it and they
// end up under a gravestone, until an angel comes down for them.
// She can be clicked (she giggles), carried off (she flutters back) or
// flung away, and then an imp climbs out of the ground instead and
// brings them back its own way, with horns and a taste for mischief,
// unless you bonk it or throw it in the pond first.
//
// Positions are in world overlay pixels: the scene's front ground
// layer at twice its resolution, one skin pixel each.
// ============================================================

import {
  blendSkel, buildRig, drawSkel, makeCanvas,
  type Joints, type OnlinePlayer, type Rig, type Skel, type View, type XY,
} from './playerRig'
import {
  FOOT_F, FOOT_N, HEAD_PT, HIP, NECK, ragdollFromSkel, ragdollTop, skelFromRagdoll, stepRagdoll, throwRagdoll,
  type Ragdoll, type RagWorld,
} from './playerRagdoll'
import {
  bedAt, catchFish, createPond, drawBeam, drawBucket, drawCrack, drawHalo, drawImp, drawFire, drawGrave, drawAngel, drawJukebox,
  drawPicnic, drawPondBack, drawPondFront, drawReeds, drawRows, flatSpot, groundAt, hillSpot, inPond, lit, lure,
  pondSpot, splash, stepPond, surfaceAt,
  type Fire, type Icon, type Jukebox, type Light, type Picnic, type Pond,
} from './sceneProps'
import { drawSpeech, nameTag, speechSize } from './sceneLabels'
import type { LifeEnv, ScenePointer } from './sceneLife'

export type { OnlinePlayer } from './playerRig'

export interface PartyLight extends Light {
  time: 'night' | 'dusk' | 'dawn' | 'day'
  /** Where the sun or moon sits, as a fraction of the scene's width */
  sunX: number
}

type Activity = 'campfire' | 'fishing' | 'chase' | 'wander' | 'sunset' | 'stargaze' | 'picnic' | 'dance' | 'tag' | 'flowers'
type Stance = 'stand' | 'sit' | 'lie' | 'crouch'
type Gesture =
  | 'none' | 'wave' | 'cheer' | 'holdup' | 'stretch' | 'shake' | 'point' | 'pointUp' | 'lookup' | 'eat' | 'give'
  | 'hug' | 'highfive' | 'roast' | 'warm' | 'fish' | 'flail' | 'mourn' | 'sleep' | 'dance'
type Mode = 'free' | 'held' | 'ragdoll' | 'down' | 'getup' | 'swim' | 'dead' | 'rising'
type ItemKind = 'rod' | 'stick' | 'fish' | 'boot' | 'book' | 'flower' | 'apple' | 'cookie' | 'cake' | 'melon' | 'chicken'
type DanceMove = 'bounce' | 'arms' | 'sway' | 'spin' | 'crouch' | 'jump'

/** A body pose relative to the feet, with angles as if facing right */
interface Pose { hx: number; hy: number; body: number; head: number; armN: number; armF: number; legN: number; legF: number }
const POSE_KEYS = ['hx', 'hy', 'body', 'head', 'armN', 'armF', 'legN', 'legF'] as const

interface Item { kind: ItemKind; color?: string; toast?: number; burning?: number }
interface Spot { x: number; dir: 1 | -1; stance: Stance; fisher?: boolean }
interface Want { stance: Stance; gesture: Gesture; dir: 1 | -1 | 0; front: boolean }

interface Fishing {
  phase: 'ready' | 'windup' | 'cast' | 'fly' | 'wait' | 'bite' | 'reel' | 'show' | 'stash'
  t: number
  arm: number
  target: number
  bob: { x: number; y: number; vx: number; vy: number } | null
  tip: XY | null
  wait: number
  nibble: number
  dip: number
  catch: ItemKind
}

interface Pair { kind: 'hug' | 'highfive' | 'crouch' | 'wave'; a: Figure; b: Figure; t: number; met: boolean }

/** A few people doing something together; there can be several groups at once */
interface Group {
  activity: Activity
  /** Until they move on to something else */
  timer: number
  /** Where it's happening: its place (the fire, the pond...), or the middle of the patch they roam */
  x: number
  span: number
  /** Tag: who's it */
  it: Figure | null
}

interface React {
  kind: 'look' | 'wave' | 'mourn' | 'cheer' | 'hot' | 'shake' | 'flee'
  t: number
  x: number
  /** Mourning: whose grave */
  of?: Figure
  /** Looking up (at the angel) rather than across */
  up?: boolean
  /** Fleeing: from whom */
  by?: Chaser
}

/** Someone chasing everyone about: a player with devil horns, or the imp */
type Chaser = { fig: Figure } | { imp: Imp }

interface Figure {
  key: string
  name: string
  group: Group | null
  skin: OnlinePlayer['skin']
  rig: Rig
  /** Feet position */
  x: number
  vx: number
  dest: number | null
  fast: boolean
  dir: 1 | -1
  front: boolean
  /** Turning round: counts down, drawn as a quick squash through the old view */
  flip: number
  from: View
  want: Want
  skel: Skel
  /** The pose springs: current pose, its velocities, and the skeleton they last produced */
  pose: Pose | null
  poseV: Pose
  poseOut: Skel | null
  /** Ground height under the feet, smoothed over steps in the terrain */
  feet: number
  /** The stance being shown, and how long since it changed */
  stance: Stance
  stanceT: number
  phase: number
  mode: Mode
  modeT: number
  rag: Ragdoll | null
  spot: Spot | null
  sub: string
  subT: number
  subDur: number
  item: Item | null
  fishing: Fishing | null
  pair: Pair | null
  react: React | null
  bubble: { icon: Icon; age: number; life: number } | null
  faceCam: boolean
  faceT: number
  blink: number
  jump: number
  jumpV: number
  /** Crouching to jump: time left, and the take-off speed */
  hopT: number
  hopV: number
  /** Smoothed acceleration, for leaning into starts and stops */
  acc: number
  lastVx: number
  /** Idle head turns, and a nod when they say something */
  glance: number
  glanceT: number
  nod: number
  nodDir: number
  /** >0 squashed (landing, crouching), <0 stretched (taking off) */
  squash: number
  hurt: number
  dizzy: number
  red: number
  halo: number
  /** Brought back by the imp: horns, a tail and chasing everyone for this long */
  devil: number
  prank: Figure | null
  prankLast: Figure | null
  prankCool: number
  wet: number
  lastHit: number
  immune: number
  danceMove: DanceMove
  bucket: number
  leaving: boolean
  hidden: boolean
  rise: number
  t: number
  /** Last drawn head top and bounds, for name tags, bubbles and clicks */
  head: XY
  box: { x0: number; y0: number; x1: number; y1: number }
  /** Where the name tag is: following the head, nudged aside (dx) or up a row (lift) to make room */
  tag: { x: number; y: number; dx: number; lift: number; row: number; hold: number; ready: boolean }
}

interface Particle {
  x: number; y: number; vx: number; vy: number
  life: number; max: number
  kind: 'dot' | 'smoke' | 'heart' | 'note' | 'spark' | 'drop' | 'dust' | 'z'
  color: string
  g: number
}

interface Flyer { x: number; y: number; vx: number; vy: number; t: number; kind: ItemKind; to: Figure }

interface Chicken { x: number; dir: 1 | -1; hop: number; hopV: number; t: number; rest: number; flap: number; held: Figure | null; free: boolean }

interface Grave {
  f: Figure
  x: number
  /**
   * ko → grave → angel → raise → depart, the kind way; or, with the angel flung away,
   * spurned → rumble → imp → gone (back with horns), or back to angel if the imp is seen off
   */
  phase: 'ko' | 'grave' | 'angel' | 'raise' | 'depart' | 'spurned' | 'rumble' | 'imp' | 'gone'
  t: number
  rise: number
  glow: number
  beam: number
  arms: number
  alpha: number
  angel: Angel
  imp: Imp | null
  /** The glowing crack the imp comes up through, 0..1 */
  crack: number
  /** The angel's halo, knocked off when she's flung */
  halo: { x: number; y: number; vy: number; t: number; down: boolean } | null
  /** A speech bubble over the angel or the imp */
  talk: { who: 'angel' | 'imp'; icon: Icon; age: number; life: number } | null
  shake: number
}

interface Angel {
  /** fly: doing her job; held: picked up; back: fluttering back; flung: thrown away; off: not here */
  state: 'off' | 'fly' | 'held' | 'back' | 'flung'
  x: number
  y: number
  vx: number
  vy: number
  spin: number
  /** Time left of a happy twirl, after a click */
  twirl: number
  t: number
}

interface Imp {
  state: 'rise' | 'cackle' | 'poke' | 'chase' | 'home' | 'bye' | 'held' | 'flung' | 'dizzy' | 'sulk' | 'dive' | 'sizzle'
  x: number
  y: number
  vx: number
  vy: number
  t: number
  dir: 1 | -1
  pokes: number
  /** 0 standing on the ground .. 1 all the way under it */
  sink: number
  /** Bonked or thrown: it gives up, and the angel comes back */
  beaten: boolean
  air: boolean
  /** After raising them it chases everyone about for a while */
  chaseT: number
  victim: Figure | null
  last: Figure | null
  /** Catching its breath after a jab, and the jab itself */
  rest: number
  jab: number
}

interface SpiritPress {
  g: Grave
  who: 'angel' | 'imp'
  sx: number
  sy: number
  t: number
  grabbed: boolean
  gx: number
  gy: number
  samples: { x: number; y: number; t: number }[]
}

interface Press {
  f: Figure
  sx: number
  sy: number
  t: number
  grabbed: boolean
  gx: number
  gy: number
  samples: { x: number; y: number; t: number }[]
}

interface Butterfly { x: number; y: number; t: number; color: string; on: Figure | null; onT: number; ph: number }

export interface Party {
  env: LifeEnv
  light: PartyLight
  figures: Figure[]
  groups: Group[]
  /** Until everyone shuffles into new groups */
  timer: number
  started: boolean
  sites: { fire: number; hill: number; picnic: number }
  pond: Pond
  fire: Fire
  picnic: Picnic | null
  jukebox: Jukebox | null
  chicken: Chicken | null
  graves: Grave[]
  particles: Particle[]
  flyers: Flyer[]
  butterflies: Butterfly[]
  press: Press | null
  /** Pressing on the angel or an imp */
  spirit: SpiritPress | null
  beat: number
  t: number
  offX: number
  offY: number
  cursor: XY | null
  lo: number
  hi: number
}

const WALK = 14
const RUN = 26
const ACCEL = 90
const GRAVITY = 520
const FLIP = 0.14
const BPM = 116
const EDGE = 44
const NOTE_COLORS = ['#ff5fa8', '#6a4cff', '#3ac8ff', '#5fdc6a', '#ffc93a']
const FLOWER_COLORS = ['#e8342a', '#f2d14a', '#6a8cff', '#f29ac2', '#ffffff']
const FOODS: ItemKind[] = ['apple', 'cookie', 'cake', 'melon']

const rand = (a: number, b: number) => a + Math.random() * (b - a)
const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)]
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
const easeOut = (k: number) => 1 - Math.pow(1 - clamp(k, 0, 1), 3)

// ── Setting up ───────────────────────────────────────────────

export function createParty(env: LifeEnv, light: PartyLight): Party {
  const party = { env, light, figures: [], groups: [], timer: 0, started: false } as unknown as Party
  Object.assign(party, {
    graves: [], particles: [], flyers: [], butterflies: [], press: null, spirit: null, beat: 0, t: 0,
    offX: 0, offY: 0, cursor: null, picnic: null, jukebox: null, chicken: null,
  })
  place(party, env)
  return party
}

/** Lays out the pond, the campfire, the hill and the picnic spot on this ground */
function place(party: Party, env: LifeEnv) {
  party.env = env
  party.lo = env.PAD * 2 + 10
  party.hi = (env.PAD + env.W) * 2 - 10
  const spot = pondSpot(env.groundTop, env.W, env.PAD)
  party.pond = createPond(env, spot)
  const L = env.PAD * 2, span = env.W * 2
  const pondZone: [number, number] = [party.pond.x0 - 24, party.pond.x1 + 24]
  const pondMid = (party.pond.x0 + party.pond.x1) / 2
  const fire = flatSpot(env, 16, L + span * 0.14, L + span * 0.86, [pondZone], pondMid < L + span / 2 ? L + span * 0.72 : L + span * 0.28)
  const hill = hillSpot(env, 26, L + span * 0.1, L + span * 0.9, [pondZone])
  const picnic = flatSpot(env, 22, L + span * 0.18, L + span * 0.82, [pondZone, [fire - 34, fire + 34]], L + span * 0.5)
  party.sites = { fire, hill, picnic }
  party.fire = { x: fire, a: party.fire?.a ?? 0, lit: party.fire?.lit ?? false }
}

/** The scene was rebuilt (resized, or the time of day changed): same players, new light */
export function retargetParty(party: Party, env: LifeEnv, light: PartyLight) {
  const changed = light.time !== party.light.time
  party.light = light
  if (env !== party.env) {
    const bed = party.env.groundTop.length === env.groundTop.length
    party.env = env
    if (!bed) {
      place(party, env)
      for (const f of party.figures) {
        f.x = clamp(f.x, party.lo, party.hi)
        stopFishing(party, f)
        if (f.mode === 'swim' && !inPond(party.pond, f.x)) { f.mode = 'free'; f.wet = 4 }
      }
      if (party.picnic) party.picnic.x = party.sites.picnic
      if (party.jukebox) party.jukebox.x = party.sites.picnic
      for (const g of party.graves) g.x = clamp(g.x, party.lo + 6, party.hi - 6)
      if (!changed) for (const g of party.groups) begin(party, g, g.activity)
    }
  }
  if (changed && live(party).length) regroup(party)
}

export function partyEvent(party: Party, event: 'star') {
  if (event !== 'star') return
  // A shooting star: everyone lying out under the sky points at it
  for (const f of live(party)) {
    if (f.mode !== 'free' || activityOf(f) !== 'stargaze') continue
    setSub(f, 'point', 2.4)
    say(f, Math.random() < 0.5 ? 'excl' : 'star')
  }
}

const live = (party: Party) => party.figures.filter(f => !f.leaving)
const members = (party: Party, g: Group) => party.figures.filter(f => f.group === g && !f.leaving)
const activityOf = (f: Figure): Activity => f.group?.activity ?? 'wander'
const free = (party: Party) => party.figures.filter(f => !f.leaving && !f.hidden && f.mode === 'free')

function newFigure(party: Party, key: string, p: OnlinePlayer, x: number, dir: 1 | -1): Figure {
  const feet = feetY(party, x)
  const skel: Skel = { x, y: feet - 12, body: 0, head: 0, armN: 0, armF: 0, legN: 0, legF: 0 }
  return {
    key, name: p.name ?? '', group: null, skin: p.skin, rig: buildRig(p),
    x, vx: 0, dest: null, fast: false, dir, front: false, flip: 0, from: { dir, front: false },
    want: { stance: 'stand', gesture: 'none', dir: 0, front: false },
    skel, pose: null, poseV: zeroPose(), poseOut: null, feet, stance: 'stand', stanceT: 1, phase: 0, mode: 'free', modeT: 0, rag: null, spot: null,
    sub: '', subT: 0, subDur: 0, item: null, fishing: null, pair: null, react: null, bubble: null,
    faceCam: false, faceT: rand(1, 4), blink: rand(1, 4), jump: 0, jumpV: 0, hopT: 0, hopV: 0,
    acc: 0, lastVx: 0, glance: 0, glanceT: rand(1, 4), nod: 1, nodDir: 1, squash: 0,
    hurt: 0, dizzy: 0, red: 0, halo: 0, devil: 0, prank: null, prankLast: null, prankCool: 0, wet: 0, lastHit: 0, immune: 0, danceMove: 'bounce', bucket: 0,
    leaving: false, hidden: false, rise: 0, t: rand(0, 10),
    head: { x, y: feet - 32 }, box: { x0: x - 5, y0: feet - 32, x1: x + 5, y1: feet },
    tag: { x, y: feet - 40, dx: 0, lift: 0, row: 0, hold: 0, ready: false },
  }
}

/** Players who came online walk in from the sides; players who left walk off */
export function syncParty(party: Party, players: OnlinePlayer[]) {
  const wanted = new Map<string, OnlinePlayer>()
  players.forEach((p, i) => wanted.set(p.name ? p.name.toLowerCase() : `?${i}`, p))

  let changed = false
  for (const f of party.figures) {
    const p = wanted.get(f.key)
    if (!p) {
      if (!f.leaving) { f.leaving = true; f.spot = null; interrupt(party, f); f.react = null; changed = true }
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
    const x = first ? rand(party.lo + 30, party.hi - 30) : fromLeft ? party.lo - EDGE + 4 : party.hi + EDGE - 4
    party.figures.push(newFigure(party, key, p, x, fromLeft ? 1 : -1))
    changed = true
  }
  if (players.length) party.started = true
  if (!changed) return

  if (first && live(party).length) {
    // The first players are already hanging out when the launcher opens
    regroup(party, true)
    for (const f of live(party)) if (f.spot) snapTo(party, f, f.spot)
  } else if (live(party).length) {
    // Newcomers join whichever group is nearest where they come in
    for (const f of live(party)) {
      if (f.group && party.groups.includes(f.group)) continue
      const g = [...party.groups].sort((a, b) => Math.abs(a.x - f.x) - Math.abs(b.x - f.x))[0]
      if (g) f.group = g
      else { regroup(party); return }
    }
    tidyGroups(party)
    for (const g of party.groups) assign(party, g)
  }
}

// ── Activities ───────────────────────────────────────────────

/** The place each activity needs to itself: one group at a time there */
const SITE: Partial<Record<Activity, string>> = {
  campfire: 'fire', fishing: 'pond', sunset: 'hill', picnic: 'meadow', dance: 'meadow', stargaze: 'meadow', chase: 'chicken', tag: 'tag',
}

function pickActivity(party: Party, g: Group): Activity {
  const n = members(party, g).length
  const time = party.light.time
  const w: Partial<Record<Activity, number>> =
    time === 'night' ? { campfire: 5, stargaze: 4, dance: 1.2, fishing: 1, wander: 0.8 }
    : time === 'dusk' ? { sunset: 5, campfire: 3, fishing: 1.5, dance: 1.5, wander: 0.8 }
    : time === 'dawn' ? { sunset: 3.5, fishing: 3, picnic: 2, flowers: n > 1 ? 1.5 : 0, wander: 1.5 }
    : { fishing: 3, picnic: 3, chase: 2.5, tag: n > 1 ? 2.5 : 0, flowers: n > 1 ? 2 : 0, stargaze: 1.2, dance: 1, wander: 1.5 }
  // Not where another group already is, and not the same as another group if there's a choice
  const others = party.groups.filter(o => o !== g && members(party, o).length)
  const taken = new Set(others.map(o => SITE[o.activity]).filter(Boolean))
  for (const a of Object.keys(w) as Activity[]) {
    if (SITE[a] && taken.has(SITE[a])) w[a] = 0
    else if (others.some(o => o.activity === a)) w[a]! *= 0.3
  }
  if (w[g.activity]) w[g.activity]! *= 0.12
  const entries = Object.entries(w) as [Activity, number][]
  let roll = Math.random() * entries.reduce((s, [, v]) => s + v, 0)
  for (const [a, v] of entries) if ((roll -= v) <= 0) return a
  return 'wander'
}

/** How many groups suit this many people */
function groupCount(n: number): number {
  if (n <= 2) return 1
  if (n <= 4) return Math.random() < 0.55 ? 2 : 1
  if (n <= 7) return Math.random() < 0.3 ? 3 : 2
  return Math.random() < 0.5 ? 3 : 4
}

/** Everyone into new groups: whoever's near each other goes together */
function regroup(party: Party, instant = false) {
  party.timer = rand(150, 220)
  const fs = live(party).sort((a, b) => a.x - b.x)
  if (!fs.length) { party.groups = []; syncProps(party, instant); return }
  const k = Math.min(fs.length, groupCount(fs.length))
  party.groups = []
  let at = 0
  for (let i = 0; i < k; i++) {
    const left = fs.length - at, size = i === k - 1 ? left : Math.max(1, Math.round(left / (k - i) + rand(-0.6, 0.6)))
    const g: Group = { activity: 'wander', timer: 0, x: 0, span: 0, it: null }
    party.groups.push(g)
    for (const f of fs.slice(at, at + size)) f.group = g
    at += size
  }
  for (const g of party.groups) begin(party, g, pickActivity(party, g), instant)
}

/** A group's time is up: they join up with another group, split in two, or just do something else */
function moveOn(party: Party, g: Group) {
  const mine = members(party, g)
  const others = party.groups.filter(o => o !== g && members(party, o).length)
  const want = groupCount(live(party).length)
  if (others.length && (party.groups.length > want || Math.random() < 0.2)) {
    const o = others.sort((a, b) => Math.abs(a.x - g.x) - Math.abs(b.x - g.x))[0]
    for (const f of mine) {
      f.group = o
      resetFor(party, f)
      if (Math.random() < 0.5) say(f, pick(['heart', 'note', 'excl']), 1.4)
    }
    party.groups = party.groups.filter(q => q !== g)
    syncProps(party)
    assign(party, o)
    return
  }
  if (mine.length >= 3 && (party.groups.length < want || Math.random() < 0.25)) {
    const h: Group = { activity: 'wander', timer: 0, x: 0, span: 0, it: null }
    party.groups.push(h)
    for (const f of mine.sort((a, b) => a.x - b.x).slice(Math.ceil(mine.length / 2))) f.group = h
    begin(party, h, pickActivity(party, h))
  }
  begin(party, g, pickActivity(party, g))
}

/** Drops groups nobody is in any more */
function tidyGroups(party: Party) {
  const before = party.groups.length
  party.groups = party.groups.filter(g => members(party, g).length)
  for (const f of party.figures) if (f.group && !party.groups.includes(f.group)) f.group = null
  if (party.groups.length !== before) syncProps(party)
}

/** Clears what someone was doing for their group, ready for something new */
function resetFor(party: Party, f: Figure) {
  // Whoever was holding up the chicken lets it go
  const ch = party.chicken
  if (ch?.held === f) { ch.held = null; ch.free = true; ch.x = f.x; f.item = null }
  if (f.fishing || f.spot?.fisher) f.bucket = 0
  stopFishing(party, f)
  if (f.pair) unpair(f.pair)
  f.sub = ''
  f.subT = 0
  f.subDur = 0
  if (f.item && f.item.kind !== 'flower' && f.item.kind !== 'chicken') f.item = null
}

/** Sets out (or packs away) the things the groups' activities need */
function syncProps(party: Party, instant = false) {
  const has = (a: Activity) => party.groups.some(g => g.activity === a && members(party, g).length)
  party.fire.lit = has('campfire')
  if (instant) party.fire.a = party.fire.lit ? 1 : 0
  if (has('picnic')) {
    if (!party.picnic || party.picnic.dying) party.picnic = { x: party.sites.picnic, half: 0, a: instant ? 1 : 0, dying: false, cake: 0 }
  } else if (party.picnic) {
    party.picnic.dying = true
  }
  if (has('dance')) {
    if (!party.jukebox || party.jukebox.dying) {
      party.jukebox = { x: party.sites.picnic, a: instant ? 1 : 0, dying: false }
      party.beat = 0
    }
  } else if (party.jukebox) {
    party.jukebox.dying = true
  }
  if (has('chase')) {
    if (!party.chicken || party.chicken.free) {
      const g = party.groups.find(q => q.activity === 'chase')!
      party.chicken = { x: clamp(g.x + rand(-30, 30), party.lo + 30, party.hi - 30), dir: Math.random() < 0.5 ? 1 : -1, hop: 0, hopV: 0, t: 0, rest: 2, flap: 0, held: null, free: false }
    }
  } else if (party.chicken && !party.chicken.held) {
    party.chicken.free = true
  }
  if (!has('fishing')) for (const fish of party.pond.fish) fish.target = null
}

/** Somewhere to roam that's clear of the other groups and the pond */
function roamPatch(party: Party, g: Group, n: number): { x: number; span: number } {
  const span = clamp(50 + n * 14, 60, 140)
  const others = party.groups.filter(o => o !== g && o.x)
  const { pond } = party
  const spots: { x: number; score: number }[] = []
  for (let x = party.lo + span * 0.6; x <= party.hi - span * 0.6; x += 16) {
    const clear = others.length ? Math.min(...others.map(o => Math.abs(o.x - x) - o.span * 0.5)) : 200
    const wet = x > pond.x0 - 20 && x < pond.x1 + 20 ? 60 : 0
    spots.push({ x, score: clear - wet + rand(0, 40) })
  }
  spots.sort((a, b) => b.score - a.score)
  return { x: spots[0]?.x ?? (party.lo + party.hi) / 2, span }
}

/** A group starts an activity: its things are set out and everyone in it gets a spot */
function begin(party: Party, g: Group, activity: Activity, instant = false) {
  g.activity = activity
  g.timer = rand(45, 75)
  g.it = null
  const mine = members(party, g)
  const { sites, pond } = party
  const at: Partial<Record<Activity, number>> = { campfire: sites.fire, fishing: (pond.x0 + pond.x1) / 2, sunset: sites.hill, picnic: sites.picnic, dance: sites.picnic, stargaze: sites.picnic }
  if (at[activity] !== undefined) {
    g.x = at[activity]!
    g.span = 60
  } else {
    Object.assign(g, roamPatch(party, g, mine.length))
  }
  for (const f of mine) resetFor(party, f)
  syncProps(party, instant)
  assign(party, g)
}

/** Gives everyone in a group a place in its activity (again when someone joins or leaves) */
function assign(party: Party, g: Group) {
  const fs = members(party, g)
  const n = fs.length
  const { pond, sites } = party
  const sunWorld = party.env.PAD * 2 + party.light.sunX * party.env.W * 2
  const sunDir: 1 | -1 = sunWorld > sites.hill ? 1 : -1
  if (party.picnic && !party.picnic.dying) party.picnic.half = 10 + Math.ceil(n / 2) * 14

  fs.forEach((f, i) => {
    const side: 1 | -1 = i % 2 === 0 ? -1 : 1
    const ring = Math.floor(i / 2)
    let spot: Spot | null = null
    switch (g.activity) {
      case 'campfire':
        spot = { x: sites.fire + side * (20 + ring * 20), dir: side === -1 ? 1 : -1, stance: 'sit' }
        break
      case 'fishing':
        if (i < 2) spot = { x: i === 0 ? pond.x0 - 8 : pond.x1 + 8, dir: i === 0 ? 1 : -1, stance: 'stand', fisher: true }
        else {
          const k = i - 2, s2: 1 | -1 = k % 2 === 0 ? -1 : 1, d = 26 + Math.floor(k / 2) * 18
          spot = { x: s2 < 0 ? pond.x0 - d : pond.x1 + d, dir: s2 < 0 ? 1 : -1, stance: 'sit' }
        }
        break
      case 'sunset':
        spot = { x: sites.hill + (i - (n - 1) / 2) * 16, dir: sunDir, stance: 'sit' }
        break
      case 'stargaze':
        // In pairs, head to head
        spot = { x: sites.picnic + (i - (n - 1) / 2) * 34 + (i % 2 === 0 ? 4 : -4), dir: i % 2 === 0 ? 1 : -1, stance: 'lie' }
        break
      case 'picnic':
        spot = { x: sites.picnic + side * (9 + ring * 14), dir: side === -1 ? 1 : -1, stance: 'sit' }
        break
      case 'dance':
        spot = { x: sites.picnic + side * (18 + ring * 20), dir: side === -1 ? 1 : -1, stance: 'stand' }
        f.danceMove = pick(['bounce', 'arms', 'sway', 'spin', 'crouch', 'jump'])
        break
      default:
        spot = null
    }
    if (spot) spot.x = clamp(spot.x, party.lo + 6, party.hi - 6)
    if (f.fishing && (!spot?.fisher || Math.abs((f.spot?.x ?? 0) - spot.x) > 1)) stopFishing(party, f)
    f.spot = spot
  })
  if (g.activity === 'tag' && !g.it && fs.length) g.it = pick(fs)
}

function snapTo(party: Party, f: Figure, spot: Spot) {
  f.x = spot.x
  f.dir = spot.dir
  f.want = { stance: spot.stance, gesture: 'none', dir: spot.dir, front: false }
  f.skel = targetSkel(party, f)
}

// ── Speech, particles ───────────────────────────────────────

function say(f: Figure, icon: Icon, life = 1.7) {
  f.bubble = { icon, age: 0, life }
  // A little nod as they say it; surprise perks the head up instead
  f.nod = 0
  f.nodDir = icon === 'excl' || icon === 'quest' || icon === 'star' ? -1 : 1
}

function emit(party: Party, kind: Particle['kind'], x: number, y: number, n = 1, color = '') {
  for (let i = 0; i < n; i++) {
    const p: Particle = { x, y, vx: 0, vy: 0, life: 1, max: 1, kind, color, g: 0 }
    switch (kind) {
      case 'heart': p.vx = rand(-4, 4); p.vy = rand(-16, -11); p.life = 1.5; break
      case 'note': p.vx = rand(-8, 8); p.vy = rand(-18, -12); p.life = 1.7; p.color = color || pick(NOTE_COLORS); break
      case 'spark': p.vx = rand(-14, 14); p.vy = rand(-16, 6); p.life = rand(0.5, 1); p.color = color || '#fff3a8'; break
      case 'smoke': p.x += rand(-2, 2); p.vx = rand(-3, 3); p.vy = rand(-12, -6); p.life = rand(1.6, 2.4); p.g = -1; break
      case 'dust': p.vx = rand(-18, 18); p.vy = rand(-14, -4); p.life = rand(0.4, 0.8); p.g = 40; p.color = color || '#b8a48a'; break
      case 'drop': p.vx = rand(-24, 24); p.vy = rand(-60, -25); p.life = rand(0.6, 1); p.g = 300; p.color = '#bfe0ff'; break
      case 'z': p.vx = rand(2, 5); p.vy = -8; p.life = 1.8; break
      case 'dot': p.vx = rand(-10, 10); p.vy = rand(-24, -8); p.life = rand(0.6, 1.1); p.g = 60; p.color = color || '#f4f1ea'; break
    }
    p.max = p.life
    party.particles.push(p)
  }
}

// ── Helpers for moving about ────────────────────────────────

/** Top of the ground under someone's feet at x */
function feetY(party: Party, x: number): number {
  let top = Infinity
  for (let i = Math.floor(x - 3); i <= Math.ceil(x + 3); i++) top = Math.min(top, groundAt(party.env, i))
  return top
}

function goTo(f: Figure, x: number, fast = false) {
  f.dest = x
  f.fast = fast
}

const arrived = (f: Figure) => f.dest === null && Math.abs(f.vx) < 1.5

function hold(f: Figure, stance: Stance, gesture: Gesture = 'none', dir: 1 | -1 | 0 = 0, front = false) {
  f.want = { stance, gesture, dir, front }
}

/** Jumps, after a quick crouch unless `windup` is 0 (e.g. to land on the beat) */
function hop(f: Figure, v = 115, windup = 0.09) {
  if (f.jump !== 0 || f.jumpV !== 0 || f.hopT > 0) return
  if (windup > 0) {
    f.hopT = windup
    f.hopV = v
  } else {
    f.jumpV = -v
    f.squash = -0.4
  }
}

function setSub(f: Figure, sub: string, dur: number) {
  f.sub = sub
  f.subT = 0
  f.subDur = dur
}

function nearest(party: Party, f: Figure, filter: (o: Figure) => boolean = () => true): Figure | null {
  let best: Figure | null = null
  for (const o of party.figures) {
    if (o === f || o.leaving || o.hidden || !filter(o)) continue
    if (!best || Math.abs(o.x - f.x) < Math.abs(best.x - f.x)) best = o
  }
  return best
}

// ── Simulation ───────────────────────────────────────────────

export function stepParty(party: Party, dt: number, pointer: ScenePointer | null, px: number, py: number) {
  party.t += dt
  party.offX = (Math.round(px * 10) - party.env.PAD) * 2
  party.offY = Math.round((py + 1) * 2) * 2
  party.cursor = pointer ? { x: pointer.x * 2 - party.offX, y: pointer.y * 2 - party.offY } : party.cursor

  const people = live(party)
  party.timer -= dt
  if (party.timer <= 0 && people.length) regroup(party)
  tidyGroups(party)
  for (const g of [...party.groups]) {
    g.timer -= dt
    if (g.timer <= 0 && party.groups.includes(g)) moveOn(party, g)
  }
  if (!people.length) party.fire.lit = false

  stepPond(party.pond, dt)
  party.fire.a = clamp(party.fire.a + (party.fire.lit ? dt / 1.5 : -dt / 2.5), 0, 1)
  if (party.picnic) {
    party.picnic.a += party.picnic.dying ? -dt / 0.8 : dt / 1.2
    if (party.picnic.a <= 0) party.picnic = null
  }
  if (party.jukebox) {
    party.jukebox.a += party.jukebox.dying ? -dt / 0.5 : dt / 0.6
    if (party.jukebox.a <= 0) party.jukebox = null
    else if (!party.jukebox.dying) {
      const before = Math.floor(party.beat * BPM / 60)
      party.beat += dt
      if (Math.floor(party.beat * BPM / 60) !== before && party.jukebox.a >= 1) {
        emit(party, 'note', party.jukebox.x + rand(-3, 3), feetY(party, party.jukebox.x) - 12)
      }
    }
  }

  stepPress(party, dt)
  stepChicken(party, dt)
  for (const f of party.figures) stepFigure(party, f, dt)
  party.figures = party.figures.filter(f => !(f.leaving && f.mode === 'free' && (f.x <= party.lo - EDGE + 1 || f.x >= party.hi + EDGE - 1)))
  stepGraves(party, dt)
  stepFlyers(party, dt)
  stepButterflies(party, dt)

  // Campfire smoke and sparks
  if (party.fire.a > 0.3) {
    const fy = feetY(party, party.fire.x)
    if (Math.random() < dt * 4 * party.fire.a) emit(party, 'smoke', party.fire.x, fy - 12)
    if (Math.random() < dt * 2.5 * party.fire.a) {
      party.particles.push({ x: party.fire.x + rand(-3, 3), y: fy - 8, vx: rand(-5, 5), vy: rand(-30, -16), life: 0.9, max: 0.9, kind: 'dot', color: '#ffb347', g: 6 })
    }
  }

  for (const p of party.particles) {
    p.life -= dt
    p.vy += p.g * dt
    p.x += p.vx * dt
    p.y += p.vy * dt
    if (p.kind === 'drop' || p.kind === 'dust' || p.kind === 'dot') {
      const s = surfaceAt(party.pond, p.x)
      if (p.vy > 0 && (p.y > (s ?? groundAt(party.env, p.x)))) p.life = 0
    }
  }
  party.particles = party.particles.filter(p => p.life > 0)
}

function stepFigure(party: Party, f: Figure, dt: number) {
  f.t += dt
  f.modeT += dt
  f.red = Math.max(0, f.red - dt)
  f.halo = Math.max(0, f.halo - dt)
  f.immune = Math.max(0, f.immune - dt)
  f.squash = f.squash > 0 ? Math.max(0, f.squash - dt * 5) : Math.min(0, f.squash + dt * 3.5)
  f.flip = Math.max(0, f.flip - dt)
  f.nod += dt
  if (f.devil > 0) {
    f.devil -= dt
    if (Math.random() < dt * 1.5 && !f.hidden) emit(party, 'smoke', f.head.x, f.head.y, 1, '90,40,50')
    if (f.devil <= 0) {
      // The horns go in a puff, and they wonder what came over them
      f.devil = 0
      f.prank = null
      emit(party, 'smoke', f.head.x, f.head.y, 6, '90,40,50')
      say(f, 'quest', 1.6)
      if (f.mode === 'free') f.react = { kind: 'shake', t: 0.9, x: f.x }
    }
  }
  if (f.mode !== 'held') f.hurt = Math.max(0, f.hurt - dt * 0.1)
  if (f.bubble) {
    f.bubble.age += dt
    if (f.bubble.age > f.bubble.life) f.bubble = null
  }
  f.blink -= dt
  if (f.blink < -0.12) f.blink = rand(2, 5.5)
  if (f.wet > 0) {
    f.wet -= dt
    if (Math.random() < dt * 3) party.particles.push({ x: f.x + rand(-3, 3), y: f.skel.y - rand(0, 14), vx: 0, vy: 10, life: 0.7, max: 0.7, kind: 'drop', color: '', g: 200 })
  }

  if (f.mode !== 'free' && f.mode !== 'getup') f.hopT = 0
  switch (f.mode) {
    case 'held':
    case 'ragdoll':
    case 'down':
    case 'dead':
      stepRagdollFigure(party, f, dt)
      return
    case 'swim':
      stepSwim(party, f, dt)
      return
    case 'rising':
      f.skel = targetSkel(party, f)
      return
  }

  if (f.mode === 'getup') {
    const t = f.modeT
    hold(f, t < 0.5 ? 'sit' : 'stand', 'none')
    if (t > 1.1) {
      f.mode = 'free'
      if (f.dizzy > 0.4) say(f, 'star', 1.2)
      f.react = { kind: 'shake', t: 0.7, x: f.x }
      const fire = party.fire
      if (fire.a > 0.5 && Math.abs(f.x - fire.x) < 12) burnt(party, f)
    }
  } else {
    think(party, f, dt)
  }
  move(party, f, dt)
  settleView(f)
  if (dt > 0) {
    f.acc += ((f.vx - f.lastVx) / dt - f.acc) * (1 - Math.exp(-8 * dt))
    f.lastVx = f.vx
  }

  // Jumps: crouch, stretch on take-off, squash on landing
  if (f.hopT > 0) {
    f.hopT -= dt
    f.squash = Math.max(f.squash, 0.45)
    if (f.hopT <= 0) {
      f.jumpV = -f.hopV
      f.squash = -0.5
    }
  }
  if (f.jump < 0 || f.jumpV !== 0) {
    f.jumpV += GRAVITY * dt
    f.jump += f.jumpV * dt
    if (f.jump >= 0) {
      if (f.jumpV > 60) f.squash = Math.min(1, f.jumpV / 160)
      f.jump = 0
      f.jumpV = 0
    }
  }
  f.dizzy = Math.max(0, f.dizzy - dt * 0.35)

  // Now and then they look out at you while idling
  f.faceT -= dt
  if (f.faceT <= 0) {
    f.faceT = rand(1.5, 5)
    f.faceCam = !f.faceCam && Math.random() < 0.55
  }
  // ...or glance about
  f.glanceT -= dt
  if (f.glanceT <= 0) {
    f.glanceT = rand(1.2, 4.5)
    f.glance = Math.random() < 0.45 ? 0 : rand(-0.22, 0.14)
  }

  stepPose(party, f, dt)
}

const zeroPose = (): Pose => ({ hx: 0, hy: 0, body: 0, head: 0, armN: 0, armF: 0, legN: 0, legF: 0 })
const FAST_GESTURES: Gesture[] = ['wave', 'cheer', 'shake', 'flail', 'eat', 'dance']
/** How quickly each part follows: the head a touch behind the body, the legs ahead so feet stay put */
const JOINT_PACE: Record<keyof Pose, number> = { hx: 1.2, hy: 1.2, body: 1, head: 0.72, armN: 0.86, armF: 0.82, legN: 1.15, legF: 1.15 }

/**
 * Moves the body towards its wanted pose on springs, so it eases in, overshoots a hair
 * and settles, with the head and arms trailing the body a little.
 */
function stepPose(party: Party, f: Figure, dt: number) {
  const want = targetPose(party, f)
  const ground = feetY(party, f.x)
  if (!f.pose || f.poseOut !== f.skel) {
    // Something else posed them (a ragdoll, a snap into place): carry on from there
    f.feet = ground
    f.pose = {
      hx: (f.skel.x - f.x) * f.dir, hy: f.skel.y - ground - f.jump,
      body: f.skel.body, head: f.skel.head, armN: f.skel.armN, armF: f.skel.armF, legN: f.skel.legN, legF: f.skel.legF,
    }
    f.poseV = zeroPose()
  }
  const cur = f.pose, vel = f.poseV
  f.feet += (ground - f.feet) * (1 - Math.exp(-30 * dt))

  const moving = Math.abs(f.vx) > 2
  // Sitting down, lying back and getting up take a moment rather than snapping
  const stance = moving ? 'stand' : f.want.stance
  if (stance !== f.stance) {
    f.stance = stance
    f.stanceT = 0
  }
  f.stanceT += dt
  const [pace, damp] =
    f.mode === 'getup' ? [8, 1]
    : f.stanceT < 0.45 ? [11, 0.85]
    : FAST_GESTURES.includes(f.want.gesture) && !moving ? [30, 0.75]
    : moving ? [24, 0.8]
    : [15, 0.62]
  const n = Math.min(12, Math.ceil(dt * 120))
  const h = dt / Math.max(1, n)
  for (let i = 0; i < n; i++) {
    for (const k of POSE_KEYS) {
      const w = pace * JOINT_PACE[k]
      const err = k === 'hx' || k === 'hy' ? want[k] - cur[k] : wrapAngle(want[k] - cur[k])
      vel[k] += (w * w * err - 2 * damp * w * vel[k]) * h
      cur[k] += vel[k] * h
    }
  }
  f.skel = f.poseOut = poseSkel(f, cur, f.feet)
}

const wrapAngle = (a: number) => a - Math.round(a / (Math.PI * 2)) * Math.PI * 2

function poseSkel(f: Figure, P: Pose, feet: number): Skel {
  // Rising from the grave, ghostly
  const rise = f.mode === 'rising' ? f.rise * 34 : 0
  return {
    x: f.x + P.hx * f.dir, y: feet + P.hy + f.jump + rise,
    body: P.body, head: P.head, armN: P.armN, armF: P.armF, legN: P.legN, legF: P.legF,
  }
}

function move(party: Party, f: Figure, dt: number) {
  let want = 0
  if (f.dest !== null) {
    const d = f.dest - f.x
    if (Math.abs(d) < 0.6 && Math.abs(f.vx) < 4) {
      f.x = f.dest
      f.dest = null
      f.vx = 0
    } else {
      const max = f.fast ? (f.devil > 0 ? RUN * 1.3 : RUN) : WALK
      want = Math.sign(d) * Math.min(max, Math.sqrt(2 * ACCEL * Math.abs(d)) * 0.9)
    }
  }
  f.vx += clamp(want - f.vx, -ACCEL * dt, ACCEL * dt)
  f.x += f.vx * dt
  f.phase += Math.abs(f.vx) * dt * 0.45
  if (f.leaving) return
  if (f.x < party.lo - 2 && f.vx < 0 && f.dest !== null && f.dest < party.lo) f.dest = party.lo
  if (f.x > party.hi + 2 && f.vx > 0 && f.dest !== null && f.dest > party.hi) f.dest = party.hi
}

/** Applies the wanted facing, animating the turn */
function settleView(f: Figure) {
  const moving = Math.abs(f.vx) > 2
  const dir: 1 | -1 = moving ? (f.vx > 0 ? 1 : -1) : f.want.dir || f.dir
  const front = !moving && f.want.front
  if (dir !== f.dir || front !== f.front) {
    if (f.flip <= 0) f.from = { dir: f.dir, front: f.front }
    f.flip = FLIP
    f.dir = dir
    f.front = front
  }
}

// ── Brains ───────────────────────────────────────────────────

function think(party: Party, f: Figure, dt: number) {
  f.subT += dt
  f.want = { stance: 'stand', gesture: 'none', dir: 0, front: false }

  if (f.leaving) {
    goTo(f, f.x < (party.lo + party.hi) / 2 ? party.lo - EDGE : party.hi + EDGE)
    return
  }
  if (f.react) {
    reactThink(party, f, dt)
    return
  }
  if (f.devil > 0 && !f.pair) {
    prankThink(party, f, dt)
    return
  }
  if (f.pair) {
    pairThink(party, f, f.pair, dt)
    return
  }
  // Someone arriving from far away jogs over
  const spot = f.spot
  if (spot && Math.abs(spot.x - f.x) > 1) {
    goTo(f, spot.x, Math.abs(spot.x - f.x) > 60)
    if (f.item?.kind === 'rod') f.item = null
    return
  }

  const activity = activityOf(f)
  if (!spot && activity !== 'chase' && activity !== 'tag' && activity !== 'flowers' && activity !== 'wander') {
    // No place for them yet (just back, say): find them one, and stroll about meanwhile
    if (f.group) assign(party, f.group)
    wanderThink(party, f, dt)
    return
  }
  switch (activity) {
    case 'campfire': campfireThink(party, f, spot!, dt); break
    case 'fishing': fishingThink(party, f, spot!, dt); break
    case 'sunset': sunsetThink(party, f, spot!); break
    case 'stargaze': stargazeThink(party, f, spot!); break
    case 'picnic': picnicThink(party, f, spot!, dt); break
    case 'dance': danceThink(party, f, spot!); break
    case 'chase': chaseThink(party, f, dt); break
    case 'tag': tagThink(party, f); break
    case 'flowers': flowersThink(party, f); break
    default: wanderThink(party, f, dt)
  }
}

// ── Chases ───────────────────────────────────────────────────

/** Who can be chased: anyone out and about who isn't doing the chasing */
const chaseable = (o: Figure | null): o is Figure => !!o && o.mode === 'free' && !o.hidden && !o.leaving && o.devil <= 0

/** One of the nearest, and not the one just caught if there's anyone else */
function pickVictim(party: Party, x: number, last: Figure | null): Figure | null {
  const near = party.figures.filter(chaseable).sort((a, b) => Math.abs(a.x - x) - Math.abs(b.x - x))
  const options = near.filter(o => o !== last).slice(0, 2)
  return options.length ? pick(options) : near[0] ?? null
}

/** Where a chaser is, or null once they've stopped chasing */
function chaserX(party: Party, by: Chaser): number | null {
  if ('fig' in by) {
    const c = by.fig
    return c.devil > 0 && c.mode === 'free' && !c.hidden && !c.leaving ? c.x : null
  }
  const im = by.imp
  return im.state === 'chase' && party.graves.some(g => g.imp === im) ? im.x : null
}

/** Stops whatever they were in the middle of (fishing, roasting, a hug, carrying the chicken) */
function interrupt(party: Party, f: Figure) {
  stopFishing(party, f)
  if (f.item && f.item.kind !== 'flower') f.item = null
  if (f.pair) unpair(f.pair)
  if (party.chicken?.held === f) { party.chicken.held = null; party.chicken.free = true; party.chicken.x = f.x }
  f.sub = ''
  f.subT = 0
  f.subDur = 0
}

/** Reels in: the line goes, and the fish that was coming for the float swims off */
function stopFishing(party: Party, f: Figure) {
  const bob = f.fishing?.bob
  if (bob) for (const fish of party.pond.fish) if (fish.target !== null && Math.abs(fish.target - bob.x) < 8) fish.target = null
  f.fishing = null
  if (f.item?.kind === 'rod') f.item = null
}

/** Run for it! */
function scare(party: Party, f: Figure, by: Chaser, t = 1.2) {
  if (!chaseable(f)) return
  if (f.react?.kind === 'flee') {
    f.react.t = Math.max(f.react.t, t)
    f.react.by = by
    return
  }
  interrupt(party, f)
  f.react = { kind: 'flee', t, x: f.x, by }
  say(f, 'excl', 1.1)
  hop(f, 90, 0.06)
}

/** Anyone the chaser gets near starts running too */
function panic(party: Party, x: number, by: Chaser, radius: number) {
  for (const o of party.figures) if (Math.abs(o.x - x) < radius && (o.react?.kind !== 'flee' || o.react.t < 0.6)) scare(party, o, by, 0.9)
}

/** Caught: a jab, a yelp and a jump, then off they run again */
function caught(party: Party, v: Figure, fromX: number, by: Chaser) {
  hop(v, 135, 0)
  v.red = 0.3
  v.dest = null
  v.vx = (v.x >= fromX ? 1 : -1) * 34
  emit(party, 'spark', v.x, v.skel.y - 8, 5, '#ff6a3a')
  scare(party, v, by, 1.8)
  say(v, pick(['excl', 'tear']), 1.2)
}

/** Back from the imp with horns: chasing everyone about, poking whoever they catch */
function prankThink(party: Party, f: Figure, dt: number) {
  const by: Chaser = { fig: f }
  f.prankCool -= dt
  panic(party, f.x, by, 45)
  if (f.prankCool > 0) {
    // A cackle between catches
    hold(f, 'stand', 'cheer', 0, true)
    if (Math.random() < dt * 1.5) hop(f, 80)
    return
  }
  if (!chaseable(f.prank)) f.prank = pickVictim(party, f.x, f.prankLast)
  const t = f.prank
  if (!t) { wanderThink(party, f, dt); return }
  if (Math.abs(t.x - f.x) > 6) {
    goTo(f, t.x, true)
    // A leap now and then as they close in
    if (Math.abs(t.x - f.x) < 30 && Math.random() < dt * 0.8) hop(f, 100)
    return
  }
  f.dest = null
  hold(f, 'stand', 'point', t.x > f.x ? 1 : -1)
  caught(party, t, f.x, by)
  say(f, 'horns', 1.3)
  f.prankLast = t
  f.prank = null
  f.prankCool = rand(0.8, 1.5)
}

function reactThink(party: Party, f: Figure, dt: number) {
  const r = f.react!
  r.t -= dt
  switch (r.kind) {
    case 'look':
      hold(f, f.spot && Math.abs(f.spot.x - f.x) < 1 ? f.spot.stance === 'lie' ? 'sit' : f.spot.stance : 'stand', r.up ? 'lookup' : 'none', r.x > f.x ? 1 : -1)
      break
    case 'flee': {
      const cx = r.by ? chaserX(party, r.by) : null
      if (cx === null) {
        // They've stopped: catch your breath
        f.react = { kind: 'look', t: 0.8, x: r.x }
        say(f, 'dots', 1.2)
        return
      }
      r.x = cx
      const near = Math.abs(f.x - cx)
      if (near < 60) r.t = Math.max(r.t, 0.4)
      const away = f.x >= cx ? 1 : -1
      let to = f.x + away * 50
      if (to < party.lo + 6 || to > party.hi - 6) {
        // Cornered: dodge back past them, with a jump
        to = cx - away * 50
        if (near < 12) hop(f, 115)
      }
      goTo(f, clamp(to, party.lo + 4, party.hi - 4), true)
      hold(f, 'stand', 'flail')
      break
    }
    case 'wave':
      hold(f, 'stand', 'wave', 0, true)
      break
    case 'mourn':
      if (!party.graves.some(g => g.f === r.of)) {
        f.react = null
        return
      }
      if (Math.abs(r.x - f.x) > 1) goTo(f, r.x)
      else hold(f, 'stand', 'mourn', 0)
      r.t = 1 // lasts until the grave says otherwise
      break
    case 'cheer':
      hold(f, 'stand', 'cheer', 0, true)
      if (Math.random() < dt * 2.2) hop(f, 95)
      break
    case 'hot':
      goTo(f, r.x, true)
      hold(f, 'stand', 'flail')
      if (Math.random() < dt * 10) emit(party, 'smoke', f.x, feetY(party, f.x) - 2)
      break
    case 'shake':
      hold(f, 'stand', 'shake', 0, true)
      break
  }
  if (r.t <= 0) f.react = null
}

function burnt(party: Party, f: Figure) {
  hop(f, 150)
  say(f, 'excl', 1.4)
  f.react = { kind: 'hot', t: 1.5, x: clamp(f.x + (f.x < party.fire.x ? -40 : 40), party.lo, party.hi) }
}

function campfireThink(party: Party, f: Figure, spot: Spot, dt: number) {
  const fireLit = party.fire.a > 0.6
  if (f.subT >= f.subDur) {
    const options = ['idle', 'roast', 'roast', 'chat', 'warm']
    if (party.light.time === 'night') options.push('sleep')
    const sub = pick(options)
    setSub(f, sub, sub === 'roast' ? rand(9, 13) : rand(3.5, 7))
    if (sub === 'roast') f.item = { kind: 'stick', toast: 0 }
    else if (f.item?.kind === 'stick') f.item = null
    if (sub === 'chat') say(f, pick(['note', 'dots', 'heart']))
  }
  let gesture: Gesture = 'none', dir = spot.dir
  switch (f.sub) {
    case 'roast': {
      const it = f.item
      if (it?.kind !== 'stick') {
        // Their stick went (eaten, or dropped when they were picked up): something else for now
        setSub(f, 'warm', rand(2, 4))
        break
      }
      const eating = f.subT > f.subDur - 2
      if (!eating) {
        gesture = 'roast'
        if (fireLit) it.toast = (it.toast ?? 0) + dt * 0.13
        // Leave it in too long and it catches fire: wave it about until it goes out
        if ((it.toast ?? 0) > 0.95 && it.burning === undefined && Math.random() < dt * 0.25) {
          it.burning = 1.2
          say(f, 'excl', 1.2)
        }
        if (it.burning) {
          gesture = 'flail'
          it.burning -= dt
          if (it.burning <= 0) {
            it.burning = 0
            it.toast = 1.4
            emit(party, 'smoke', f.skel.x + f.dir * 12, f.skel.y - 16, 3)
          }
        }
      } else {
        gesture = 'eat'
        if (Math.random() < dt * 3) emit(party, 'dot', f.head.x + f.dir * 3, f.head.y + 6, 1, '#f4ecd8')
        if (f.subT > f.subDur - 0.1) {
          say(f, (it.toast ?? 0) > 1.2 ? 'quest' : 'heart')
          f.item = null
          setSub(f, 'idle', rand(2, 4))
        }
      }
      break
    }
    case 'warm': gesture = 'warm'; break
    case 'sleep':
      gesture = 'sleep'
      if (Math.random() < dt * 0.8) emit(party, 'z', f.head.x + 3, f.head.y)
      break
    case 'chat': {
      const o = nearest(party, f)
      if (o) dir = o.x > f.x ? 1 : -1
      break
    }
  }
  hold(f, 'sit', gesture, dir)
}

function fishingThink(party: Party, f: Figure, spot: Spot, dt: number) {
  const pond = party.pond
  if (!spot.fisher) {
    // Watching from the bank, cheering when someone lands one
    if (f.subT >= f.subDur) setSub(f, pick(['watch', 'watch', 'look']), rand(3, 7))
    hold(f, 'sit', 'none', spot.dir)
    return
  }
  f.item ??= { kind: 'rod' }
  const fs = f.fishing ??= {
    phase: 'ready', t: 0, arm: 0.9, target: 0, bob: null, tip: null, wait: 0, nibble: 0, dip: 0, catch: 'fish',
  }
  fs.t += dt
  let gesture: Gesture = 'fish', front = false
  const n = pond.x1 - pond.x0
  switch (fs.phase) {
    case 'ready':
      fs.arm = 0.9
      if (fs.t > 0.8) { fs.phase = 'windup'; fs.t = 0 }
      break
    case 'windup':
      fs.arm = 3.3
      if (fs.t > 0.45) { fs.phase = 'cast'; fs.t = 0 }
      break
    case 'cast':
      fs.arm = 1.0
      if (fs.t > 0.16) {
        const tip = fs.tip ?? { x: f.x + f.dir * 14, y: f.skel.y - 22 }
        fs.target = spot.dir === 1 ? pond.x0 + rand(8, n / 2 - 4) : pond.x1 - rand(8, n / 2 - 4)
        const T = 0.6
        const ty = surfaceAt(pond, fs.target) ?? pond.level
        fs.bob = { x: tip.x, y: tip.y, vx: (fs.target - tip.x) / T, vy: (ty - tip.y - 0.5 * 300 * T * T) / T }
        fs.phase = 'fly'
        fs.t = 0
      }
      break
    case 'fly': {
      fs.arm = 0.95
      const b = fs.bob!
      b.vy += 300 * dt
      b.x += b.vx * dt
      b.y += b.vy * dt
      const s = surfaceAt(pond, b.x)
      if (s !== null && b.y >= s && b.vy > 0) {
        b.y = s
        splash(pond, b.x, 1.3)
        emit(party, 'drop', b.x, s, 3)
        fs.phase = 'wait'
        fs.t = 0
        fs.wait = lure(pond, b.x) + rand(1, 4)
        fs.nibble = rand(0.8, 2)
      } else if (fs.t > 1.5) {
        fs.phase = 'ready'
        fs.bob = null
      }
      break
    }
    case 'wait': {
      fs.arm = 0.9 + Math.sin(f.t * 1.3) * 0.04
      const b = fs.bob!
      b.y = surfaceAt(pond, b.x) ?? b.y
      fs.dip = Math.max(0, fs.dip - dt * 8)
      fs.nibble -= dt
      if (fs.nibble <= 0 && fs.t < fs.wait) {
        fs.nibble = rand(0.7, 2.2)
        fs.dip = 1.2
        splash(pond, b.x, 0.35)
      }
      if (fs.t >= fs.wait) {
        fs.phase = 'bite'
        fs.t = 0
        fs.dip = 3
        splash(pond, b.x, 1.8)
        emit(party, 'drop', b.x, b.y, 4)
        say(f, 'excl', 1)
      }
      break
    }
    case 'bite':
      fs.arm = 1.0
      fs.bob!.y = surfaceAt(pond, fs.bob!.x) ?? fs.bob!.y
      if (fs.t > 0.35) {
        fs.phase = 'reel'
        fs.t = 0
        const roll = Math.random()
        fs.catch = roll < 0.72 ? 'fish' : roll < 0.9 ? 'boot' : 'book'
        catchFish(pond, fs.bob!.x)
        const b = fs.bob!
        splash(pond, b.x, 2.4)
        emit(party, 'drop', b.x, b.y, 6)
        const to = { x: f.x + f.dir * 3, y: f.skel.y - 22 }
        const T = 0.7
        party.flyers.push({ x: b.x, y: b.y, vx: (to.x - b.x) / T, vy: (to.y - b.y - 0.5 * 300 * T * T) / T, t: 0, kind: fs.catch, to: f })
        fs.bob = null
      }
      break
    case 'reel':
      fs.arm = 2.4
      if (fs.t > 1.2) { fs.phase = 'show'; fs.t = 0 }
      break
    case 'show':
      gesture = 'holdup'
      front = true
      if (fs.t > 2.2) {
        fs.phase = 'stash'
        fs.t = 0
      }
      break
    case 'stash':
      gesture = 'none'
      if (fs.t > 0.1 && f.item && f.item.kind !== 'rod') {
        if (f.item.kind === 'fish') f.bucket++
        f.item = null
      }
      if (fs.t > 0.8) {
        fs.phase = 'ready'
        fs.t = 0
        f.item = { kind: 'rod' }
      }
      break
  }
  hold(f, 'stand', gesture, spot.dir, front)
}

function sunsetThink(party: Party, f: Figure, spot: Spot) {
  if (f.subT >= f.subDur) {
    const sub = pick(['watch', 'watch', 'watch', 'point', 'love', 'look'])
    setSub(f, sub, sub === 'point' ? 2 : rand(3, 7))
    if (sub === 'point') say(f, 'sun')
    if (sub === 'love') {
      say(f, 'heart')
      emit(party, 'heart', f.head.x, f.head.y - 4, 2)
    }
  }
  const gesture: Gesture = f.sub === 'point' ? 'point' : f.sub === 'look' ? 'none' : 'lookup'
  hold(f, 'sit', gesture, spot.dir)
  if (f.sub === 'look') f.faceCam = true
}

function stargazeThink(party: Party, f: Figure, spot: Spot) {
  const night = party.light.time === 'night'
  if (f.subT >= f.subDur) {
    const sub = pick(['rest', 'rest', 'point', 'wish'])
    setSub(f, sub, sub === 'point' ? 2.2 : rand(4, 8))
    if (sub === 'wish') {
      say(f, night ? 'star' : 'heart')
      emit(party, 'spark', f.head.x, f.head.y - 4, 3)
    }
  }
  hold(f, 'lie', f.sub === 'point' ? 'pointUp' : 'none', spot.dir)
  f.faceCam = false
}

function picnicThink(party: Party, f: Figure, spot: Spot, dt: number) {
  const pk = party.picnic
  if (!pk || pk.a < 1) {
    hold(f, 'stand', 'none', spot.dir)
    return
  }
  if (f.subT >= f.subDur) {
    const sub = f.item ? 'eat' : pick(['eat', 'eat', 'share', 'idle', 'chat'])
    setSub(f, sub, sub === 'eat' ? rand(3.5, 5) : sub === 'share' ? 2 : rand(2.5, 5))
    if (sub === 'eat' || sub === 'share') {
      const kind = f.item && FOODS.includes(f.item.kind) ? f.item.kind : pick(FOODS)
      f.item = { kind }
      if (kind === 'cake') pk.cake = Math.min(6, pk.cake + 1)
    }
    if (sub === 'chat') say(f, pick(['note', 'heart', 'dots']))
  }
  let gesture: Gesture = 'none', dir = spot.dir
  if (f.sub === 'eat' && f.item) {
    gesture = 'eat'
    if (Math.random() < dt * 3) emit(party, 'dot', f.head.x + f.dir * 3, f.head.y + 6, 1, f.item.kind === 'melon' ? '#e0303a' : '#c79a5a')
    if (f.subT > f.subDur - 0.1) {
      f.item = null
      if (Math.random() < 0.5) say(f, 'heart')
    }
  } else if (f.sub === 'share' && f.item) {
    const o = nearest(party, f, o => o.mode === 'free' && !o.item && o.spot?.stance === 'sit')
    if (o && Math.abs(o.x - f.x) < 40) {
      dir = o.x > f.x ? 1 : -1
      gesture = 'give'
      if (f.subT > 1.2) {
        o.item = f.item
        f.item = null
        setSub(o, 'eat', rand(3, 4.5))
        say(o, 'heart')
      }
    } else {
      setSub(f, 'eat', 3)
    }
  }
  hold(f, 'sit', gesture, dir)
}

function danceThink(party: Party, f: Figure, spot: Spot) {
  const jb = party.jukebox
  if (!jb || jb.a < 1) {
    hold(f, 'stand', 'none', spot.dir)
    return
  }
  const beats = party.beat * BPM / 60
  const bar = Math.floor(beats / 8)
  if (f.subDur !== bar) {
    f.subDur = bar
    f.danceMove = pick(['bounce', 'arms', 'sway', 'spin', 'crouch', 'jump'])
    if (Math.random() < 0.3) say(f, 'note')
  }
  const beat = Math.floor(beats)
  let stance: Stance = 'stand', dir: 1 | -1 = spot.dir, front = false
  switch (f.danceMove) {
    case 'arms':
    case 'sway':
      front = true
      break
    case 'spin':
      dir = beat % 2 === 0 ? spot.dir : spot.dir === 1 ? -1 : 1
      break
    case 'crouch':
      stance = (beats * 2) % 2 < 1 ? 'crouch' : 'stand'
      break
    case 'jump':
      if (beat % 2 === 0 && beats % 1 < 0.2) hop(f, 100, 0)
      break
  }
  hold(f, stance, 'dance', dir, front)
}

function chaseThink(party: Party, f: Figure, dt: number) {
  const ch = party.chicken
  if (!ch || ch.free) {
    wanderThink(party, f, dt)
    return
  }
  if (ch.held === f) {
    // Caught it! Hold it up for everyone to see
    hold(f, 'stand', 'holdup', 0, true)
    if (f.subT > 2.6) {
      ch.held = null
      ch.free = true
      ch.x = f.x
      f.item = null
      if (f.group) f.group.timer = Math.min(f.group.timer, 5)
    }
    return
  }
  if (ch.held) {
    hold(f, 'stand', 'cheer', ch.held.x > f.x ? 1 : -1, true)
    return
  }
  // The closest one goes right for it, the rest string out behind
  const chasers = free(party).filter(o => o.group === f.group).sort((a, b) => Math.abs(a.x - ch.x) - Math.abs(b.x - ch.x))
  const rank = chasers.indexOf(f)
  const behind = ch.x - ch.dir * (rank === 0 ? 1 : 6 + rank * 8)
  if (Math.abs(behind - f.x) > 2) goTo(f, behind, true)
  else hold(f, 'stand', 'none', ch.x >= f.x ? 1 : -1)
  if (Math.abs(f.vx) > RUN * 0.8 && Math.random() < dt * 0.35) hop(f, 110)
}

function tagThink(party: Party, f: Figure) {
  const g = f.group!
  const it = g.it
  const lo = Math.max(party.lo, g.x - g.span), hi = Math.min(party.hi, g.x + g.span)
  if (!it || it.leaving || it.mode !== 'free' || it.group !== g) {
    const players = free(party).filter(o => o.group === g)
    g.it = players.length ? pick(players) : null
    return
  }
  if (it === f) {
    if (f.subT < 1) {
      // Counting to three before giving chase
      hold(f, 'stand', 'none')
      return
    }
    const prey = nearest(party, f, o => o.mode === 'free' && o.immune <= 0 && o.group === g)
    if (!prey) { hold(f, 'stand', 'cheer', 0, true); return }
    goTo(f, prey.x, true)
    if (Math.abs(prey.x - f.x) < 6) {
      g.it = prey
      setSub(prey, 'tagged', 0)
      say(prey, 'excl', 1.2)
      say(f, 'star', 1.2)
      f.immune = 2
      setSub(f, 'run', 0)
      goTo(f, clamp(f.x + (f.x > prey.x ? 40 : -40), lo, hi), true)
    }
    return
  }
  const d = f.x - it.x
  if (Math.abs(d) < 60 && it.subT >= 1) {
    let to = f.x + Math.sign(d || 1) * 50
    // Cornered: dodge round them instead
    if (to < lo || to > hi) to = it.x - Math.sign(d || 1) * 30
    goTo(f, clamp(to, lo, hi), true)
  } else if (arrived(f)) {
    if (Math.random() < 0.01) hop(f, 100)
    hold(f, 'stand', Math.random() < 0.3 ? 'wave' : 'none', it.x > f.x ? 1 : -1, false)
  }
}

function flowersThink(party: Party, f: Figure) {
  if (!f.sub) setSub(f, 'find', 0)
  switch (f.sub) {
    case 'find': {
      const g = f.group
      let x = g ? clamp(g.x + rand(-g.span, g.span), party.lo + 10, party.hi - 10) : rand(party.lo + 10, party.hi - 10)
      if (inPond(party.pond, x) || Math.abs(x - party.pond.x0) < 6 || Math.abs(x - party.pond.x1) < 6) x = party.pond.x0 - 12
      goTo(f, x)
      setSub(f, 'walk', 0)
      break
    }
    case 'walk':
      if (arrived(f)) setSub(f, 'pick', 1.3)
      break
    case 'pick':
      hold(f, 'crouch', 'none')
      if (f.subT >= f.subDur) {
        f.item = { kind: 'flower', color: pick(FLOWER_COLORS) }
        say(f, 'star', 1)
        setSub(f, 'give', 12)
      }
      break
    case 'give': {
      const o = nearest(party, f, o => o.mode === 'free' && o.group === f.group && o.item?.kind !== 'flower')
        ?? nearest(party, f, o => o.mode === 'free' && o.item?.kind !== 'flower' && Math.abs(o.x - f.x) < 80)
        ?? nearest(party, f, o => o.mode === 'free' && o.group === f.group)
      if (!o || f.subT > f.subDur) { setSub(f, 'find', 0); break }
      const side = o.x > f.x ? 1 : -1
      if (Math.abs(o.x - f.x) > 10) goTo(f, o.x - side * 9)
      else {
        hold(f, 'stand', 'give', side)
        if (f.subT > 0.8 && f.item) {
          // A bit of a moment
          o.item = f.item
          f.item = null
          say(o, 'heart')
          say(f, 'heart')
          emit(party, 'heart', (o.x + f.x) / 2, f.head.y - 2, 2)
          o.react = { kind: 'cheer', t: 1.2, x: o.x }
          setSub(f, 'find', 0)
        }
      }
      if (f.item === null && f.sub === 'give') setSub(f, 'find', 0)
      break
    }
  }
}

function wanderThink(party: Party, f: Figure, dt: number) {
  if (!f.sub || (f.sub === 'idle' && f.subT >= f.subDur)) {
    const g = f.group?.activity === 'wander' ? f.group : null
    let x = g ? clamp(g.x + rand(-g.span, g.span), party.lo + 10, party.hi - 10) : rand(party.lo + 10, party.hi - 10)
    if (inPond(party.pond, x)) x = party.pond.x0 - 14
    goTo(f, x)
    setSub(f, 'stroll', 0)
  }
  if (f.sub === 'stroll') {
    if (arrived(f)) setSub(f, 'idle', Math.random() < 0.3 ? rand(6, 12) : rand(2.5, 6))
    return
  }
  // Idling: sometimes sat down for a while, sometimes greeting whoever's about
  const sitting = f.subDur > 6
  hold(f, sitting ? 'sit' : 'stand', 'none')
  if (sitting) return
  if (party.light.time === 'dawn' && f.subT < 1.4) hold(f, 'stand', 'stretch', 0, true)
  if (f.subT > 1 && Math.random() < dt * 0.15) {
    const o = nearest(party, f, o => o.mode === 'free' && !o.pair && !o.react && o.sub === 'idle' && Math.abs(o.x - f.x) < 70)
    if (o) startPair(party, f, o)
  }
  if (Math.random() < dt * 0.05) hop(f, 90)
}

/** Ends a hug or high-five for both of them */
function unpair(p: Pair) {
  p.a.pair = null
  p.b.pair = null
}

function startPair(party: Party, a: Figure, b: Figure) {
  const kind = pick<Pair['kind']>(['hug', 'highfive', 'crouch', 'wave'])
  const [l, r] = a.x < b.x ? [a, b] : [b, a]
  const gap = { hug: 5, highfive: 8, crouch: 9, wave: 12 }[kind]
  const mid = clamp((l.x + r.x) / 2, party.lo + gap, party.hi - gap)
  const pair: Pair = { kind, a: l, b: r, t: 0, met: false }
  l.pair = r.pair = pair
  goTo(l, mid - gap)
  goTo(r, mid + gap)
  setSub(l, 'pair', 0)
  setSub(r, 'pair', 0)
}

function pairThink(party: Party, f: Figure, p: Pair, dt: number) {
  const other = f === p.a ? p.b : p.a
  if (other.pair !== p || other.mode !== 'free' || other.leaving) {
    f.pair = null
    return
  }
  const face: 1 | -1 = other.x > f.x ? 1 : -1
  if (!p.met) {
    if (arrived(f) && arrived(other)) {
      p.met = true
      p.t = 0
      say(p.a, p.kind === 'hug' ? 'heart' : p.kind === 'crouch' ? 'note' : 'excl', 1.4)
    }
    hold(f, 'stand', 'none', face)
    return
  }
  if (f === p.a) p.t += dt
  const t = p.t
  switch (p.kind) {
    case 'hug':
      hold(f, 'stand', 'hug', face)
      if (f === p.a && Math.random() < dt * 2) emit(party, 'heart', (p.a.x + p.b.x) / 2, f.head.y - 2)
      break
    case 'highfive':
      hold(f, 'stand', t > 0.25 && t < 1 ? 'highfive' : 'none', face)
      if (t >= 0.3 && t - dt < 0.3) hop(f, 120)
      if (f === p.a && t > 0.5 && t - dt <= 0.5) emit(party, 'spark', (p.a.x + p.b.x) / 2, f.skel.y - 26, 7)
      break
    case 'crouch':
      hold(f, Math.floor(t * 6) % 2 === 0 ? 'crouch' : 'stand', 'none', face)
      break
    case 'wave':
      hold(f, 'stand', 'wave', face, true)
      break
  }
  if (t > 2.4) {
    p.a.pair = p.b.pair = null
    setSub(p.a, 'idle', rand(1.5, 3))
    setSub(p.b, 'idle', rand(1.5, 3))
  }
}

// ── The chicken ──────────────────────────────────────────────

function stepChicken(party: Party, dt: number) {
  const ch = party.chicken
  if (ch?.held) {
    const h = ch.held
    if (h.mode !== 'free' || h.hidden || h.leaving || !party.figures.includes(h) || activityOf(h) !== 'chase') {
      ch.held = null
      ch.free = true
      ch.x = h.x
      if (h.item?.kind === 'chicken') h.item = null
    }
  }
  if (!ch || ch.held) return
  ch.t += dt
  ch.flap = Math.max(0, ch.flap - dt)
  if (ch.free) {
    // Let go: it runs off the edge of the world
    ch.x += ch.dir * 34 * dt
    if (ch.x < party.lo - EDGE || ch.x > party.hi + EDGE) party.chicken = null
    return
  }
  let near: Figure | null = null
  for (const f of free(party)) if (!near || Math.abs(f.x - ch.x) < Math.abs(near.x - ch.x)) near = f
  const gap = near ? Math.abs(near.x - ch.x) : Infinity
  if (ch.rest > 0) {
    ch.rest -= dt
    if (gap < 16) ch.rest = 0
  } else {
    ch.x += ch.dir * 30 * (ch.flap > 0 ? 1.5 : 1) * dt
    if (Math.random() < dt * 0.3) ch.rest = rand(0.5, 1.4)
  }
  if (near && gap < 6 && ch.flap <= 0) {
    if (ch.t > 6 && Math.random() < 0.3) {
      // Caught! Held up for everyone to see
      ch.held = near
      near.item = { kind: 'chicken' }
      near.dest = null
      setSub(near, 'show', 3)
      say(near, 'heart')
      emit(party, 'dot', ch.x, feetY(party, ch.x) - 6, 6, '#f4f1ea')
      return
    }
    // Nearly: it flaps up, loses a feather or two and bolts the other way
    ch.flap = 0.7
    ch.hopV = -120
    ch.dir = near.x > ch.x ? -1 : 1
    emit(party, 'dot', ch.x, feetY(party, ch.x) - 8, 3, '#f4f1ea')
  }
  if (ch.x < party.lo + 10) ch.dir = 1
  if (ch.x > party.hi - 10) ch.dir = -1
  if (inPond(party.pond, ch.x + ch.dir * 4)) ch.dir = ch.dir === 1 ? -1 : 1
  ch.hopV += GRAVITY * dt
  ch.hop = Math.min(0, ch.hop + ch.hopV * dt)
  if (ch.hop === 0) ch.hopV = 0
}

// ── Picking people up ────────────────────────────────────────

function hitFigure(party: Party, x: number, y: number): Figure | null {
  for (let i = party.figures.length - 1; i >= 0; i--) {
    const f = party.figures[i]
    if (f.leaving || f.hidden || f.mode === 'dead' || f.mode === 'rising') continue
    const b = f.box
    if (x >= b.x0 - 2 && x <= b.x1 + 2 && y >= b.y0 - 2 && y <= b.y1 + 2) return f
  }
  return null
}

const toWorld = (party: Party, p: ScenePointer, px: number, py: number) =>
  ({ x: p.x * 2 - (Math.round(px * 10) - party.env.PAD) * 2, y: p.y * 2 - Math.round((py + 1) * 2) * 2 })

/** Whether a player is under a point given in scene (quarter-resolution) pixels */
export function figureAt(party: Party, p: ScenePointer, px: number, py: number): boolean {
  const w = toWorld(party, p, px, py)
  return !!hitSpirit(party, w.x, w.y) || !!hitFigure(party, w.x, w.y)
}

/** The angel or an imp under a point, if either can be picked up just now */
function hitSpirit(party: Party, x: number, y: number): { g: Grave; who: 'angel' | 'imp' } | null {
  for (let i = party.graves.length - 1; i >= 0; i--) {
    const g = party.graves[i]
    const im = g.imp
    if (im && im.sink < 0.5 && ['cackle', 'poke', 'chase', 'home', 'held', 'dizzy', 'bye'].includes(im.state)) {
      if (x >= im.x - 6 && x <= im.x + 6 && y >= im.y - 16 && y <= im.y + 1) return { g, who: 'imp' }
    }
    const a = g.angel
    if ((a.state === 'fly' || a.state === 'back' || a.state === 'held') && g.alpha > 0.5 && ['angel', 'raise', 'depart'].includes(g.phase)) {
      if (x >= a.x - 11 && x <= a.x + 11 && y >= a.y - 28 && y <= a.y + 1) return { g, who: 'angel' }
    }
  }
  return null
}

function stepSpirit(party: Party, dt: number) {
  const sp = party.spirit
  if (!sp) return
  const c = party.cursor
  const g = sp.g, a = g.angel, im = g.imp
  const gone = !party.graves.includes(g) || (sp.who === 'imp' ? !im : a.state === 'off' || a.state === 'flung')
  if (!c || gone) {
    if (sp.grabbed) letGo(party, sp, 0, 0)
    party.spirit = null
    return
  }
  sp.t += dt
  sp.samples.push({ x: c.x, y: c.y, t: party.t })
  if (sp.samples.length > 12) sp.samples.shift()
  // The angel only lets herself be carried off before she's done
  const canGrab = sp.who === 'imp' ? im!.state !== 'bye' : g.phase === 'angel' || g.phase === 'raise'
  if (!sp.grabbed && canGrab && (Math.hypot(c.x - sp.sx, c.y - sp.sy) > 4 || sp.t > 0.3)) {
    sp.grabbed = true
    if (sp.who === 'angel') {
      a.state = 'held'
      sp.gx = a.x - c.x
      sp.gy = a.y - c.y
      g.talk = { who: 'angel', icon: 'excl', age: 0, life: 1.2 }
      for (const o of party.figures) if (o.react?.kind === 'mourn' && o.react.of === g.f) say(o, 'quest', 1.2)
    } else {
      im!.state = 'held'
      im!.air = false
      sp.gx = im!.x - c.x
      sp.gy = im!.y - c.y
      g.talk = { who: 'imp', icon: 'excl', age: 0, life: 1.2 }
    }
  }
  if (sp.grabbed) {
    sp.gx *= 1 - Math.min(1, dt * 5)
    sp.gy *= 1 - Math.min(1, dt * 5)
    if (sp.who === 'angel') {
      a.x = c.x + sp.gx
      a.y = c.y + sp.gy
    } else {
      im!.x = c.x + sp.gx
      im!.y = c.y + sp.gy
    }
  }
}

/** Letting go of the angel or the imp, moving at (vx, vy) */
function letGo(party: Party, sp: SpiritPress, vx: number, vy: number) {
  const g = sp.g, a = g.angel, im = g.imp
  const speed = Math.hypot(vx, vy)
  if (speed > 600) { vx *= 600 / speed; vy *= 600 / speed }
  if (sp.who === 'angel') {
    if (speed > 220) {
      // Flung! Off she tumbles, and her halo comes off
      a.state = 'flung'
      a.t = 0
      a.vx = vx
      a.vy = vy
      g.halo = { x: a.x, y: a.y - 25, vy: -40, t: 0, down: false }
      g.talk = { who: 'angel', icon: 'excl', age: 0, life: 1.4 }
      for (const o of party.figures) if (o.react?.kind === 'mourn' && o.react.of === g.f) say(o, pick(['excl', 'tear']), 1.6)
      for (const o of onlookers(party, a.x, 150, g.f)) {
        o.react = { kind: 'look', t: rand(1.2, 2), x: a.x + vx * 0.5, up: vy < -80 }
        say(o, pick(['excl', 'quest']), 1.3)
      }
    } else {
      a.state = 'back'
      g.talk = { who: 'angel', icon: 'dots', age: 0, life: 1.6 }
    }
  } else if (im) {
    im.state = 'flung'
    im.t = 0
    im.air = true
    im.vx = vx
    im.vy = vy
    // Thrown hard it gives up; set down, it gets back to work
    if (speed > 200) {
      im.beaten = true
      g.talk = { who: 'imp', icon: 'excl', age: 0, life: 1 }
    }
  }
}

/** Mouse down on the scene: if it's on a player, that's a click or the start of a grab */
export function pressParty(party: Party, p: ScenePointer, px: number, py: number): boolean {
  if (party.press || party.spirit) releaseParty(party)
  const w = toWorld(party, p, px, py)
  const sp = hitSpirit(party, w.x, w.y)
  if (sp) {
    party.cursor = w
    party.spirit = { ...sp, sx: w.x, sy: w.y, t: 0, grabbed: false, gx: 0, gy: 0, samples: [{ x: w.x, y: w.y, t: party.t }] }
    return true
  }
  const f = hitFigure(party, w.x, w.y)
  if (!f) return false
  party.cursor = w
  party.press = { f, sx: w.x, sy: w.y, t: 0, grabbed: false, gx: 0, gy: 0, samples: [{ x: w.x, y: w.y, t: party.t }] }
  return true
}

export const draggingParty = (party: Party) => !!party.press?.grabbed || !!party.spirit?.grabbed

/** Mouse up: a quick click waves, a grab throws */
export function releaseParty(party: Party) {
  const sp = party.spirit
  if (sp) {
    party.spirit = null
    const g = sp.g, a = g.angel, im = g.imp
    if (!party.graves.includes(g)) return
    if (sp.grabbed) {
      const [vx, vy] = throwSpeed(party, sp.samples)
      letGo(party, sp, vx, vy)
    } else if (sp.who === 'angel') {
      // A click: she giggles and twirls
      a.twirl = 0.8
      g.talk = { who: 'angel', icon: 'heart', age: 0, life: 1.5 }
      emit(party, 'heart', a.x, a.y - 26, 2)
      emit(party, 'spark', a.x, a.y - 14, 6)
    } else if (im && im.state !== 'bye') {
      // Bonk
      im.beaten = true
      im.state = 'dizzy'
      im.t = 0
      g.talk = { who: 'imp', icon: 'star', age: 0, life: 1 }
      emit(party, 'spark', im.x, im.y - 14, 5, '#ffe27a')
    } else if (im) {
      g.talk = { who: 'imp', icon: 'horns', age: 0, life: 1.2 }
    }
    return
  }
  const pr = party.press
  party.press = null
  if (!pr) return
  const f = pr.f
  if (!pr.grabbed) {
    if (f.mode === 'free') {
      if (f.pair) unpair(f.pair)
      f.react = { kind: 'wave', t: 1.6, x: f.x }
      hop(f, 110)
      say(f, 'heart')
      emit(party, 'heart', f.head.x + (Math.random() < 0.5 ? -6 : 6), f.head.y + 2)
    }
    return
  }
  if (!f.rag || f.mode !== 'held') return
  let [vx, vy] = throwSpeed(party, pr.samples)
  const speed = Math.hypot(vx, vy)
  if (speed > 1000) { vx *= 1000 / speed; vy *= 1000 / speed }
  throwRagdoll(f.rag, vx, vy)
  const feet = Math.max(f.rag.pts[FOOT_N].y, f.rag.pts[FOOT_F].y)
  const floor = feetY(party, f.rag.pts[HIP].x)
  const upright = f.rag.pts[NECK].y < f.rag.pts[HIP].y - 6
  if (speed < 80 && upright && feet > floor - 7 && !inPond(party.pond, f.rag.pts[HIP].x)) {
    // Set down gently: back on their feet
    startGetup(party, f, true)
  } else {
    f.mode = 'ragdoll'
    f.modeT = 0
    if (speed > 450) say(f, 'excl', 1)
  }
}

/** Throw velocity from the last ~90 ms of the cursor's movement */
function throwSpeed(party: Party, samples: { x: number; y: number; t: number }[]): [number, number] {
  const s = samples.filter(q => party.t - q.t < 0.09)
  if (s.length < 2) return [0, 0]
  const a = s[0], b = s[s.length - 1]
  const dt = Math.max(0.016, b.t - a.t)
  return [(b.x - a.x) / dt, (b.y - a.y) / dt]
}

function stepPress(party: Party, dt: number) {
  stepSpirit(party, dt)
  const pr = party.press
  if (!pr) return
  pr.t += dt
  const c = party.cursor
  const f = pr.f
  if (!c || f.leaving || f.mode === 'dead' || f.hidden) {
    party.press = null
    if (f.mode === 'held' && f.rag) {
      f.rag.pin = -1
      f.mode = 'ragdoll'
      f.modeT = 0
    }
    return
  }
  pr.samples.push({ x: c.x, y: c.y, t: party.t })
  if (pr.samples.length > 12) pr.samples.shift()
  if (!pr.grabbed && (Math.hypot(c.x - pr.sx, c.y - pr.sy) > 4 || pr.t > 0.3)) grab(party, pr, c)
  if (pr.grabbed && f.rag) {
    pr.gx *= 1 - Math.min(1, dt * 5)
    pr.gy *= 1 - Math.min(1, dt * 5)
    f.rag.pinX = c.x + pr.gx
    f.rag.pinY = c.y + pr.gy
  }
}

function grab(party: Party, pr: Press, c: XY) {
  const f = pr.f
  if (!f.rag) f.rag = ragdollFromSkel(f.skel, f.dir, f.mode === 'swim' ? 0 : f.vx, f.jumpV)
  // Picked up by whichever bit is closest to the cursor: a foot means upside down
  let best = NECK, bestD = Infinity
  f.rag.pts.forEach((q, i) => {
    const d = Math.hypot(q.x - c.x, q.y - c.y) - (i === NECK || i === HEAD_PT ? 3 : 0)
    if (d < bestD) { bestD = d; best = i }
  })
  f.rag.pin = best
  pr.gx = f.rag.pts[best].x - c.x
  pr.gy = f.rag.pts[best].y - c.y
  f.rag.pinX = f.rag.pts[best].x
  f.rag.pinY = f.rag.pts[best].y
  pr.grabbed = true
  f.mode = 'held'
  f.modeT = 0
  f.jump = f.jumpV = 0
  f.hopT = 0
  f.vx = 0
  f.dest = null
  interrupt(party, f)
  f.react = null
  say(f, 'excl', 1.2)
  for (const o of free(party)) {
    if (Math.abs(o.x - f.x) < 80 && o.react?.kind !== 'mourn' && Math.random() < 0.7) {
      o.react = { kind: 'look', t: rand(1.2, 2.2), x: f.x }
      if (Math.random() < 0.4) say(o, Math.random() < 0.5 ? 'excl' : 'quest')
    }
  }
}

function ragWorld(party: Party, f: Figure): RagWorld {
  const pond = party.pond
  return {
    floor: x => (inPond(pond, x) ? bedAt(pond, x) ?? groundAt(party.env, x) : groundAt(party.env, x)),
    water: x => surfaceAt(pond, x),
    left: -party.offX + 2,
    right: party.env.W * 2 - party.offX - 2,
    impact: (i, speed, x, y) => landed(party, f, i, speed, x, y),
    splash: (x, speed) => {
      if (speed < 30) return
      splash(pond, x, clamp(speed / 110, 0.5, 5))
      emit(party, 'drop', x, surfaceAt(pond, x) ?? pond.level, Math.min(10, Math.round(speed / 60)))
    },
  }
}

function landed(party: Party, f: Figure, i: number, speed: number, x: number, y: number) {
  if (speed < 140 || party.t - f.lastHit < 0.25) return
  f.lastHit = party.t
  emit(party, 'dust', x, y, Math.min(8, Math.round(speed / 70)))
  if (speed < 230 || !(i === HEAD_PT || i === NECK || i === HIP) || f.mode === 'dead') return
  const hurt = clamp((speed - 230) / 250, 0.2, 2.4)
  f.hurt += hurt
  f.dizzy = Math.min(6, f.dizzy + hurt * 1.6)
  f.red = 0.35
  for (const o of free(party)) {
    if (Math.abs(o.x - f.x) < 90 && !o.react) {
      o.react = { kind: 'look', t: rand(1, 2), x: f.x }
      if (Math.random() < 0.5) say(o, speed > 400 ? 'excl' : 'quest')
    }
  }
  if (f.hurt >= 3) die(party, f)
}

function stepRagdollFigure(party: Party, f: Figure, dt: number) {
  const r = f.rag
  if (!r) {
    // Under their gravestone: the grave brings them back
    if (f.mode !== 'dead') f.mode = 'free'
    return
  }
  stepRagdoll(r, dt, ragWorld(party, f))
  f.skel = skelFromRagdoll(r, f.dir)
  f.x = r.pts[HIP].x
  if (f.mode === 'held' || f.mode === 'dead') return

  // Fell in the pond: swim for it
  const s = surfaceAt(party.pond, r.pts[HIP].x)
  if (s !== null && r.pts[HIP].y > s + 1) {
    f.wet = Math.max(f.wet, 0.4)
    if (f.modeT > 0.4 && r.pts[HEAD_PT].y > s - 6) {
      startSwim(party, f)
      return
    }
  }
  // Settled, or wedged against a step in the ground where it never quite stops twitching
  if (f.mode === 'ragdoll' && (r.still > 0.45 || f.modeT > 4)) {
    f.mode = 'down'
    f.modeT = 0
  }
  if (f.mode === 'down' && f.modeT > 0.5 + Math.min(2, f.dizzy * 0.4)) startGetup(party, f, false)
}

function startGetup(party: Party, f: Figure, gentle: boolean) {
  const r = f.rag!
  f.skel = skelFromRagdoll(r, f.dir)
  f.x = clamp(r.pts[HIP].x, party.lo - 8, party.hi + 8)
  f.rag = null
  f.vx = 0
  f.dest = null
  f.mode = gentle ? 'free' : 'getup'
  f.modeT = 0
  if (gentle) {
    f.squash = 0.6
    f.react = { kind: 'look', t: 0.6, x: f.x + f.dir }
  }
}

function startSwim(party: Party, f: Figure) {
  const r = f.rag!
  f.skel = skelFromRagdoll(r, f.dir)
  f.x = clamp(r.pts[HIP].x, party.pond.x0 + 2, party.pond.x1 - 2)
  f.rag = null
  f.mode = 'swim'
  f.modeT = 0
  f.vx = 0
  say(f, Math.random() < 0.5 ? 'excl' : 'tear', 1.4)
}

function stepSwim(party: Party, f: Figure, dt: number) {
  const pond = party.pond
  const toLeft = f.x - pond.x0 < pond.x1 - f.x
  const exit = toLeft ? pond.x0 + 2 : pond.x1 - 3
  const d = exit - f.x
  f.dir = d < 0 ? -1 : 1
  if (f.modeT > 0.8) f.x += Math.sign(d) * Math.min(Math.abs(d), 11 * dt)
  f.phase += dt
  if (Math.random() < dt * 3) {
    splash(pond, f.x + f.dir * 6, 0.45)
    emit(party, 'drop', f.x + f.dir * 7, surfaceAt(pond, f.x) ?? pond.level, 1)
  }
  const surface = surfaceAt(pond, f.x) ?? pond.level
  const t = f.t
  const target: Skel = {
    x: f.x, y: surface + 4,
    body: 1.3, head: 0.1,
    armN: t * 5.5, armF: t * 5.5 + Math.PI,
    legN: -1.35 + Math.sin(t * 10) * 0.35, legF: -1.35 - Math.sin(t * 10) * 0.35,
  }
  f.skel = blendSkel(f.skel, target, 1 - Math.exp(-(f.modeT < 0.6 ? 5 : 14) * dt), 1 - Math.exp(-20 * dt))
  if (Math.abs(d) < 1) {
    // Out onto the bank with a hop, then a good shake
    f.mode = 'free'
    f.modeT = 0
    f.x = toLeft ? pond.x0 - 7 : pond.x1 + 7
    f.jumpV = -130
    f.jump = -6
    f.wet = 7
    f.react = { kind: 'shake', t: 1.3, x: f.x }
    for (let i = 0; i < 10; i++) emit(party, 'drop', f.x, surface - 10, 1)
  }
}

// ── Too much: the gravestone and the angel ───────────────────

function die(party: Party, f: Figure) {
  f.mode = 'dead'
  f.modeT = 0
  f.devil = 0
  f.prank = null
  f.red = 1.2
  if (party.press?.f === f) party.press = null
  if (f.rag) f.rag.pin = -1
  party.graves.push({
    f, x: f.x, phase: 'ko', t: 0, rise: 0, glow: 0, beam: 0, arms: 0, alpha: 0,
    angel: { state: 'off', x: f.x, y: 0, vx: 0, vy: 0, spin: 0, twirl: 0, t: 0 },
    imp: null, crack: 0, halo: null, talk: null, shake: 0,
  })
}

/** Everyone out and about near x (not the dead player, not mourners unless asked) */
function onlookers(party: Party, x: number, radius: number, except: Figure | null, mourners = false): Figure[] {
  return party.figures.filter(o => o !== except && o.mode === 'free' && !o.hidden && !o.leaving && o.devil <= 0 &&
    Math.abs(o.x - x) < radius && (mourners || o.react?.kind !== 'mourn'))
}

/** Everyone mourning `dead` stops: cheering if they came back, quietly if they left */
function endMourning(party: Party, dead: Figure, back: boolean) {
  for (const o of party.figures) {
    if (o.react?.kind !== 'mourn' || o.react.of !== dead) continue
    if (back) {
      o.react = { kind: 'cheer', t: 2.2, x: o.x }
      say(o, pick(['heart', 'note', 'star']))
    } else {
      o.react = null
    }
  }
}

function stepGraves(party: Party, dt: number) {
  for (const g of party.graves) {
    g.t += dt
    const f = g.f
    if (g.talk) {
      g.talk.age += dt
      if (g.talk.age > g.talk.life) g.talk = null
    }
    g.shake = Math.max(0, g.shake - dt)
    stepHalo(party, g, dt)
    if (g.phase !== 'rumble' && g.phase !== 'imp') g.crack = Math.max(0, g.crack - dt * 0.8)
    if (f.leaving && g.phase !== 'depart' && g.phase !== 'gone') {
      // Logged off while down: gone in a puff, grave and all
      const x = f.rag ? f.rag.pts[HIP].x : g.x
      emit(party, 'smoke', x, feetY(party, x) - 4, 6)
      if (g.phase !== 'ko') emit(party, 'dust', g.x, feetY(party, g.x), 6, '#7a5a3e')
      endMourning(party, f, false)
      if (party.press?.f === f) party.press = null
      if (party.spirit?.g === g) party.spirit = null
      party.graves = party.graves.filter(q => q !== g)
      party.figures = party.figures.filter(q => q !== f)
      continue
    }
    const base = feetY(party, g.x)
    const a = g.angel
    stepAngel(party, g, dt)
    if (g.imp) stepImp(party, g, g.imp, dt)
    switch (g.phase) {
      case 'ko':
        f.red = Math.max(f.red, 0.6)
        if (g.t > 1.1) {
          // Poof, like any mob in Minecraft, and a gravestone rises where they fell
          if (f.rag) for (const q of f.rag.pts) emit(party, 'smoke', q.x, q.y, 2)
          let x = f.rag ? f.rag.pts[HIP].x : f.x
          if (inPond(party.pond, x)) x = x - party.pond.x0 < party.pond.x1 - x ? party.pond.x0 - 8 : party.pond.x1 + 8
          g.x = clamp(x, party.lo + 6, party.hi - 6)
          f.hidden = true
          f.rag = null
          g.phase = 'grave'
          g.t = 0
          emit(party, 'dust', g.x, feetY(party, g.x), 8, '#7a5a3e')
          // Friends gather round
          const mourners = free(party).sort((a, b) => Math.abs(a.x - g.x) - Math.abs(b.x - g.x)).slice(0, 4)
          mourners.forEach((o, k) => {
            const side = o.x < g.x ? -1 : 1
            o.react = { kind: 'mourn', t: 1, x: clamp(g.x + side * (15 + Math.floor(k / 2) * 12), party.lo, party.hi), of: f }
            interrupt(party, o)
          })
        }
        break
      case 'grave':
        g.rise = Math.min(1, g.t / 0.7)
        for (const o of party.figures) if (o.react?.kind === 'mourn' && o.react.of === f && Math.random() < dt * 0.25) say(o, pick(['tear', 'dots']))
        if (g.t > 4.5) { g.phase = 'angel'; g.t = 0 }
        break
      case 'angel': {
        if (a.state === 'off') {
          // On her way down (again, if the imp was seen off)
          a.state = 'fly'
          a.spin = 0
          g.t = 0
        }
        if (a.state !== 'fly') {
          // Carried off, or on her way back: nothing happens without her
          g.t -= dt
          g.beam = Math.max(0, g.beam - dt * 1.5)
          break
        }
        g.beam = Math.min(1, g.t / 0.8)
        g.alpha = Math.min(1, g.t / 0.6)
        a.x = g.x
        a.y = angelDescent(party, g, base)
        if (Math.random() < dt * 8) emit(party, 'spark', a.x + rand(-8, 8), a.y - rand(4, 20), 1)
        if (g.t > 0.5 && g.t - dt <= 0.5) {
          for (const o of party.figures) if (o.react?.kind === 'mourn' && o.react.of === f) say(o, 'excl', 1.4)
          // Everyone nearby looks up at her
          for (const o of onlookers(party, g.x, 150, f)) {
            if (o.react) continue
            o.react = { kind: 'look', t: rand(2, 3.2), x: g.x, up: true }
            if (Math.random() < 0.4) say(o, pick(['star', 'excl']))
          }
        }
        if (g.t > 3.6) { g.phase = 'raise'; g.t = 0 }
        break
      }
      case 'raise':
        if (a.state !== 'fly') {
          g.t = 0
          g.arms = Math.max(0, g.arms - dt * 3)
          g.glow = Math.max(0, g.glow - dt * 2)
          g.beam = Math.max(0, g.beam - dt * 1.5)
          break
        }
        g.beam = Math.min(1, g.beam + dt * 2)
        g.arms = Math.min(1, g.t / 0.5)
        g.glow = Math.min(1, g.t / 1.1)
        a.x = g.x
        a.y = base - 34 + Math.sin(g.t * 3) * 1.5
        if (Math.random() < dt * 20) emit(party, 'spark', g.x + rand(-6, 6), base - rand(0, 12), 1)
        if (g.t > 1.3) {
          for (let i = 0; i < 14; i++) emit(party, 'spark', g.x + rand(-5, 5), base - rand(0, 10), 1)
          emit(party, 'dot', g.x, base - 4, 8, '#8f94a3')
          f.hidden = false
          f.mode = 'rising'
          f.rise = 1
          f.x = g.x
          f.dir = 1
          f.front = true
          f.want = { stance: 'stand', gesture: 'cheer', dir: 0, front: true }
          f.skel = targetSkel(party, f)
          f.hurt = 0
          f.dizzy = 0
          f.red = 0
          f.halo = 14
          g.phase = 'depart'
          g.t = 0
        }
        break
      case 'depart':
        g.arms = Math.max(0, 1 - g.t)
        if (f.mode === 'rising') {
          f.rise = Math.max(0, 1 - g.t / 1.8)
          if (f.rise <= 0) {
            f.mode = 'free'
            f.front = true
            f.react = { kind: 'cheer', t: 2.6, x: f.x }
            say(f, 'heart', 2)
            emit(party, 'heart', f.x, base - 30, 4)
            endMourning(party, f, true)
          }
        }
        // Once they're up, the gravestone crumbles back into the ground
        if (g.t >= 1.2 && g.t - dt < 1.2) {
          emit(party, 'dust', g.x, base, 8, '#8f94a3')
          emit(party, 'spark', g.x, base - 6, 5)
        }
        g.rise = 1 - clamp((g.t - 1.2) / 0.7, 0, 1)
        g.glow = Math.max(0, 1 - g.t / 0.8)
        if (g.t > 1.6) {
          a.y -= dt * (20 + (g.t - 1.6) * 40)
          g.alpha = Math.max(0, 1 - (g.t - 2.4) / 1.6)
          g.beam = Math.max(0, 1 - (g.t - 2.4) / 1.4)
        }
        break
      case 'spurned':
        // She's gone off in a huff. A pause, and then the ground starts to rumble...
        if (g.t > 1.1) {
          g.phase = 'rumble'
          g.t = 0
        }
        break
      case 'rumble':
        g.crack = Math.min(1, g.t / 1.2)
        g.shake = Math.max(g.shake, 0.1)
        if (Math.random() < dt * 10) emit(party, 'smoke', g.x + rand(-7, 7), base - 1, 1, '90,40,50')
        if (g.t > 0.3 && g.t - dt <= 0.3) {
          for (const o of party.figures) {
            if (o.react?.kind !== 'mourn' || o.react.of !== f) continue
            hop(o, 100)
            say(o, 'excl', 1.4)
          }
          for (const o of onlookers(party, g.x, 110, f)) {
            o.react = { kind: 'look', t: rand(1.5, 2.5), x: g.x }
            hop(o, 80)
            if (Math.random() < 0.6) say(o, pick(['excl', 'quest']), 1.3)
          }
        }
        if (g.t > 1.5) {
          const side: 1 | -1 = g.x + 12 > party.hi ? -1 : 1
          g.imp = {
            state: 'rise', x: g.x + side * 11, y: base, vx: 0, vy: 0, t: 0, dir: side === 1 ? -1 : 1, pokes: 0, sink: 1,
            beaten: false, air: false, chaseT: 0, victim: null, last: null, rest: 0, jab: 0,
          }
          g.phase = 'imp'
          g.t = 0
        }
        break
      case 'imp':
        g.crack = Math.max(g.crack, 0.6)
        if (!g.imp) {
          // Seen off: the crack closes and the angel, a little sheepish, comes back down
          g.phase = 'angel'
          g.t = 0
          a.state = 'off'
          if (g.halo) g.halo.t = Math.max(g.halo.t, 3)
          for (const o of party.figures) if (o.react?.kind === 'mourn' && o.react.of === f) say(o, pick(['star', 'heart']))
        }
        break
      case 'gone':
        // Out they came: the gravestone crumbles, and the crack stays open till the imp goes home
        g.rise = Math.max(0, 1 - g.t / 0.35)
        if (g.imp && g.imp.state !== 'dive' && g.imp.state !== 'sizzle') g.crack = Math.max(g.crack, 0.5)
        if (!g.imp && g.crack <= 0 && g.t > 1) party.graves = party.graves.filter(q => q !== g)
        break
    }
  }
  party.graves = party.graves.filter(g => !(g.phase === 'depart' && g.t > 4.2))
}

const angelDescent = (party: Party, g: Grave, base: number) => {
  const top = -party.offY - 40
  return top + (base - 34 - top) * easeOut(g.t / 3.2)
}

function stepAngel(party: Party, g: Grave, dt: number) {
  const a = g.angel
  a.t += dt
  a.twirl = Math.max(0, a.twirl - dt)
  const base = feetY(party, g.x)
  switch (a.state) {
    case 'back': {
      // Fluttering back to where she was, a bit put out
      const hx = g.x, hy = g.phase === 'angel' ? angelDescent(party, g, base) : base - 34
      const k = 1 - Math.exp(-4 * dt)
      a.x += (hx - a.x) * k
      a.y += (hy - a.y) * k
      a.spin *= 1 - k
      if (Math.hypot(hx - a.x, hy - a.y) < 1.5) a.state = 'fly'
      break
    }
    case 'flung': {
      if (a.t < 0.8) {
        // Tumbling
        a.vy += 160 * dt
        a.spin += dt * 10 * (a.vx >= 0 ? 1 : -1)
        const floor = groundAt(party.env, a.x) - 4
        if (a.y > floor && a.vy > 0) { a.y = floor; a.vy = -Math.abs(a.vy) * 0.5 }
      } else {
        // Rights herself and flies off in a huff
        a.spin *= 1 - Math.min(1, dt * 6)
        a.vx += ((a.vx >= 0 ? 70 : -70) - a.vx) * Math.min(1, dt * 2)
        a.vy += (-110 - a.vy) * Math.min(1, dt * 2)
      }
      a.x += a.vx * dt
      a.y += a.vy * dt
      const left = -party.offX - 30, right = party.env.W * 2 - party.offX + 30
      if (a.t > 3 || a.x < left || a.x > right || a.y < -party.offY - 50) {
        a.state = 'off'
        g.phase = 'spurned'
        g.t = 0
        g.beam = 0
        g.arms = 0
        g.glow = 0
      }
      break
    }
  }
}

function stepHalo(party: Party, g: Grave, dt: number) {
  const h = g.halo
  if (!h) return
  h.t += dt
  if (!h.down) {
    h.vy += 300 * dt
    h.y += h.vy * dt
    const floor = groundAt(party.env, h.x) - 3
    if (h.y >= floor) {
      h.y = floor
      if (h.vy > 60) h.vy = -h.vy * 0.3
      else { h.down = true; emit(party, 'spark', h.x, h.y, 3) }
    }
  }
  if (h.t > 6) g.halo = null
}

function stepImp(party: Party, g: Grave, im: Imp, dt: number) {
  im.t += dt
  const ground = feetY(party, im.x)
  // Hops and throws
  if (im.air && im.state !== 'held') {
    im.vy += 420 * dt
    im.x += im.vx * dt
    im.y += im.vy * dt
    im.x = clamp(im.x, -party.offX + 4, party.env.W * 2 - party.offX - 4)
    const water = surfaceAt(party.pond, im.x)
    if (water !== null && im.y >= water && im.state === 'flung') {
      // Into the pond: sssss
      im.state = 'sizzle'
      im.t = 0
      im.air = false
      im.y = water + 2
      splash(party.pond, im.x, 2)
      emit(party, 'smoke', im.x, water - 2, 10, '235,235,240')
      g.talk = { who: 'imp', icon: 'tear', age: 0, life: 1.4 }
    } else if (im.y >= feetY(party, im.x)) {
      im.y = feetY(party, im.x)
      if (im.vy > 90 && im.state === 'flung') {
        im.vy = -im.vy * 0.35
        im.vx *= 0.6
        emit(party, 'dust', im.x, im.y, 3)
      } else {
        im.air = false
        im.vy = 0
        im.vx = 0
        if (im.state === 'flung') {
          // Thrown hard it's had enough; set down, it gets back to what it was doing
          im.state = im.beaten ? 'dizzy' : g.phase === 'gone' ? 'chase' : 'poke'
          im.t = 0
        }
      }
    }
  }
  const home = g.x + (im.x >= g.x ? 1 : -1) * 7
  im.jab = Math.max(0, im.jab - dt)
  switch (im.state) {
    case 'chase':
      impChase(party, g, im, dt)
      break
    case 'home':
      // Scampering back to its crack
      if (Math.abs(home - im.x) > 2) {
        if (!im.air) {
          im.dir = home > im.x ? 1 : -1
          im.x += im.dir * Math.min(Math.abs(home - im.x), 50 * dt)
          im.y = feetY(party, im.x)
        }
        break
      }
      im.state = im.beaten ? 'dive' : 'bye'
      im.t = 0
      if (!im.beaten) g.talk = { who: 'imp', icon: 'horns', age: 0, life: 1.2 }
      break
    case 'rise':
      im.sink = Math.max(0, 1 - im.t / 0.4)
      im.y = ground
      if (im.t > 0.4) {
        im.state = 'cackle'
        im.t = 0
        im.air = true
        im.vy = -110
        emit(party, 'smoke', im.x, ground - 2, 8, '90,40,50')
        g.talk = { who: 'imp', icon: 'horns', age: 0, life: 1.6 }
      }
      break
    case 'cackle':
      // A little bounce of glee
      if (!im.air && im.t < 1.3 && Math.random() < dt * 4) { im.air = true; im.vy = -60 }
      if (im.t > 1.4 && !im.air) { im.state = 'poke'; im.t = 0; im.pokes = 0 }
      break
    case 'poke':
      if (Math.abs(home - im.x) > 1) {
        im.dir = home > im.x ? 1 : -1
        im.x += Math.sign(home - im.x) * Math.min(Math.abs(home - im.x), 22 * dt)
        im.y = feetY(party, im.x)
        im.t = 0
        break
      }
      im.dir = g.x > im.x ? 1 : -1
      if (im.t > 0.35 && im.t - dt <= 0.35) {
        // Jab
        im.pokes++
        g.shake = 0.3
        emit(party, 'spark', g.x - im.dir * 3, feetY(party, g.x) - 6, 5, '#ff6a3a')
        if (im.pokes === 2) g.talk = { who: 'imp', icon: 'note', age: 0, life: 1 }
      }
      if (im.t > 0.7) {
        im.t = 0
        if (im.pokes >= 3) burst(party, g)
      }
      break
    case 'bye':
      if (im.t > 1.2) { im.state = 'dive'; im.t = 0; im.air = true; im.vy = -80; im.vx = (g.x - im.x) * 1.5 }
      break
    case 'dizzy':
      if (im.t > 1.3) {
        im.state = 'sulk'
        im.t = 0
        g.talk = { who: 'imp', icon: 'tear', age: 0, life: 1.4 }
      }
      break
    case 'sulk':
      // Off home in a sulk, everyone cheering
      if (im.t > 0.9) {
        im.state = 'home'
        im.t = 0
        for (const o of party.figures) {
          if (o === g.f || o.mode !== 'free' || o.hidden || o.devil > 0 || Math.abs(o.x - im.x) > 140) continue
          if (o.react?.kind === 'mourn') { say(o, pick(['star', 'heart'])); continue }
          o.react = { kind: 'cheer', t: 1.4, x: o.x }
          say(o, pick(['star', 'heart', 'note']))
        }
      }
      break
    case 'dive':
      if (im.air) break
      if (im.sink === 0) emit(party, 'smoke', im.x, im.y - 2, 6, '90,40,50')
      im.sink = Math.min(1, im.sink + dt / 0.4)
      if (im.sink >= 1) g.imp = null
      break
    case 'sizzle':
      if (im.t < dt * 1.5) {
        for (const o of party.figures) {
          if (o === g.f || o.mode !== 'free' || o.hidden || o.devil > 0 || Math.abs(o.x - im.x) > 160) continue
          if (o.react?.kind === 'mourn') { say(o, pick(['star', 'heart'])); continue }
          o.react = { kind: 'cheer', t: 1.6, x: o.x }
          say(o, pick(['star', 'heart', 'note']))
        }
      }
      im.sink = Math.min(1, im.sink + dt / 0.9)
      if (Math.random() < dt * 14) emit(party, 'smoke', im.x + rand(-3, 3), im.y - 3, 1, '235,235,240')
      if (im.sink >= 1) g.imp = null
      break
  }
}

/** The imp's way: they burst out of the ground, horns and all */
function burst(party: Party, g: Grave) {
  const f = g.f, base = feetY(party, g.x)
  emit(party, 'smoke', g.x, base - 4, 12, '90,40,50')
  emit(party, 'spark', g.x, base - 6, 10, '#ff6a3a')
  emit(party, 'dust', g.x, base, 10, '#8f94a3')
  f.hidden = false
  f.mode = 'free'
  f.modeT = 0
  f.rag = null
  f.x = g.x
  f.dir = g.imp && g.imp.x > g.x ? -1 : 1
  f.front = true
  f.want = { stance: 'stand', gesture: 'cheer', dir: 0, front: true }
  f.skel = targetSkel(party, f)
  f.jump = -1
  f.jumpV = -150
  f.squash = -0.5
  f.hurt = 0
  f.dizzy = 0
  f.red = 0.5
  f.devil = 22
  f.prank = null
  f.prankCool = 1.2
  f.react = null
  say(f, 'horns', 2)
  for (const o of party.figures) {
    if (o === f || (o.react?.kind !== 'mourn' || o.react.of !== f) && !onlookers(party, g.x, 110, f).includes(o)) continue
    o.react = { kind: 'look', t: 1.2, x: f.x }
    hop(o, 90)
    say(o, pick(['excl', 'quest']))
  }
  g.phase = 'gone'
  g.t = 0
  if (g.imp) {
    // And now, everyone else
    const im = g.imp
    im.state = 'chase'
    im.t = 0
    im.chaseT = 14
    im.rest = 1
    im.victim = null
    im.last = f
    g.talk = { who: 'imp', icon: 'horns', age: 0, life: 1.4 }
  }
}

/** The imp's own chase: quick little legs, a hop now and then, a jab for whoever it catches */
function impChase(party: Party, g: Grave, im: Imp, dt: number) {
  const by: Chaser = { imp: im }
  im.chaseT -= dt
  im.rest -= dt
  if (im.chaseT <= 0 || !party.figures.some(chaseable)) {
    im.state = 'home'
    im.t = 0
    return
  }
  panic(party, im.x, by, 50)
  if (im.rest > 0) {
    if (!im.air && Math.random() < dt * 3) { im.air = true; im.vy = -60 }
    return
  }
  if (!chaseable(im.victim)) im.victim = pickVictim(party, im.x, im.last)
  const v = im.victim
  if (!v) return
  const d = v.x - im.x
  im.dir = d >= 0 ? 1 : -1
  if (Math.abs(d) > 5) {
    if (!im.air) {
      im.x += im.dir * Math.min(Math.abs(d), 36 * dt)
      im.y = feetY(party, im.x)
      if (Math.random() < dt * 1.2) { im.air = true; im.vy = -75; im.vx = im.dir * 36 }
    }
    return
  }
  im.jab = 0.3
  caught(party, v, im.x, by)
  g.talk = { who: 'imp', icon: pick(['horns', 'note']), age: 0, life: 1 }
  im.last = v
  im.victim = null
  im.rest = 0.8
}

// ── Things in flight, butterflies ────────────────────────────

function stepFlyers(party: Party, dt: number) {
  for (const fl of party.flyers) {
    fl.t += dt
    fl.vy += 300 * dt
    fl.x += fl.vx * dt
    fl.y += fl.vy * dt
    if (Math.random() < dt * 20) party.particles.push({ x: fl.x, y: fl.y, vx: 0, vy: 20, life: 0.4, max: 0.4, kind: 'drop', color: '', g: 200 })
    if (fl.t >= 0.7) {
      const f = fl.to
      if (f.mode === 'free' && f.fishing) {
        f.item = { kind: fl.kind }
        f.fishing.phase = 'show'
        f.fishing.t = 0
        say(f, fl.kind === 'fish' ? 'heart' : fl.kind === 'boot' ? 'quest' : 'star')
        if (fl.kind === 'book') emit(party, 'spark', f.x, f.skel.y - 30, 8, '#d9b8ff')
        for (const o of free(party)) {
          if (o !== f && o.spot && !o.spot.fisher && o.react?.kind !== 'mourn' && Math.random() < 0.7) o.react = { kind: 'cheer', t: 1.4, x: o.x }
        }
      }
    }
  }
  party.flyers = party.flyers.filter(fl => fl.t < 0.7)
}

function stepButterflies(party: Party, dt: number) {
  const day = party.light.time === 'day' || party.light.time === 'dawn'
  if (day && party.butterflies.length < 2 && Math.random() < dt * 0.1) {
    party.butterflies.push({ x: rand(party.lo, party.hi), y: feetY(party, party.lo) - 40, t: 0, color: pick(['#ffb13a', '#8fb7ff', '#ff8fd6']), on: null, onT: 0, ph: rand(0, 6) })
  }
  for (const b of party.butterflies) {
    b.t += dt
    if (b.on) {
      // Resting on someone's head
      b.onT -= dt
      b.x = b.on.head.x + 1
      b.y = b.on.head.y - 1
      if (b.onT <= 0 || b.on.mode !== 'free' || b.on.hidden) b.on = null
      continue
    }
    b.x += Math.sin(b.t * 0.7 + b.ph) * 14 * dt + Math.sin(b.t * 2.3) * 6 * dt
    b.y += Math.cos(b.t * 1.9 + b.ph) * 12 * dt
    const ground = feetY(party, b.x)
    b.y = clamp(b.y, ground - 60, ground - 6)
    if (Math.random() < dt * 0.05) {
      const f = pick(free(party))
      if (f && Math.hypot(f.head.x - b.x, f.head.y - b.y) < 50) {
        b.on = f
        b.onT = rand(3, 6)
        if (Math.random() < 0.6) say(f, 'heart')
        f.faceCam = true
      }
    }
  }
  party.butterflies = party.butterflies.filter(b => day && b.x > party.lo - 30 && b.x < party.hi + 30)
}

// ── Posing ───────────────────────────────────────────────────

/** Where every part of the body wants to be this frame, from stance, gesture and movement */
function targetSkel(party: Party, f: Figure): Skel {
  return poseSkel(f, targetPose(party, f), feetY(party, f.x))
}

function targetPose(party: Party, f: Figure): Pose {
  const w = f.want
  const t = f.t
  const speed = Math.abs(f.vx)
  const moving = speed > 2
  const stance: Stance = moving ? 'stand' : w.stance
  const P: Pose = { hx: 0, hy: -12, body: 0, head: 0, armN: 0, armF: 0, legN: 0, legF: 0 }
  switch (stance) {
    case 'sit':
      Object.assign(P, { hy: -2, body: -0.04, armN: 0.55, armF: 0.45, legN: Math.PI / 2 - 0.04, legF: Math.PI / 2 - 0.1 })
      break
    case 'lie':
      Object.assign(P, {
        hx: 4, hy: -3, body: -Math.PI / 2, head: -Math.PI / 2, armN: -2.2, armF: -1.95,
        legN: Math.PI / 2, legF: Math.PI / 2 + 0.45 + Math.sin(t * 0.8 + f.x) * 0.12,
      })
      break
    case 'crouch':
      Object.assign(P, { hy: -11, body: 0.45, head: -0.1, armN: 0.35, armF: 0.3, legN: -0.18, legF: -0.18 })
      break
    default: {
      const amp = clamp(speed / WALK, 0, 1) * 0.55 + clamp((speed - WALK) / (RUN - WALK), 0, 1) * 0.35
      const s = Math.sin(f.phase)
      const breathe = Math.sin(t * 1.7 + f.x) * 0.04
      P.hy = -12 - (amp > 0.05 ? Math.abs(Math.cos(f.phase)) * 0.9 : 0)
      P.body = speed > WALK * 1.2 ? 0.18 : amp * 0.06
      P.head = speed > WALK * 1.2 ? -0.1 : 0
      P.armN = -s * amp * 0.9 + breathe
      P.armF = s * amp * 0.9 - breathe
      P.legN = s * amp
      P.legF = -s * amp
      if (moving) {
        // A bob of the head with each step, and leaning into starts and stops
        P.head += Math.sin(f.phase * 2) * 0.035
        P.body += clamp(f.acc * f.dir * 0.0025, -0.14, 0.14)
      } else {
        // Shifting their weight about
        P.body += Math.sin(t * 0.8 + f.x * 0.3) * 0.025
        P.armN += Math.sin(t * 0.8 + f.x * 0.3) * 0.03
      }
      if (f.dizzy > 0.5 && !moving) {
        P.body = Math.sin(t * 3) * 0.08 * Math.min(1, f.dizzy / 2)
        P.head = Math.sin(t * 3 + 1) * 0.15 * Math.min(1, f.dizzy / 2)
      }
    }
  }

  const g = moving && !['flail', 'give', 'point', 'holdup'].includes(w.gesture) ? 'none' : w.gesture
  switch (g) {
    case 'wave': P.armF = 2.55 + Math.sin(t * 12) * 0.4; P.armN = 0.12; break
    case 'cheer': P.armN = 2.5 + Math.sin(t * 11) * 0.3; P.armF = 2.5 + Math.sin(t * 11 + 1) * 0.3; break
    case 'holdup': P.armN = P.armF = 2.75; break
    case 'stretch': P.armN = P.armF = 2.95; P.body = Math.sin(t * 2.2) * 0.14; P.head = P.body * 1.4; break
    case 'shake': P.body = Math.sin(t * 30) * 0.1; P.head = Math.sin(t * 30 + 0.8) * 0.25; P.armN = P.armF = 0.35 + Math.sin(t * 30) * 0.15; break
    case 'point': P.armN = 2.25 + Math.sin(t * 3) * 0.05; break
    case 'pointUp': P.armN = Math.PI - 0.15 + Math.sin(t * 3) * 0.05; break
    case 'lookup': P.head = -0.3 + Math.sin(t * 0.6 + f.x) * 0.05; break
    case 'eat': P.armN = 2.05 + Math.max(0, Math.sin(t * 8)) * 0.3; P.head = 0.1; break
    case 'give': P.armN = 1.45; break
    case 'hug': P.armN = 1.3; P.armF = 1.4; P.body = 0.08; break
    case 'highfive': P.armN = 2.65; break
    case 'roast': P.armN = 1.15; break
    case 'warm': P.armN = 1.3; P.armF = 1.2; break
    case 'fish': P.armN = f.fishing?.arm ?? 0.9; P.armF = 0.4; break
    case 'flail': P.armN = 2.4 + Math.sin(t * 22) * 0.7; P.armF = 2.1 + Math.sin(t * 22 + 2) * 0.7; break
    case 'mourn': P.head = 0.5; P.armN = P.armF = 0.05; P.body = 0.06; break
    case 'sleep': P.head = 0.55 + Math.sin(t * 1.3) * 0.05; P.body = 0.08; break
    case 'dance': dance(party, f, P, stance); break
  }

  if (g === 'none' && !moving && (stance === 'stand' || stance === 'sit')) P.head += f.glance
  // Getting ready to jump: arms back, leaning in; then arms up and legs tucked in the air
  if (g === 'none' || g === 'wave' || g === 'cheer') {
    if (f.hopT > 0) {
      P.armN = P.armF = -0.55
      P.body += 0.14
      P.head -= 0.08
    } else if (f.jump < -1) {
      const up = f.jumpV < 0
      if (g === 'none') {
        P.armN = up ? 2.3 : 1.5
        P.armF = up ? 2.0 : 1.2
      }
      P.legN = up ? 0.4 : 0.15
      P.legF = up ? -0.35 : -0.1
    }
  }
  if (f.nod < 0.45) P.head += Math.sin((f.nod / 0.45) * Math.PI) * 0.2 * f.nodDir
  return P
}

function dance(party: Party, f: Figure, P: Pose, stance: Stance) {
  const beats = party.beat * BPM / 60
  const frac = beats % 1
  const kick = Math.pow(1 - frac, 3)
  const even = Math.floor(beats) % 2 === 0
  switch (f.danceMove) {
    case 'bounce':
    case 'spin':
      P.hy += kick * 1.5
      P.armN = even ? 2.5 : 0.35
      P.armF = even ? 0.35 : 2.5
      P.head = kick * 0.15
      break
    case 'arms':
      P.armN = P.armF = 2.6 + Math.sin(beats * Math.PI) * 0.35
      P.body = Math.sin(beats * Math.PI) * 0.12
      P.head = P.body
      P.hy += kick
      break
    case 'sway':
      P.armN = 0.7 + Math.sin(beats * Math.PI) * 0.5
      P.armF = 0.7 - Math.sin(beats * Math.PI) * 0.5
      P.body = Math.sin(beats * Math.PI) * 0.15
      P.head = -P.body
      break
    case 'jump':
      P.armN = P.armF = f.jump < -2 ? 2.7 : 0.4
      break
    case 'crouch':
      if (stance === 'stand') P.armN = P.armF = 0.6
      break
  }
}

// ── Drawing ──────────────────────────────────────────────────

let scratch: [HTMLCanvasElement, CanvasRenderingContext2D] | null = null
const SW = 96, SH = 96, HX = 48, HY = 52

export function drawParty(ctx: CanvasRenderingContext2D, party: Party, now: number, px: number, py: number, light: PartyLight) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  ctx.imageSmoothingEnabled = false
  const offX = (Math.round(px * 10) - party.env.PAD) * 2
  const offY = Math.round((py + 1) * 2) * 2
  const pond = party.pond

  // The places: reeds and water, campfire, picnic, jukebox, buckets, graves
  drawPondBack(ctx, pond, offX, offY, light)
  drawReeds(ctx, pond, offX, offY, light)
  drawFire(ctx, party.fire, party.fire.x + offX, feetY(party, party.fire.x) + offY, now, light)
  if (party.picnic) drawPicnic(ctx, party.picnic, party.picnic.x + offX, feetY(party, party.picnic.x) + offY, light)
  if (party.jukebox) {
    const beats = party.beat * BPM / 60
    drawJukebox(ctx, party.jukebox, party.jukebox.x + offX, feetY(party, party.jukebox.x) + offY, light, beats % 1)
  }
  for (const f of party.figures) {
    if (f.bucket > 0 && f.spot?.fisher) drawBucket(ctx, f.spot.x - f.spot.dir * 9 + offX, feetY(party, f.spot.x - f.spot.dir * 9) + offY, f.bucket, light)
  }
  for (const g of party.graves) {
    const base = feetY(party, g.x) + offY
    drawCrack(ctx, g.x + offX, base, g.crack, party.t)
    const jolt = g.shake > 0 ? Math.round(Math.sin(party.t * 60)) : 0
    if (g.phase !== 'ko') drawGrave(ctx, g.x + offX + jolt, base, g.rise, g.phase === 'raise' || g.phase === 'depart' ? g.glow : 0, light)
    if (g.halo) {
      ctx.globalAlpha = Math.max(0, Math.min(1, 6 - g.halo.t))
      drawHalo(ctx, Math.round(g.halo.x) + offX, Math.round(g.halo.y) + offY)
      ctx.globalAlpha = 1
    }
  }

  // People: back to front by x, anyone in the air on top
  const order = [...party.figures].sort((a, b) => (a.rag ? 1 : 0) - (b.rag ? 1 : 0) || a.x - b.x)
  for (const f of order) {
    if (f.hidden) continue
    drawFigure(ctx, party, f, offX, offY, light)
  }
  for (const f of order) if (!f.hidden && f.fishing) drawLine(ctx, f, offX, offY, light)

  // The water's surface over anyone swimming, then the frog and lily pad
  drawPondFront(ctx, pond, offX, offY, light)

  const ch = party.chicken
  if (ch && !ch.held) drawChicken(ctx, party, ch, offX, offY, light)
  for (const fl of party.flyers) drawItem(ctx, fl.kind, Math.round(fl.x) + offX, Math.round(fl.y) + offY, Math.floor(fl.t * 10) % 2 ? 1 : -1, light)
  for (const b of party.butterflies) {
    const open = b.on ? Math.floor(b.t * 2) % 3 !== 0 : Math.floor(b.t * 10) % 2 === 0
    drawRows(ctx, open ? ['c.c', '.b.', 'c.c'] : ['.c.', '.b.', '.c.'], { c: lit(b.color, light), b: lit('#3a2a1a', light) },
      Math.round(b.x) - 1 + offX, Math.round(b.y) - 1 + offY)
  }

  // The angel and her light, and any imp
  for (const g of party.graves) {
    const a = g.angel
    drawBeam(ctx, g.x + offX, feetY(party, g.x) + offY, g.beam)
    if (a.state !== 'off') {
      const x = Math.round(a.x) + offX, y = Math.round(a.y) + offY
      // Flapping hard when held or tumbling, turning round in a twirl
      const flap = a.state === 'held' || a.state === 'flung' ? party.t * 2.5 : party.t
      const turn = a.twirl > 0 ? Math.cos((1 - a.twirl / 0.8) * Math.PI * 4) : 1
      ctx.save()
      if (a.spin || turn !== 1) {
        ctx.translate(x, y - 12)
        ctx.rotate(a.spin)
        ctx.scale(Math.abs(turn) < 0.2 ? 0.2 * Math.sign(turn || 1) : turn, 1)
        ctx.translate(-x, -(y - 12))
      }
      drawAngel(ctx, x, y, flap, a.state === 'fly' ? g.arms : a.state === 'held' ? 1 : 0, a.state === 'fly' ? g.alpha : 1, !g.halo)
      ctx.restore()
    }
    const im = g.imp
    if (im) {
      const ground = feetY(party, im.x) + offY
      ctx.save()
      if (im.sink > 0) {
        ctx.beginPath()
        ctx.rect(0, 0, ctx.canvas.width, (im.state === 'sizzle' ? (surfaceAt(party.pond, im.x) ?? ground) + offY : ground))
        ctx.clip()
      }
      const poking = im.state === 'poke' && im.t > 0.2 && im.t < 0.5 ? Math.sin(((im.t - 0.2) / 0.3) * Math.PI)
        : im.jab > 0 ? Math.sin((im.jab / 0.3) * Math.PI) : 0
      drawImp(ctx, Math.round(im.x) + offX, Math.round(im.y + im.sink * 15) + offY, party.t, {
        dir: im.dir, poke: poking, wave: im.state === 'bye' || im.state === 'cackle' || (im.state === 'chase' && im.rest > 0),
        kick: im.state === 'held' || im.state === 'flung', dizzy: im.state === 'dizzy',
      })
      ctx.restore()
    }
  }

  drawParticles(ctx, party, offX, offY, light)
}

/** Little devil horns, following the head's tilt */
function drawHorns(g: CanvasRenderingContext2D, j: Joints) {
  const ux = j.headTop.x - j.head.x, uy = j.headTop.y - j.head.y
  const len = Math.hypot(ux, uy) || 1
  const upX = ux / len, upY = uy / len
  // Outward along the top of the head (s) and up from it (u); each horn curls outwards
  const at = (side: number, s: number, u: number, color: string) => {
    g.fillStyle = color
    g.fillRect(Math.round(j.headTop.x - upY * s * side + upX * u), Math.round(j.headTop.y + upX * s * side + upY * u), 1, 1)
  }
  for (const side of [-1, 1]) {
    at(side, 2, 0, '#6a1a26'); at(side, 3, 0, '#6a1a26')
    at(side, 3, 1, '#a8323f'); at(side, 2, 1, '#8a2433')
    at(side, 4, 2, '#d0485a')
  }
}

/** A pointy tail from behind the hips, wagging */
function drawTail(g: CanvasRenderingContext2D, view: View, t: number) {
  const back = view.front ? 1 : -view.dir
  const wag = Math.round(Math.sin(t * 6))
  g.fillStyle = '#a3263a'
  const pts = [[1, 1], [2, 2], [3, 2], [4, 1 + wag], [5, 0 + wag]]
  for (const [dx, dy] of pts) g.fillRect(HX + back * dx, HY + dy, 1, 1)
  // Arrow tip
  g.fillRect(HX + back * 6, HY - 1 + wag, 1, 1)
  g.fillRect(HX + back * 5, HY - 1 + wag, 1, 1)
  g.fillRect(HX + back * 6, HY + wag, 1, 1)
  g.fillRect(HX + back * 6, HY - 2 + wag, 1, 1)
}

function drawFigure(ctx: CanvasRenderingContext2D, party: Party, f: Figure, offX: number, offY: number, light: PartyLight) {
  if (!scratch) scratch = makeCanvas(SW, SH)
  const [sc, g] = scratch
  g.setTransform(1, 0, 0, 1, 0, 0)
  g.globalCompositeOperation = 'source-over'
  g.globalAlpha = 1
  g.clearRect(0, 0, SW, SH)

  // Mid-turn: squash through the old view, then out into the new one
  const k = f.flip / FLIP
  const view: View = k > 0.5 ? f.from : { dir: f.dir, front: f.front }
  const scaleX = f.flip > 0 ? Math.max(0.25, k > 0.5 ? (k - 0.5) * 2 : (0.5 - k) * 2) : 1
  const s = f.skel
  const faceShown = view.front || f.faceCam
  if (f.devil > 0 && !f.rag) drawTail(g, view, party.t)
  const j = drawSkel(g, f.rig, s, view, HX, HY, {
    faceCam: f.faceCam && !view.front && f.want.stance !== 'lie' && f.mode === 'free',
    blink: faceShown && f.blink < 0,
    held: jj => drawHeld(g, f, jj, view, light),
  })

  if (f.devil > 0) drawHorns(g, j)

  // Light the figure like the rest of the scene, warmer near the fire
  const fire = party.fire
  const warm = light.night ? fire.a * Math.max(0, 1 - Math.abs(f.x - fire.x) / 60) : 0
  g.globalCompositeOperation = 'source-atop'
  const dark = 1 - Math.min(1, light.light + warm * 0.4)
  if (dark > 0.01) {
    g.fillStyle = `rgba(0,0,0,${dark.toFixed(3)})`
    g.fillRect(0, 0, SW, SH)
  }
  if (light.tintAmt > 0) {
    g.globalAlpha = light.tintAmt * (1 - warm * 0.7)
    g.fillStyle = light.tint
    g.fillRect(0, 0, SW, SH)
  }
  if (warm > 0) {
    g.globalAlpha = warm * 0.22
    g.fillStyle = '#ff9a3c'
    g.fillRect(0, 0, SW, SH)
  }
  if (f.devil > 0) {
    // A devilish flush, fading as it wears off
    g.globalAlpha = 0.16 * Math.min(1, f.devil / 2)
    g.fillStyle = '#ff2a2a'
    g.fillRect(0, 0, SW, SH)
  }
  if (f.red > 0) {
    // Minecraft's hurt flash
    g.globalAlpha = Math.min(0.55, f.red * 1.5)
    g.fillStyle = '#ff2020'
    g.fillRect(0, 0, SW, SH)
  }
  g.globalAlpha = 1
  g.globalCompositeOperation = 'source-over'

  const sx = Math.round(s.x) + offX
  const sy = Math.round(s.y) + offY
  const squash = f.squash
  const scaleY = 1 - squash * 0.14
  const wX = Math.round(SW * scaleX * (1 + squash * 0.08))
  const hY = Math.round(SH * scaleY)
  const feetInScratch = HY + 12
  const dx = sx - Math.round(HX * wX / SW)
  const dy = sy + 12 - Math.round(feetInScratch * hY / SH)

  ctx.save()
  if (f.mode === 'rising') {
    // Coming up out of the ground
    ctx.beginPath()
    ctx.rect(0, 0, ctx.canvas.width, feetY(party, f.x) + offY)
    ctx.clip()
    ctx.globalAlpha = 1 - f.rise * 0.55
  }
  ctx.drawImage(sc, dx, dy, wX, hY)
  ctx.restore()

  // Remember where the head and body are, for tags, bubbles and clicks
  const toW = (p: XY) => ({ x: p.x - HX + s.x, y: p.y - HY + s.y })
  f.head = toW(j.headTop)
  if (f.rag) {
    const xs = f.rag.pts.map(q => q.x), ys = f.rag.pts.map(q => q.y)
    f.box = { x0: Math.min(...xs) - 3, y0: Math.min(...ys) - 4, x1: Math.max(...xs) + 3, y1: Math.max(...ys) + 2 }
    f.head = { x: s.x, y: ragdollTop(f.rag) }
  } else {
    const pts = [j.headTop, j.neck, j.hip, j.handN, j.handF, j.footN, j.footF].map(toW)
    f.box = {
      x0: Math.min(...pts.map(p => p.x)) - 3, y0: Math.min(...pts.map(p => p.y)) - 1,
      x1: Math.max(...pts.map(p => p.x)) + 3, y1: Math.max(...pts.map(p => p.y)) + 1,
    }
  }
  if (f.fishing) {
    // Where the rod's tip is, for the line
    const tip = f.item?.kind === 'rod' ? rodTip(j, view) : null
    f.fishing.tip = tip ? toW(tip) : null
  }

  // Halo after coming back; dizzy stars after a hard landing
  if (f.halo > 0) {
    const a = Math.min(1, f.halo / 2)
    ctx.globalAlpha = a
    const hx = Math.round(f.head.x) + offX - 3, hy = Math.round(f.head.y - 4 + Math.sin(party.t * 3)) + offY
    drawRows(ctx, ['.####.', '#....#', '.####.'], { '#': '#ffd84a' }, hx, hy)
    ctx.globalAlpha = 1
  }
  if (f.dizzy > 0.4 && f.mode !== 'held') {
    for (let i = 0; i < 3; i++) {
      const a = party.t * 4 + (i * Math.PI * 2) / 3
      const x = Math.round(f.head.x + Math.cos(a) * 6) + offX
      const y = Math.round(f.head.y - 2 + Math.sin(a) * 1.5) + offY
      ctx.fillStyle = i === 0 ? '#fff3a8' : '#ffd84a'
      ctx.fillRect(x, y, 1, 1)
      if (Math.sin(a) > 0) { ctx.fillRect(x - 1, y, 3, 1); ctx.fillRect(x, y - 1, 1, 3) }
    }
  }
}

function rodTip(j: Joints, v: View): XY | null {
  if (v.front) return null
  const a = j.armN - v.dir * 1.4
  return { x: j.handN.x - Math.sin(a) * 13, y: j.handN.y + Math.cos(a) * 13 }
}

/** Whatever the player is holding, drawn in their hand */
function drawHeld(g: CanvasRenderingContext2D, f: Figure, j: Joints, v: View, light: PartyLight) {
  const it = f.item
  if (!it) return
  if (v.front) {
    // Held up high with both hands
    const x = Math.round((j.handN.x + j.handF.x) / 2)
    const y = Math.round(Math.min(j.handN.y, j.handF.y))
    drawItem(g, it.kind, x, y - 3, 1, light, it.color, false)
    return
  }
  const hx = Math.round(j.handN.x), hy = Math.round(j.handN.y)
  if (it.kind === 'rod') {
    const tip = rodTip(j, v)!
    pixelLine(g, hx, hy, Math.round(tip.x), Math.round(tip.y), '#7a5230')
    g.fillStyle = '#5a3a1e'
    g.fillRect(hx, hy, 1, 1)
    return
  }
  if (it.kind === 'stick') {
    const a = j.armN - v.dir * 0.5
    const tx = Math.round(hx - Math.sin(a) * 11), ty = Math.round(hy + Math.cos(a) * 11)
    pixelLine(g, hx, hy, tx, ty, '#8a5d34')
    const toast = it.toast ?? 0
    g.fillStyle = toast > 1.2 ? '#2a2220' : toast > 0.85 ? '#b07a42' : toast > 0.45 ? '#ecc98a' : '#fbf6ea'
    g.fillRect(tx - 1, ty - 1, 2, 2)
    if (it.burning) {
      g.fillStyle = Math.floor(f.t * 20) % 2 ? '#ffe066' : '#ff9a1f'
      g.fillRect(tx - 1, ty - 3, 1, 2)
      g.fillRect(tx, ty - 2, 1, 1)
    }
    return
  }
  drawItem(g, it.kind, hx + v.dir * 2, hy + 1, v.dir, light, it.color, true)
}

const ITEMS: Record<string, { rows: string[]; colors: Record<string, string> }> = {
  fish: { rows: ['.t.###.', 'tt####k', '.t.###.'], colors: { t: '#c26a1e', '#': '#e8842a', k: '#1d1d24' } },
  boot: { rows: ['.##..', '.##..', '.##..', '#####'], colors: { '#': '#6b4526' } },
  book: { rows: ['#####', '#ppp#', '#####'], colors: { '#': '#5b3b8a', p: '#d9b8ff' } },
  flower: { rows: ['.p.', 'pyp', '.p.', '.g.', '.g.'], colors: { y: '#ffd24a', g: '#4f8f3a' } },
  apple: { rows: ['.g.', 'rwr', 'rrr', '.r.'], colors: { g: '#4f8f3a', r: '#e0303a', w: '#ff8a8a' } },
  cookie: { rows: ['.bb.', 'bkbb', 'bbkb', '.bb.'], colors: { b: '#c98a4a', k: '#5a3418' } },
  cake: { rows: ['www', 'ppp', 'bbb'], colors: { w: '#fbf7f0', p: '#f2c0cf', b: '#b0703a' } },
  melon: { rows: ['rkr', 'rrr', 'ggg'], colors: { r: '#e0303a', k: '#1d1d24', g: '#4f8f3a' } },
  chicken: {
    rows: ['.....ww.', '....wwkw', '.w..wwyy', 'wwwwwwr.', 'wwwwwww.', '.wwwww..', '..y.y...', '..y.y...'],
    colors: { w: '#f4f1ea', r: '#d8342a', y: '#f2b233', k: '#1d1d24' },
  },
}

/** An item sprite, centred on (x, y) in hand or sitting on it when held up */
function drawItem(g: CanvasRenderingContext2D, kind: ItemKind, x: number, y: number, dir: 1 | -1, light: PartyLight, color?: string, inHand = true) {
  const def = ITEMS[kind]
  if (!def) return
  const colors: Record<string, string> = { ...def.colors }
  if (kind === 'flower') colors.p = color ?? '#e8342a'
  // Figures are lit as a whole afterwards; anything drawn straight onto the scene is lit here
  if (g.canvas !== scratch?.[0]) for (const k of Object.keys(colors)) colors[k] = lit(colors[k], light)
  const w = def.rows[0].length, h = def.rows.length
  drawRows(g, def.rows, colors, x - Math.floor(w / 2), inHand ? y - Math.floor(h / 2) : y - h + 1, dir < 0)
}

/** The fishing line and float, drawn after the figures so the water covers what's under it */
function drawLine(ctx: CanvasRenderingContext2D, f: Figure, offX: number, offY: number, light: PartyLight) {
  const fs = f.fishing!
  const b = fs.bob
  if (!b || !fs.tip) return
  const tx = Math.round(fs.tip.x) + offX, ty = Math.round(fs.tip.y) + offY
  const bx = Math.round(b.x) + offX, by = Math.round(b.y) + offY + Math.round(fs.dip)
  const line = lit('#e6e6f0', light, 0.6)
  if (fs.phase === 'wait') {
    // Slack, sagging a little
    let px = tx, py = ty
    for (let i = 1; i <= 12; i++) {
      const u = i / 12
      const x = Math.round(tx + (bx - tx) * u)
      const y = Math.round(ty + (by - 2 - ty) * u + Math.sin(u * Math.PI) * 4)
      pixelLine(ctx, px, py, x, y, line)
      px = x; py = y
    }
  } else {
    pixelLine(ctx, tx, ty, bx, by - 2, line)
  }
  ctx.fillStyle = lit('#e8342a', light)
  ctx.fillRect(bx, by - 2, 2, 1)
  ctx.fillStyle = lit('#f4f4f4', light)
  ctx.fillRect(bx, by - 1, 2, 1)
}

function drawChicken(ctx: CanvasRenderingContext2D, party: Party, ch: Chicken, offX: number, offY: number, light: PartyLight) {
  const def = ITEMS.chicken
  const rows = ch.flap > 0
    ? ['.....ww.', '....wwkw', 'ww..wwyy', 'wwwwwwr.', '.wwwwww.', '.wwwww..', '..y.y...', '........']
    : ch.rest > 0 || Math.floor(ch.t * 10) % 2 ? def.rows
      : ['.....ww.', '....wwkw', '.w..wwyy', 'wwwwwwr.', 'wwwwwww.', '.wwwww..', '...yy...', '..y..y..']
  const colors: Record<string, string> = {}
  for (const [k, v] of Object.entries(def.colors)) colors[k] = lit(v, light)
  drawRows(ctx, rows, colors, Math.round(ch.x) - 4 + offX, Math.round(feetY(party, ch.x) + ch.hop) - 8 + offY, ch.dir < 0)
}

function drawParticles(ctx: CanvasRenderingContext2D, party: Party, offX: number, offY: number, light: PartyLight) {
  for (const p of party.particles) {
    const a = Math.max(0, p.life / p.max)
    const x = Math.round(p.x) + offX
    const y = Math.round(p.y) + offY
    ctx.globalAlpha = Math.min(1, a * 1.6)
    switch (p.kind) {
      case 'smoke':
        ctx.fillStyle = `rgba(${p.color || '165,165,176'},${(a * 0.42).toFixed(3)})`
        ctx.globalAlpha = 1
        ctx.fillRect(x, y, 2, 2)
        break
      case 'heart':
        drawRows(ctx, ['.#.#.', '#####', '#####', '.###.', '..#..'], { '#': '#ff5fa8' }, x - 2, y)
        break
      case 'note':
        drawRows(ctx, ['.##', '.#.', '##.', '##.'], { '#': p.color }, x - 1, y + Math.round(Math.sin(p.life * 6) * 1))
        break
      case 'spark': {
        const big = Math.floor(p.life * 12) % 2 === 0
        ctx.fillStyle = p.color
        ctx.fillRect(x, y, 1, 1)
        if (big) { ctx.fillRect(x - 1, y, 3, 1); ctx.fillRect(x, y - 1, 1, 3) }
        break
      }
      case 'z':
        drawRows(ctx, ['###', '.#.', '###'], { '#': lit('#9aa8d8', light) }, x, y)
        break
      case 'drop':
        ctx.fillStyle = lit('#bfe0ff', light)
        ctx.fillRect(x, y, 1, 1)
        break
      default:
        ctx.fillStyle = p.color.startsWith('#') ? lit(p.color, light) : p.color
        ctx.fillRect(x, y, 1, 1)
    }
  }
  ctx.globalAlpha = 1
}

interface Label {
  f: Figure
  tag: HTMLCanvasElement | null
  bubble: { icon: Icon; age: number; life: number } | null
  /** Over the head, and the tag's bottom edge, in device pixels */
  cx: number
  bottom: number
  /** The tag with any bubble above it */
  w: number
  h: number
  /** How far it may be nudged aside, where it ends up, and which row */
  lim: number
  x: number
  row: number
  lift: number
}

/**
 * Name tags and speech bubbles, on their own full-resolution canvas: `scale` is its device
 * pixels per players-layer pixel, `unit` the device pixels per label art pixel.
 *
 * Tags that would overlap slide apart sideways into a row above the group; only people
 * nearly on top of each other get a second row, and never more than two.
 */
export function drawPartyLabels(ctx: CanvasRenderingContext2D, party: Party, px: number, py: number, scale: number, unit: number, dt: number) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  ctx.imageSmoothingEnabled = false
  const offX = (Math.round(px * 10) - party.env.PAD) * 2
  const offY = Math.round((py + 1) * 2) * 2
  const follow = 1 - Math.exp(-22 * dt), settle = dt === 0 ? 1 : 1 - Math.exp(-12 * dt)
  const gap = Math.round(2.5 * scale), pad = unit, gapX = unit * 2

  const labels: Label[] = []
  for (const f of party.figures) {
    const grave = f.hidden ? [...party.graves].reverse().find(g => g.f === f && g.phase !== 'depart' && g.phase !== 'gone') : null
    if (f.hidden && !grave) continue
    // Tags ease after the head so a tumbling player doesn't shake theirs about
    const hx = grave ? grave.x : f.mode === 'free' || f.mode === 'rising' ? f.skel.x : f.head.x
    // (clear of any devil horns)
    const hy = grave ? feetY(party, grave.x) - 11 * grave.rise : Math.min(f.head.y, f.skel.y - 18) - (f.devil > 0 ? 3 : 0)
    if (!f.tag.ready || dt === 0) { f.tag.x = hx; f.tag.y = hy; f.tag.ready = true }
    f.tag.x += (hx - f.tag.x) * follow
    f.tag.y += (hy - f.tag.y) * follow
    const tag = f.name ? nameTag(f.name, unit) : null
    const bubble = f.bubble && !f.hidden ? f.bubble : null
    if (!tag && !bubble) continue
    const sp = bubble ? speechSize(bubble.icon, unit) : null
    const w = Math.max(tag?.width ?? 0, sp?.w ?? 0)
    const cx = (f.tag.x + offX) * scale
    labels.push({
      f, tag, bubble, cx, bottom: (f.tag.y + offY) * scale - gap,
      w, h: (tag?.height ?? 0) + (sp ? sp.h + unit : 0),
      lim: w * 0.75 + unit * 4, x: cx + f.tag.dx, row: 0, lift: 0,
    })
  }
  labels.sort((a, b) => a.cx - b.cx)

  const top = (l: Label) => l.bottom - l.lift - l.h
  const sameLine = (a: Label, b: Label) => top(a) < b.bottom - b.lift + pad && top(b) < a.bottom - a.lift + pad
  // Labels that were up a row need a little more room to come back down, so they don't flick
  const room = (a: Label, b: Label) => (a.w + b.w) / 2 + gapX + (a.f.tag.row || b.f.tag.row ? unit * 3 : 0)
  const spread = (ls: Label[]) => {
    for (let it = 0; it < 10; it++) {
      for (const l of ls) l.x += (l.cx - l.x) * 0.3
      for (let i = 0; i < ls.length; i++) {
        for (let j = i + 1; j < ls.length; j++) {
          const a = ls[i], b = ls[j]
          if (!sameLine(a, b)) continue
          const d = room(a, b) - (b.x - a.x)
          if (d > 0) { a.x -= d / 2; b.x += d / 2 }
        }
      }
      for (const l of ls) l.x = clamp(l.x, l.cx - l.lim, l.cx + l.lim)
    }
  }
  const crowded = (ls: Label[]) => {
    for (let i = 0; i < ls.length; i++) {
      for (let j = i + 1; j < ls.length; j++) {
        const a = ls[i], b = ls[j]
        if (sameLine(a, b) && room(a, b) - (b.x - a.x) > 1) return [a, b]
      }
    }
    return null
  }

  // Everyone on the first row, as spread out as they can be without straying from their heads;
  // where that still leaves an overlap, one of the pair goes up a row (whoever was up already,
  // or else whoever joined later, so the choice doesn't flip as they move about)
  const order = (l: Label) => party.figures.indexOf(l.f)
  // A tag that has just gone up stays up for a moment, and one that has just come down
  // is the last to go back up, so people running past each other don't set them bobbing
  for (const l of labels) if (l.f.tag.row === 1 && l.f.tag.hold > 0) l.row = 1
  let row0 = labels.filter(l => l.row === 0)
  for (let n = 0; n < labels.length; n++) {
    spread(row0)
    const pair = crowded(row0)
    if (!pair) break
    const [a, b] = pair
    const up =
      a.f.tag.row !== b.f.tag.row ? (a.f.tag.row ? a : b)
      : (a.f.tag.hold > 0) !== (b.f.tag.hold > 0) ? (a.f.tag.hold > 0 ? b : a)
      : order(a) > order(b) ? a : b
    up.row = 1
    row0 = row0.filter(l => l !== up)
  }
  const row1 = labels.filter(l => l.row === 1)
  if (row1.length) {
    // Up here there's more room to spread out, so a crowd's second row doesn't overlap
    for (const l of row1) l.lim *= 1.8
    spread(row1)
    for (const l of row1) {
      // Just clear of whatever is below it
      let lift = 0
      for (const r of row0) {
        if (Math.abs(l.x - r.x) < (l.w + r.w) / 2 + gapX && sameLine(l, r)) lift = Math.max(lift, l.bottom - (r.bottom - r.h - pad))
      }
      l.lift = lift
    }
  }

  const speech: { icon: Icon; x: number; y: number; age: number; life: number }[] = []
  for (const l of [...row0, ...row1]) {
    const f = l.f
    f.tag.hold = l.row !== f.tag.row ? 0.8 : Math.max(0, f.tag.hold - dt)
    f.tag.row = l.row
    f.tag.dx += (l.x - l.cx - f.tag.dx) * settle
    f.tag.lift += (l.lift - f.tag.lift) * settle
    const x = Math.round(l.cx + f.tag.dx)
    let y = Math.round(l.bottom - f.tag.lift)
    if (l.tag) {
      y -= l.tag.height
      ctx.globalAlpha = f.mode === 'rising' ? 1 - f.rise * 0.6 : 1
      ctx.drawImage(l.tag, x - Math.floor(l.tag.width / 2), y)
      ctx.globalAlpha = 1
    }
    // Bubbles float just above the tag, pointing down at it, and go on top of every tag
    if (l.bubble) speech.push({ icon: l.bubble.icon, x, y: y - unit, age: l.bubble.age, life: l.bubble.life })
  }
  for (const g of party.graves) {
    const tk = g.talk
    if (!tk) continue
    const at = tk.who === 'angel' ? { x: g.angel.x, y: g.angel.y - 29 } : g.imp ? { x: g.imp.x, y: g.imp.y - 16 } : null
    if (!at || (tk.who === 'angel' && g.angel.state === 'off')) continue
    speech.push({ icon: tk.icon, x: Math.round((at.x + offX) * scale), y: Math.round((at.y + offY) * scale), age: tk.age, life: tk.life })
  }
  for (const b of speech) drawSpeech(ctx, b.icon, b.x, b.y, unit, b.age, b.life)
}

/** A crisp one-pixel line (Bresenham), since stroked paths come out anti-aliased */
function pixelLine(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, color: string) {
  g.fillStyle = color
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0)
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1
  let err = dx + dy
  for (let n = 0; n < 400; n++) {
    g.fillRect(x0, y0, 1, 1)
    if (x0 === x1 && y0 === y1) return
    const e2 = 2 * err
    if (e2 >= dy) { err += dy; x0 += sx }
    if (e2 <= dx) { err += dx; y0 += sy }
  }
}
