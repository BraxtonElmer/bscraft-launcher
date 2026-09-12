import { useState, useEffect, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { LogLine, GameExited } from '../types'

interface Props {
  onGameStopped: () => void
}

function classifyLine(line: string): string {
  const lower = line.toLowerCase()
  if (lower.includes('error') || lower.includes('exception') || lower.includes('crash')) return 'error'
  if (lower.includes('warn')) return 'warn'
  if (lower.includes('[main/info]') || lower.includes('[server/info]')) return 'info'
  return 'default'
}

export function ConsolePage({ onGameStopped }: Props) {
  const [lines, setLines] = useState<string[]>([])
  const [killing, setKilling] = useState(false)
  const [gameAlive, setGameAlive] = useState(true)
  const [exitCode, setExitCode] = useState<number | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)

  // Load existing buffered lines on mount
  useEffect(() => {
    invoke<string[]>('get_log_lines').then(setLines).catch(() => {})
  }, [])

  // Listen for new log lines
  useEffect(() => {
    const unlisten = listen<LogLine>('log-line', (e) => {
      setLines(prev => {
        const next = [...prev, e.payload.line]
        return next.length > 5000 ? next.slice(-5000) : next
      })
    })
    return () => { unlisten.then(fn => fn()) }
  }, [])

  // Listen for game exit — stay open, show exit status
  useEffect(() => {
    const unlisten = listen<GameExited>('game-exited', (e) => {
      setGameAlive(false)
      setExitCode(e.payload.exit_code)
      // Add a visible exit line to the console output
      const code = e.payload.exit_code
      const msg = code === 0
        ? '--- Minecraft exited normally (code 0) ---'
        : `--- Minecraft exited with code ${code} ---`
      setLines(prev => [...prev, msg])
    })
    return () => { unlisten.then(fn => fn()) }
  }, [])

  // Auto-scroll to bottom when new lines arrive
  useEffect(() => {
    if (autoScroll && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight
    }
  }, [lines, autoScroll])

  // Detect manual scroll up (pause auto-scroll)
  const handleScroll = () => {
    if (!bodyRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = bodyRef.current
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 60)
  }

  const handleKill = async () => {
    setKilling(true)
    try {
      await invoke('kill_game')
    } catch {
      // ignore
    } finally {
      setKilling(false)
    }
  }

  // Close console and return to home page
  const handleClose = () => {
    onGameStopped()
  }

  return (
    <div className="console-page fade-in">
      {/* Header */}
      <div className="console-header">
        <div className="console-title">
          {/* Status dot: green when running, grey when exited */}
          <span className={`console-dot${gameAlive ? '' : ' exited'}`} />
          Minecraft Console
          {!gameAlive && exitCode !== null && (
            <span style={{ fontSize: 11, color: exitCode === 0 ? 'var(--success)' : 'var(--danger)', marginLeft: 8 }}>
              exited {exitCode === 0 ? 'normally' : `(code ${exitCode})`}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {/* Kill button — only when game is alive */}
          {gameAlive && (
            <button
              id="btn-kill-minecraft"
              className="kill-btn"
              onClick={handleKill}
              disabled={killing}
            >
              {killing ? 'Killing…' : 'Kill Process'}
            </button>
          )}

          {/* Close console — only available after game exits */}
          {gameAlive ? (
            <span style={{
              fontSize: 11,
              color: 'var(--text-muted)',
              fontStyle: 'italic',
              padding: '0 4px',
            }}>
              Close available after exit
            </span>
          ) : (
            <button
              id="btn-close-console"
              className="close-console-btn"
              onClick={handleClose}
              title="Close console and return to launcher"
            >
              ✕ Close
            </button>
          )}
        </div>
      </div>

      {/* Log body */}
      <div
        className="console-body"
        ref={bodyRef}
        onScroll={handleScroll}
        id="console-log-output"
      >
        {lines.length === 0 && (
          <div style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>
            Waiting for Minecraft output…
          </div>
        )}
        {lines.map((line, i) => (
          <div key={i} className={`log-line ${classifyLine(line)}`}>
            {line}
          </div>
        ))}
      </div>

      {/* Jump to bottom pill */}
      {!autoScroll && (
        <div
          style={{
            position: 'absolute',
            bottom: 12,
            right: 16,
            fontSize: 11,
            color: 'var(--text-muted)',
            cursor: 'pointer',
            background: 'var(--bg-2)',
            border: '1px solid var(--border-2)',
            borderRadius: 'var(--radius-sm)',
            padding: '4px 10px',
          }}
          onClick={() => {
            setAutoScroll(true)
            if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight
          }}
        >
          ↓ Jump to bottom
        </div>
      )}
    </div>
  )
}
