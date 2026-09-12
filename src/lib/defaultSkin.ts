// ============================================================
// defaultSkin.ts — Stand-in textures for the 3D preview when a
// player hasn't uploaded their own. The skin continues the
// generated head every name gets; the elytra is plain grey wings.
// ============================================================

import { generatedFace } from '../components/PlayerHead'

const SHIRTS = ['#3aa7a3', '#5b6ee1', '#d95763', '#8f5bd6', '#4f9a44', '#d9a13a', '#3b4a6b', '#c0567f']
const PANTS = ['#2f3a66', '#3b2f2a', '#28313b', '#4a3a6e', '#2c4f3a']

const cache = new Map<string, HTMLCanvasElement>()

/** A full 64×64 skin that matches the generated head for this name */
export function generatedSkin(name: string): HTMLCanvasElement {
  const key = name.toLowerCase()
  const hit = cache.get(key)
  if (hit) return hit

  const { hash, skin, hair, style, colors, shade } = generatedFace(name)
  const shirt = SHIRTS[(hash >>> 17) % SHIRTS.length]
  const pants = PANTS[(hash >>> 21) % PANTS.length]
  const shoes = shade(pants, -0.45)

  const c = document.createElement('canvas')
  c.width = 64
  c.height = 64
  const g = c.getContext('2d')!
  const rect = (x: number, y: number, w: number, h: number, color: string) => {
    g.fillStyle = color
    g.fillRect(x, y, w, h)
  }

  // Head: skin all round, hair on top, the back and the top rows of each side
  rect(0, 0, 32, 16, skin)
  rect(8, 0, 8, 8, hair)
  rect(0, 8, 32, 2, hair)
  rect(24, 8, 8, 7, hair)
  style.forEach((row, y) => {
    for (let x = 0; x < 8; x++) rect(8 + x, 8 + y, 1, 1, colors[row[x] ?? 's'] ?? skin)
  })

  // Body
  rect(16, 16, 24, 16, shirt)
  rect(20, 20, 8, 1, shade(shirt, -0.15))

  // Arms: short sleeves, then skin. [x, y] of each arm's texture block
  for (const [ax, ay] of [[40, 16], [32, 48]]) {
    rect(ax, ay, 16, 16, skin)
    rect(ax + 4, ay, 4, 4, shirt)
    rect(ax, ay + 4, 16, 4, shirt)
  }

  // Legs: trousers and shoes
  for (const [lx, ly] of [[0, 16], [16, 48]]) {
    rect(lx, ly, 16, 16, pants)
    rect(lx, ly + 14, 16, 2, shoes)
    rect(lx + 8, ly, 4, 4, shoes)
  }

  cache.set(key, c)
  return c
}

let elytra: HTMLCanvasElement | null = null

/** Plain grey wings, standing in for the vanilla elytra */
export function plainElytra(): HTMLCanvasElement {
  if (elytra) return elytra
  const c = document.createElement('canvas')
  c.width = 64
  c.height = 32
  const g = c.getContext('2d')!
  // The wing's texture block starts at (22, 0) and is 24×22
  g.fillStyle = '#8f95a3'
  g.fillRect(22, 0, 24, 22)
  g.fillStyle = '#a9afbc'
  for (let x = 22; x < 46; x += 3) g.fillRect(x, 2, 1, 20)
  g.fillStyle = '#6f7482'
  g.fillRect(22, 20, 24, 2)
  elytra = c
  return c
}
