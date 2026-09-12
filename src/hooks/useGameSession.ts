import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { parseLogLine } from '../lib/format'
import type { GameExited, GameStatus, LogEntry, LogLine } from '../types'

const MAX_LINES = 5000
const FLUSH_MS = 120

export interface GameSessionApi {
  running: boolean
  /** Epoch ms when the current session started */
  startedAt: number | null
  lines: LogEntry[]
  exitCode: number | null
  /** Increments on every game exit (lets effects react to repeated identical exit codes) */
  exitSeq: number
  /** True when the last exit was caused by the user stopping the game */
  stoppedByUser: boolean
  /** Clear the log and mark the game as starting (call right before launch_game) */
  prepare: () => void
  markRunning: () => void
  kill: () => Promise<void>
  clearLog: () => void
}

/**
 * Minecraft process state + its log. Lives at the app root so the log keeps
 * streaming while the user is on other pages. Lines are batched so a burst of
 * thousands of startup lines doesn't re-render per line.
 */
export function useGameSession(): GameSessionApi {
  const [running, setRunning] = useState(false)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [lines, setLines] = useState<LogEntry[]>([])
  const [exitCode, setExitCode] = useState<number | null>(null)
  const [exitSeq, setExitSeq] = useState(0)
  const [stoppedByUser, setStoppedByUser] = useState(false)

  const buffer = useRef<string[]>([])
  const nextId = useRef(0)
  const killed = useRef(false)

  const append = useCallback((raws: string[]) => {
    setLines(prev => {
      let last = prev.length ? prev[prev.length - 1].level : null
      const added = raws.map(raw => {
        const entry = parseLogLine(raw, nextId.current++, last)
        last = entry.level
        return entry
      })
      const next = prev.concat(added)
      return next.length > MAX_LINES ? next.slice(-MAX_LINES) : next
    })
  }, [])

  const flush = useCallback(() => {
    if (!buffer.current.length) return
    const batch = buffer.current
    buffer.current = []
    append(batch)
  }, [append])

  useEffect(() => {
    const timer = window.setInterval(flush, FLUSH_MS)
    return () => window.clearInterval(timer)
  }, [flush])

  // Pick up a game that was already running (e.g. after a webview reload)
  useEffect(() => {
    invoke<GameStatus>('get_game_status')
      .then(s => {
        if (!s.running) return
        setRunning(true)
        setStartedAt(Date.now())
        invoke<string[]>('get_log_lines').then(append).catch(() => {})
      })
      .catch(() => {})
  }, [append])

  useEffect(() => {
    const subs = [
      listen<LogLine>('log-line', e => { buffer.current.push(e.payload.line) }),
      listen<GameExited>('game-exited', e => {
        flush()
        const code = e.payload.exit_code
        setRunning(false)
        setStartedAt(null)
        setExitCode(code)
        setExitSeq(n => n + 1)
        setStoppedByUser(killed.current)
        killed.current = false
        append([code === 0
          ? '--- Minecraft exited normally (code 0) ---'
          : `--- Minecraft exited with code ${code} ---`])
      }),
    ]
    return () => { subs.forEach(s => s.then(fn => fn())) }
  }, [append, flush])

  const prepare = useCallback(() => {
    buffer.current = []
    killed.current = false
    setLines([])
    setExitCode(null)
    setStoppedByUser(false)
  }, [])

  const markRunning = useCallback(() => {
    setRunning(true)
    setStartedAt(Date.now())
  }, [])

  const kill = useCallback(async () => {
    killed.current = true
    await invoke('kill_game').catch(() => { killed.current = false })
  }, [])

  const clearLog = useCallback(() => {
    buffer.current = []
    setLines([])
  }, [])

  return { running, startedAt, lines, exitCode, exitSeq, stoppedByUser, prepare, markRunning, kill, clearLog }
}
