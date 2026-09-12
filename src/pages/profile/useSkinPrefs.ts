import { useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import type { SkinPrefs } from '../../types'

export const DEFAULT_PREFS: SkinPrefs = {
  cape: true,
  jacket: true,
  left_sleeve: true,
  right_sleeve: true,
  left_pants_leg: true,
  right_pants_leg: true,
  hat: true,
  main_hand: 'right',
}

/** Minecraft's Skin Customization options, read from and saved straight to options.txt */
export function useSkinPrefs() {
  const [prefs, setPrefs] = useState<SkinPrefs>(DEFAULT_PREFS)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const latest = useRef(prefs)
  latest.current = prefs

  useEffect(() => {
    invoke<SkinPrefs>('get_skin_prefs')
      .then(p => { setPrefs(p); setLoaded(true) })
      .catch(e => { setError(String(e)); setLoaded(true) })
  }, [])

  const update = async (patch: Partial<SkinPrefs>) => {
    const before = latest.current
    const next = { ...before, ...patch }
    setPrefs(next)
    setError(null)
    try {
      setPrefs(await invoke<SkinPrefs>('set_skin_prefs', { prefs: next }))
    } catch (e) {
      setPrefs(before)
      setError(String(e))
    }
  }

  return { prefs, loaded, error, update }
}
