// ============================================================
// SkinViewer3D.tsx — Rotatable 3D player preview (skinview3d).
// Drag to turn, scroll to zoom, double-click to reset the view.
// three.js is heavy, so the library loads on first use.
// ============================================================

import { useEffect, useRef, useState } from 'react'
import type { SkinViewer } from 'skinview3d'
import type { SkinModel } from '../lib/skin'
import { plainElytra } from '../lib/defaultSkin'
import { device } from '../lib/platform'
import { Spinner } from './ui'

type Lib = typeof import('skinview3d')
let lib: Promise<Lib> | null = null
const loadLib = () => (lib ??= import('skinview3d'))

export type SkinAnimation = 'still' | 'idle' | 'walk' | 'run' | 'fly' | 'wave' | 'crouch'
export type BackShown = 'cape' | 'elytra' | 'none'

/** Which parts of the skin's outer layer are shown, as in Minecraft's Skin Customization */
export interface SkinParts {
  cape: boolean
  jacket: boolean
  left_sleeve: boolean
  right_sleeve: boolean
  left_pants_leg: boolean
  right_pants_leg: boolean
  hat: boolean
}

type Source = HTMLImageElement | HTMLCanvasElement

interface Props {
  skin: Source
  model: SkinModel
  cape: Source | null
  /** Custom elytra texture; without one the elytra uses the cape, like in game */
  elytra: Source | null
  back: BackShown
  animation: SkinAnimation
  parts: SkinParts
  /** Viewer-only switch for the whole outer layer */
  outerLayer: boolean
  nameTag: string | null
  /** Waving uses the main hand */
  mainHand: 'left' | 'right'
  autoRotate: boolean
  /** Change to put the camera back where it started */
  resetKey: number
  /** Show the drag/zoom hint until the first interaction */
  hint?: boolean
}

function makeAnimation(L: Lib, name: SkinAnimation, hand: 'left' | 'right') {
  switch (name) {
    case 'idle': return new L.IdleAnimation()
    case 'walk': return new L.WalkingAnimation()
    case 'run': return new L.RunningAnimation()
    case 'fly': return new L.FlyingAnimation()
    case 'wave': return new L.WaveAnimation(hand)
    case 'crouch': return new L.CrouchAnimation()
    default: return null
  }
}

export function SkinViewer3D(props: Props) {
  const { skin, model, cape, elytra, back, animation, parts, outerLayer, nameTag, mainHand, autoRotate, resetKey, hint = true } = props
  const boxRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const viewerRef = useRef<SkinViewer | null>(null)
  const libRef = useRef<Lib | null>(null)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const [touched, setTouched] = useState(false)

  // Create once, dispose on unmount
  useEffect(() => {
    let disposed = false
    let observer: ResizeObserver | null = null
    loadLib().then(L => {
      const box = boxRef.current
      const canvas = canvasRef.current
      if (disposed || !box || !canvas) return
      const viewer = new L.SkinViewer({
        canvas,
        width: box.clientWidth,
        height: box.clientHeight,
        fov: 40,
        zoom: 0.74,
      })
      viewer.controls.enablePan = false
      viewer.controls.minDistance = 22
      viewer.controls.maxDistance = 90
      viewer.autoRotateSpeed = 0.7
      libRef.current = L
      viewerRef.current = viewer
      observer = new ResizeObserver(() => {
        if (box.clientWidth && box.clientHeight) viewer.setSize(box.clientWidth, box.clientHeight)
      })
      observer.observe(box)
      setReady(true)
    }).catch(() => setFailed(true))
    return () => {
      disposed = true
      observer?.disconnect()
      viewerRef.current?.dispose()
      viewerRef.current = null
    }
  }, [])

  useEffect(() => {
    viewerRef.current?.loadSkin(skin, { model })
  }, [ready, skin, model])

  useEffect(() => {
    const v = viewerRef.current
    if (!v) return
    // Vanilla rules: the cape part toggle hides the cape; elytra falls back to the cape, then plain wings
    const texture =
      back === 'cape' ? (parts.cape ? cape : null)
      : back === 'elytra' ? (elytra ?? (parts.cape ? cape : null) ?? plainElytra())
      : null
    if (texture) v.loadCape(texture, { backEquipment: back === 'elytra' ? 'elytra' : 'cape' })
    else v.loadCape(null)
  }, [ready, back, cape, elytra, parts.cape])

  useEffect(() => {
    const v = viewerRef.current
    if (!v) return
    const s = v.playerObject.skin
    s.head.outerLayer.visible = outerLayer && parts.hat
    s.body.outerLayer.visible = outerLayer && parts.jacket
    s.leftArm.outerLayer.visible = outerLayer && parts.left_sleeve
    s.rightArm.outerLayer.visible = outerLayer && parts.right_sleeve
    s.leftLeg.outerLayer.visible = outerLayer && parts.left_pants_leg
    s.rightLeg.outerLayer.visible = outerLayer && parts.right_pants_leg
  }, [ready, outerLayer, parts])

  useEffect(() => {
    const v = viewerRef.current, L = libRef.current
    if (v && L) v.animation = makeAnimation(L, animation, mainHand)
  }, [ready, animation, mainHand])

  useEffect(() => {
    const v = viewerRef.current, L = libRef.current
    if (!v || !L) return
    v.nameTag = nameTag ? new L.NameTagObject(nameTag, { font: "bold 38px Manrope, 'Segoe UI', sans-serif" }) : null
  }, [ready, nameTag])

  useEffect(() => {
    if (viewerRef.current) viewerRef.current.autoRotate = autoRotate
  }, [ready, autoRotate])

  useEffect(() => {
    const v = viewerRef.current
    if (!v || !resetKey) return
    v.resetCameraPose()
    v.playerWrapper.rotation.y = 0
  }, [resetKey])

  const reset = () => {
    const v = viewerRef.current
    if (!v) return
    v.resetCameraPose()
    v.playerWrapper.rotation.y = 0
  }

  return (
    <div
      ref={boxRef}
      className="viewer3d"
      onPointerDown={() => setTouched(true)}
      onWheel={() => setTouched(true)}
      onDoubleClick={reset}
    >
      <canvas ref={canvasRef} aria-label="3D preview of your player. Drag to rotate, scroll to zoom." />
      {!ready && !failed && <div className="viewer3d-status"><Spinner size={18} /></div>}
      {failed && <div className="viewer3d-status">3D preview isn't available on this {device}.</div>}
      {ready && hint && !touched && <div className="viewer3d-hint">Drag to rotate · scroll to zoom</div>}
    </div>
  )
}
