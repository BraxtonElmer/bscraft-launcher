import { useEffect, useState } from 'react'
import { EMPTY_LOOK, fetchPublishedLook, type Look, type Skin } from '../lib/skin'

// Shared across pages so a new upload in Profile shows up on the Play dock too
const cache = new Map<string, Look>()
const pending = new Map<string, Promise<Look>>()
const listeners = new Set<() => void>()

function load(name: string): Promise<Look> {
  const key = name.toLowerCase()
  let p = pending.get(key)
  if (!p) {
    p = fetchPublishedLook(name)
      .catch(() => EMPTY_LOOK) // offline or server hiccup: fall back to the defaults
      .then(look => {
        cache.set(key, look)
        pending.delete(key)
        listeners.forEach(fn => fn())
        return look
      })
    pending.set(key, p)
  }
  return p
}

/** Refetches a player's look after it changed (upload or removal) */
export function invalidateLook(name: string): Promise<Look> {
  cache.delete(name.toLowerCase())
  return load(name)
}

/** Everything published for this username. Debounced while typing. */
export function usePublishedLook(username: string): { look: Look; loading: boolean } {
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

  return { look: cache.get(key) ?? EMPTY_LOOK, loading: !cache.has(key) && (pending.has(key) || /^[A-Za-z0-9_]{3,16}$/.test(username)) }
}

/** The skin published for this username, or null for the default */
export function usePublishedSkin(username: string): { skin: Skin | null; loading: boolean } {
  const { look, loading } = usePublishedLook(username)
  return { skin: look.skin, loading }
}
