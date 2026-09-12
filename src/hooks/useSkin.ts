import { useEffect, useState } from 'react'
import { fetchPublishedSkin, type Skin } from '../lib/skin'

// Shared across pages so a new upload in Profile shows up on the Play dock too
const cache = new Map<string, Skin | null>()
const pending = new Map<string, Promise<Skin | null>>()
const listeners = new Set<() => void>()

function load(name: string): Promise<Skin | null> {
  const key = name.toLowerCase()
  let p = pending.get(key)
  if (!p) {
    p = fetchPublishedSkin(name)
      .catch(() => null) // offline or server hiccup: fall back to the generated head
      .then(skin => {
        cache.set(key, skin)
        pending.delete(key)
        listeners.forEach(fn => fn())
        return skin
      })
    pending.set(key, p)
  }
  return p
}

/** Refetches a player's skin after it changed (upload or reset) */
export function invalidateSkin(name: string): Promise<Skin | null> {
  cache.delete(name.toLowerCase())
  return load(name)
}

/** The skin published for this username, or null for the default. Debounced while typing. */
export function usePublishedSkin(username: string): { skin: Skin | null; loading: boolean } {
  const key = username.toLowerCase()
  const [, force] = useState(0)

  useEffect(() => {
    const fn = () => force(n => n + 1)
    listeners.add(fn)
    return () => { listeners.delete(fn) }
  }, [])

  useEffect(() => {
    if (!/^[A-Za-z0-9_]{3,16}$/.test(username) || cache.has(key)) return
    const t = window.setTimeout(() => { load(username) }, 400)
    return () => window.clearTimeout(t)
  }, [username, key])

  return { skin: cache.get(key) ?? null, loading: !cache.has(key) && pending.has(key) }
}
