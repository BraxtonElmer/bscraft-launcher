import { useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import {
  fetchTextureBytes, textureFromBytes,
  type Look, type Skin, type SkinModel, type Texture, type TextureDraft, type TextureKind,
} from '../../lib/skin'
import { invalidateLook, usePublishedLook } from '../../hooks/useSkin'
import type { ImportedLook, TextureUploadResult } from '../../types'

/** An unsaved change to one texture */
export type Change<T extends Texture> = { op: 'set'; bytes: Uint8Array; texture: T } | { op: 'remove' }

/** Skin and cape; the elytra's design is part of the cape texture (see capeWithWings) */
export type WardrobeKind = Exclude<TextureKind, 'elytra'>

export interface Drafts {
  skin?: Change<Skin>
  cape?: Change<Texture>
  /** New arm style for the already published skin */
  model?: SkinModel
}

export const KINDS: WardrobeKind[] = ['skin', 'cape']

function applied<T extends Texture>(change: Change<T> | undefined, published: T | null): T | null {
  if (!change) return published
  return change.op === 'set' ? change.texture : null
}

/**
 * The player's skin, cape and elytra: what's published, plus changes that
 * are previewed but not saved yet. Saving uploads each change in turn.
 */
export function useWardrobe(username: string) {
  const { look: published, loading } = usePublishedLook(username)
  const [drafts, setDrafts] = useState<Drafts>({})
  const [saving, setSaving] = useState(false)

  // Object URLs behind draft previews, released when the page closes
  const urls = useRef(new Set<string>())
  const track = (d: TextureDraft) => { urls.current.add(d.texture.src); return d }
  useEffect(() => () => { urls.current.forEach(u => URL.revokeObjectURL(u)) }, [])

  // Drafts belong to the name they were made for
  useEffect(() => { setDrafts({}) }, [username])

  // Minecraft ignores separate elytra textures, so the preview never shows one either
  const current: Look = {
    skin: applied(drafts.skin, published.skin),
    cape: applied(drafts.cape, published.cape),
    elytra: null,
  }
  const model: SkinModel = drafts.model ?? current.skin?.model ?? 'default'

  const changes: string[] = []
  if (drafts.skin) changes.push(drafts.skin.op === 'set' ? 'new skin' : 'skin removed')
  else if (drafts.model) changes.push('arm style')
  if (drafts.cape) changes.push(drafts.cape.op === 'set' ? 'new cape' : 'cape removed')

  const setTexture = (kind: WardrobeKind, draft: TextureDraft) => {
    track(draft)
    setDrafts(d => {
      const next: Drafts = { ...d, [kind]: { op: 'set', bytes: draft.bytes, texture: draft.texture } }
      if (kind === 'skin') delete next.model // a new skin brings its own detected arm style
      return next
    })
  }

  /** Marks a published texture for removal, or drops an unsaved one */
  const removeTexture = (kind: WardrobeKind) => {
    setDrafts(d => {
      const next: Drafts = { ...d }
      if (published[kind]) next[kind] = { op: 'remove' }
      else delete next[kind]
      if (kind === 'skin') delete next.model
      return next
    })
  }

  const revert = (kind: WardrobeKind) => {
    setDrafts(d => {
      const next: Drafts = { ...d }
      delete next[kind]
      if (kind === 'skin') delete next.model
      return next
    })
  }

  const setModel = (m: SkinModel) => {
    setDrafts(d => {
      const next: Drafts = { ...d }
      if (d.skin?.op === 'set') {
        next.skin = { ...d.skin, texture: { ...d.skin.texture, model: m } }
      } else if (m === (published.skin?.model ?? 'default')) {
        delete next.model
      } else {
        next.model = m
      }
      return next
    })
  }

  const discard = () => setDrafts({})

  /** Copies another player's textures in as drafts. Returns what was found. */
  const importFrom = async (name: string) => {
    const look = await invoke<ImportedLook>('import_look', { name })
    const load = async (kind: TextureKind, png: number[] | null) =>
      png ? track(await textureFromBytes(new Uint8Array(png), kind)) : null
    const [skin, cape] = await Promise.all([load('skin', look.skin), load('cape', look.cape)])
    if (skin) (skin.texture as Skin).model = look.model
    setDrafts(d => {
      const next: Drafts = { ...d }
      if (skin) { next.skin = { op: 'set', bytes: skin.bytes, texture: skin.texture as Skin }; delete next.model }
      if (cape) next.cape = { op: 'set', bytes: cape.bytes, texture: cape.texture }
      return next
    })
    const got = (['skin', 'cape'] as const).filter(k => ({ skin, cape })[k])
    return { name: look.name, source: look.source, got }
  }

  /** Uploads every change. Whatever fails stays as a draft and the error is thrown. */
  const save = async () => {
    const remaining: Drafts = { ...drafts }
    let error: unknown = null
    setSaving(true)
    try {
      for (const kind of KINDS) {
        const change = drafts[kind]
        if (!change) continue
        if (change.op === 'set') {
          await invoke<TextureUploadResult>('upload_texture', {
            username, kind, model: kind === 'skin' ? model : null, png: Array.from(change.bytes),
          })
        } else {
          await invoke('remove_texture', { username, kind })
        }
        delete remaining[kind]
        if (kind === 'skin') delete remaining.model
      }
      if (remaining.model && published.skin) {
        // Same picture, different arms: upload the published skin again with the new model
        const png = await fetchTextureBytes(published.skin.src)
        await invoke('upload_texture', { username, kind: 'skin', model: remaining.model, png: Array.from(png) })
        delete remaining.model
      }
    } catch (e) {
      error = e
    }
    await invalidateLook(username)
    setDrafts(remaining)
    setSaving(false)
    if (error) throw error
  }

  return {
    published, loading, drafts, current, model, changes, saving,
    setTexture, removeTexture, revert, setModel, discard, importFrom, save,
  }
}

export type WardrobeApi = ReturnType<typeof useWardrobe>
