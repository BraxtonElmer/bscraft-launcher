import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import type { ServerStatus } from '../types'

const POLL_MS = 30_000

/**
 * The BSCraft server's player count and online players, refreshed every 30 s
 * while `active` (the Play screen is showing) and the window is visible.
 */
export function useServerStatus(active: boolean) {
  const [status, setStatus] = useState<ServerStatus | null>(null)
  const [checkedAt, setCheckedAt] = useState<number | null>(null)

  useEffect(() => {
    if (!active) return
    let stopped = false
    let busy = false
    const refresh = async (always = false) => {
      if (busy || (!always && document.hidden)) return
      busy = true
      try {
        const s = await invoke<ServerStatus>('server_status')
        if (!stopped) { setStatus(s); setCheckedAt(Date.now()) }
      } catch {
        // Couldn't ask at all: show it as unreachable rather than "checking" forever
        if (!stopped) setStatus(prev => prev ?? { online: false, players_online: 0, players_max: 0, players: [], latency_ms: 0, version: '' })
      } finally {
        busy = false
      }
    }
    refresh(true)
    const t = window.setInterval(() => refresh(), POLL_MS)
    const onVisible = () => { if (!document.hidden) refresh() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stopped = true
      window.clearInterval(t)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [active])

  return { status, checkedAt }
}
