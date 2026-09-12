import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import type { AppConfig } from '../types'

const DEFAULT_CONFIG: AppConfig = {
  username: '',
  ram_mb: 2048,
  console_enabled: false,
  prefer_dgpu: true,
  performance_mode: false,
  auto_join: true,
  installed_modpack_version: null,
  installed_mc_version: null,
  installed_forge_version: null,
}

export interface ConfigApi {
  config: AppConfig
  loaded: boolean
  /** Re-read the config from disk — the backend writes installed versions during installs/syncs */
  refresh: () => Promise<AppConfig | null>
  /** Merge a change into the on-disk config and save it */
  persist: (partial: Partial<AppConfig>) => Promise<void>
}

export function useConfig(): ConfigApi {
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG)
  const [loaded, setLoaded] = useState(false)
  const latest = useRef(config)
  latest.current = config

  // Saves are serialized, and each one starts from the on-disk config rather than
  // React state, so we never clobber installed_* versions the backend just wrote.
  const queue = useRef<Promise<void>>(Promise.resolve())
  const pending = useRef<Partial<AppConfig>[]>([])

  useEffect(() => {
    invoke<AppConfig>('get_config')
      .then(setConfig)
      .catch(() => {})
      .finally(() => setLoaded(true))
  }, [])

  const refresh = useCallback(async () => {
    try {
      const fresh = await invoke<AppConfig>('get_config')
      setConfig(Object.assign({}, fresh, ...pending.current))
      return fresh
    } catch {
      return null
    }
  }, [])

  const persist = useCallback((partial: Partial<AppConfig>) => {
    pending.current.push(partial)
    setConfig(c => ({ ...c, ...partial }))

    const run = queue.current.then(async () => {
      const fresh = await invoke<AppConfig>('get_config').catch(() => null)
      const updated = { ...(fresh ?? latest.current), ...partial }
      await invoke('save_config', { config: updated }).catch(() => {})
      pending.current.splice(pending.current.indexOf(partial), 1)
      // Keep optimistic values for saves that are still queued
      setConfig(Object.assign({}, updated, ...pending.current))
    })
    queue.current = run
    return run
  }, [])

  return { config, loaded, refresh, persist }
}
