// Soak test for the people in the Play screen: runs a copy of the party at full speed while
// poking it at random (clicks, grabs, throws, deaths, the angel and the imp, players joining
// and leaving, the time of day changing, frame hitches), checking after every frame that
// nobody ends up stuck, lost, invisible or NaN.
//
// In the UI preview's console (npm run preview:ui, ?srv=busy):
//   const r = await (await import('/tools/ui-preview/party-soak.js')).soak(600); r
// `seconds` is simulated time. The report lists how often each thing was done and every rule
// that broke, with the first time it happened.

const rand = (a, b) => a + Math.random() * (b - a)
const pick = xs => xs[Math.floor(Math.random() * xs.length)]

export async function soak(seconds = 300, { seed = window.__party } = {}) {
  const m = await import('/src/components/scenePlayers.ts')
  if (!seed) throw new Error('Open the Play screen first (it provides the landscape)')
  const players = seed.figures.map(f => ({ name: f.name, skin: f.skin, slim: false }))
  const light = { ...seed.light }
  const party = m.createParty(seed.env, light)
  m.syncParty(party, players)

  const scene = Object.assign(document.createElement('canvas'), { width: seed.env.W * 2, height: 320 })
  const labels = Object.assign(document.createElement('canvas'), { width: seed.env.W * 5, height: 800 })
  const sctx = scene.getContext('2d'), lctx = labels.getContext('2d')

  const done = {}, broken = new Map()
  const did = what => { done[what] = (done[what] ?? 0) + 1 }
  const fail = (rule, detail) => {
    const b = broken.get(rule)
    if (b) b.count++
    else broken.set(rule, { count: 1, first: `t=${party.t.toFixed(1)}s ${detail}` })
  }

  // Scene pixels for a world point (what the pointer handlers expect)
  const toScene = (x, y) => ({ x: (x + party.offX) / 2, y: (y + party.offY) / 2 })
  let cursor = null
  const script = []   // queued pointer moves: { dt, x, y } in scene pixels, then release
  const online = new Set(players.map(p => p.name))

  const since = new Map()   // how long each thing has been going on, to catch the stuck ones
  const age = (key, going, dt) => {
    if (!going) { since.delete(key); return 0 }
    const t = (since.get(key) ?? 0) + dt
    since.set(key, t)
    return t
  }

  const act = () => {
    const figs = party.figures.filter(f => !f.hidden && !f.leaving)
    const r = Math.random()
    if (r < 0.2 && figs.length) {
      // Click someone
      const f = pick(figs)
      const at = toScene((f.box.x0 + f.box.x1) / 2, (f.box.y0 + f.box.y1) / 2)
      if (m.pressParty(party, at, 0, 0)) { cursor = at; script.push({ dt: 0.05, ...at }, { release: true }); did('click person') }
    } else if (r < 0.42 && figs.length) {
      // Grab someone, carry them about, throw them (sometimes hard enough to hurt)
      const f = pick(figs)
      if (Math.random() < 0.3) f.hurt = Math.max(f.hurt, 2.7)
      const at = toScene((f.box.x0 + f.box.x1) / 2, (f.box.y0 + f.box.y1) / 2)
      if (m.pressParty(party, at, 0, 0)) {
        cursor = at
        let x = at.x, y = at.y
        const n = Math.round(rand(10, 60))
        for (let i = 0; i < n; i++) { x += rand(-1.5, 1.5); y += rand(-1.8, 0.8); script.push({ dt: 1 / 60, x, y }) }
        const vx = rand(-9, 9), vy = rand(-7, 7)
        for (let i = 0; i < 4; i++) { x += vx; y += vy; script.push({ dt: 1 / 60, x, y }) }
        script.push({ release: true })
        did('grab and throw')
      }
    } else if (r < 0.55) {
      // The angel or the imp, if about: click, carry, fling
      const g = pick(party.graves.filter(g => g.imp || g.angel.state !== 'off'))
      if (!g) return
      const who = g.imp && Math.random() < 0.6 ? g.imp : g.angel
      const at = toScene(who.x, who.y - (who === g.imp ? 8 : 14))
      if (!m.pressParty(party, at, 0, 0)) return
      cursor = at
      if (Math.random() < 0.4) { script.push({ dt: 0.05, ...at }, { release: true }); did(who === g.imp ? 'bonk imp' : 'click angel'); return }
      let x = at.x, y = at.y
      for (let i = 0; i < 30; i++) { x += rand(-1, 1.5); y += rand(-1, 0.5); script.push({ dt: 1 / 60, x, y }) }
      const hard = Math.random() < 0.6
      for (let i = 0; i < 4; i++) { x += hard ? 7 : 0.5; y += hard ? -3 : 0.3; script.push({ dt: 1 / 60, x, y }) }
      script.push({ release: true })
      did(who === g.imp ? (hard ? 'throw imp' : 'move imp') : (hard ? 'fling angel' : 'carry angel'))
    } else if (r < 0.63) {
      // Someone logs off, or back on
      const off = players.filter(p => !online.has(p.name))
      if (off.length && (Math.random() < 0.5 || online.size < 2)) { online.add(pick(off).name); did('log on') }
      else if (online.size) { online.delete(pick([...online])); did('log off') }
      m.syncParty(party, players.filter(p => online.has(p.name)))
    } else if (r < 0.7 && party.groups.length) {
      pick(party.groups).timer = 0
      did('group moves on')
    } else if (r < 0.73) {
      party.timer = 0
      did('everyone regroups')
    } else if (r < 0.76) {
      m.retargetParty(party, party.env, { ...light, time: pick(['night', 'dusk', 'dawn', 'day']) })
      did('time of day changes')
    }
  }

  let next = 1, t = 0
  const frames = Math.round(seconds * 60)
  for (let i = 0; i < frames; i++) {
    // Now and then a hitch, as when the window was busy
    const dt = Math.random() < 0.01 ? 0.1 : 1 / 60
    t += dt
    if (script.length) {
      const s = script.shift()
      if (s.release) { m.releaseParty(party); cursor = null } else cursor = { x: s.x, y: s.y }
    } else if (t > next) {
      next = t + rand(0.3, 2)
      act()
    }
    try {
      m.stepParty(party, dt, cursor, 0, 0)
      m.drawParty(sctx, party, t * 1000, 0, 0, party.light)
      m.drawPartyLabels(lctx, party, 0, 0, 2.5, 2, dt)
    } catch (e) {
      fail('exception', String(e.stack ?? e).split('\n').slice(0, 3).join(' | '))
    }
    check(party, dt, fail, age, online)
    if (i % 600 === 599) await new Promise(r => setTimeout(r, 0))
  }
  if (cursor) m.releaseParty(party)
  return {
    simulated: `${seconds}s`, people: party.figures.length, groups: party.groups.map(g => `${g.activity}×${party.figures.filter(f => f.group === g).length}`),
    done, broken: Object.fromEntries(broken),
  }
}

const ok = v => typeof v === 'number' && Number.isFinite(v)
const graveAges = new WeakMap()

function check(party, dt, fail, age, online) {
  const graveOf = f => party.graves.find(g => g.f === f)
  for (const f of party.figures) {
    const n = f.name
    for (const [k, v] of Object.entries({ x: f.x, ...f.skel, tagX: f.tag.x, tagY: f.tag.y, dx: f.tag.dx, lift: f.tag.lift })) {
      if (!ok(v)) { fail('number is NaN or infinite', `${n}.${k}`); break }
    }
    const g = graveOf(f)
    if (f.hidden && (f.mode !== 'dead' || !g || g.phase === 'depart' || g.phase === 'gone')) fail('hidden without a grave', `${n} ${f.mode} ${g?.phase}`)
    if (f.mode === 'dead' && !g) fail('dead without a grave', n)
    if (f.mode === 'rising' && g?.phase !== 'depart') fail('rising without the angel', `${n} ${g?.phase}`)
    if (f.mode === 'held' && party.press?.f !== f) fail('held with nobody holding', n)
    if (f.react?.kind === 'mourn' && !graveOf(f.react.of)) fail('mourning a grave that is gone', n)
    if (f.pair && (f.pair.a.pair !== f.pair || f.pair.b.pair !== f.pair) && age(`pair ${n}`, true, dt) > 1) fail('one-sided pair', n)
    else if (!f.pair) age(`pair ${n}`, false, dt)
    if (!f.leaving && f.mode === 'free' && !f.hidden && !party.groups.includes(f.group)) fail('free but in no group', n)
    // Anything going on for far too long
    if (age(`busy ${n}`, f.mode !== 'free' && f.mode !== 'dead', dt) > 25) fail('stuck out of free mode', `${n} ${f.mode}`)
    if (age(`dead ${n}`, f.mode === 'dead', dt) > 60) fail('dead for over a minute', n)
    if (age(`react ${n}`, !!f.react && f.react.kind !== 'mourn', dt) > 30) fail('reacting for over 30s', `${n} ${f.react?.kind}`)
    if (age(`leave ${n}`, f.leaving, dt) > 45) fail('still here 45s after leaving', `${n} ${f.mode} x=${f.x.toFixed(0)}`)
    if (age(`fleeing ${n}`, f.react?.kind === 'flee', dt) > 25) fail('fleeing for over 25s', n)
    if (!f.leaving && !online.has(n)) fail('on screen but not online', n)
  }
  for (const n of online) if (!party.figures.some(f => f.name === n && !f.leaving)) fail('online but not on screen', n)
  for (const g of party.graves) {
    if (!party.figures.includes(g.f)) fail('grave for someone not here', `${g.f.name} ${g.phase}`)
    // A grave can go round the angel and the imp more than once, but it must keep moving along
    const sig = `${g.phase} ${g.angel.state} ${g.imp?.state}`
    const was = graveAges.get(g)
    const still = was && was.sig === sig ? was.still + dt : 0
    graveAges.set(g, { sig, still })
    if (still > 30) fail('grave stuck for 30s', `${g.f.name} ${sig}`)
    for (const v of [g.x, g.angel.x, g.angel.y, g.imp?.x ?? 0, g.imp?.y ?? 0]) if (!ok(v)) fail('number is NaN or infinite', `grave of ${g.f.name}`)
  }
  const sites = {}
  for (const g of party.groups) {
    if (!party.figures.some(f => f.group === g && !f.leaving)) fail('empty group kept', g.activity)
    const site = { campfire: 'fire', fishing: 'pond', sunset: 'hill', picnic: 'meadow', dance: 'meadow', stargaze: 'meadow', chase: 'chicken', tag: 'tag' }[g.activity]
    if (site && sites[site]) fail('two groups in one place', `${sites[site]} and ${g.activity}`)
    if (site) sites[site] = g.activity
    if (g.it && g.it.group !== g && g.activity === 'tag' && age(`it ${party.groups.indexOf(g)}`, true, dt) > 1) fail('tag: it is not in the game', g.it.name)
  }
  const ch = party.chicken
  if (ch?.held && (ch.held.mode !== 'free' || ch.held.hidden || !party.figures.includes(ch.held))) fail('chicken held by someone who cannot', ch.held.name)
  if (party.press && !party.figures.includes(party.press.f)) fail('pressing someone who left', party.press.f.name)
  if (party.spirit && !party.graves.includes(party.spirit.g)) fail('pressing an angel or imp that is gone', '')
  if (party.particles.length > 3000) fail('too many particles', String(party.particles.length))
}
