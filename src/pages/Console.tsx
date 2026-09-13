import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Segmented } from '../components/ui'
import { ArrowDownIcon, CheckIcon, CopyIcon, EraserIcon, SearchIcon, StopIcon, TerminalIcon } from '../components/Icons'
import { copyText } from '../lib/clipboard'
import type { GameSessionApi } from '../hooks/useGameSession'
import type { LogEntry } from '../types'

interface Props {
  game: GameSessionApi
}

type LevelFilter = 'all' | 'warn' | 'error'

export function ConsolePage({ game }: Props) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<LevelFilter>('all')
  const [autoScroll, setAutoScroll] = useState(true)
  const [confirmStop, setConfirmStop] = useState(false)
  const [copied, setCopied] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)

  // Count log records, not lines: a stack trace under an error is part of that error,
  // and a block of untimed error lines (e.g. a JVM crash banner) counts once
  const counts = useMemo(() => {
    let warn = 0, error = 0
    let prev: LogEntry | null = null
    for (const l of game.lines) {
      const starts = !!l.time || !prev || prev.level !== l.level
      if (starts && l.level === 'warn') warn++
      else if (starts && l.level === 'error') error++
      prev = l
    }
    return { warn, error }
  }, [game.lines])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return game.lines.filter(l =>
      (filter === 'all' || l.level === 'error' || (filter === 'warn' && l.level === 'warn')) &&
      (!q || l.raw.toLowerCase().includes(q)))
  }, [game.lines, query, filter])

  useLayoutEffect(() => {
    const el = bodyRef.current
    if (autoScroll && el) el.scrollTop = el.scrollHeight
  }, [visible, autoScroll])

  useEffect(() => {
    if (!confirmStop) return
    const t = window.setTimeout(() => setConfirmStop(false), 3000)
    return () => window.clearTimeout(t)
  }, [confirmStop])

  const handleScroll = () => {
    const el = bodyRef.current
    if (el) setAutoScroll(el.scrollHeight - el.scrollTop - el.clientHeight < 40)
  }

  const handleCopy = async () => {
    if (await copyText(visible.map(l => l.raw).join('\n'))) {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    }
  }

  const handleStop = () => {
    if (!confirmStop) { setConfirmStop(true); return }
    setConfirmStop(false)
    game.kill()
  }

  const status = game.running
    ? { tone: 'live', text: 'Running' }
    : game.exitCode === null
    ? { tone: 'idle', text: 'Not running' }
    : game.stoppedByUser
    ? { tone: 'idle', text: 'Stopped' }
    : game.exitCode === 0
    ? { tone: 'ok', text: 'Exited normally' }
    : { tone: 'err', text: `Exited with code ${game.exitCode}` }

  return (
    <div className="page console page-enter">
      <header className="page-header row">
        <div>
          <h1>Console</h1>
          <p>Live output from Minecraft. Useful when something crashes or a mod misbehaves.</p>
        </div>
        <div className={`status-pill ${status.tone}`}>
          <span className="status-dot" />
          {status.text}
          {game.lines.length > 0 && <span className="pill-count">{game.lines.length.toLocaleString()} lines</span>}
        </div>
      </header>

      <div className="console-toolbar">
        <label className="search">
          <SearchIcon size={15} />
          <input
            id="console-filter"
            type="text"
            placeholder="Filter log…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            spellCheck={false}
          />
        </label>
        <Segmented<LevelFilter>
          size="sm"
          label="Log level"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All' },
            { value: 'warn', label: <>Warnings <span className="seg-count warn">{counts.warn}</span></> },
            { value: 'error', label: <>Errors <span className="seg-count err">{counts.error}</span></> },
          ]}
        />
        <div className="toolbar-spacer" />
        <button className="icon-btn" onClick={handleCopy} title="Copy visible lines" aria-label="Copy visible lines" disabled={!visible.length}>
          {copied ? <CheckIcon size={16} /> : <CopyIcon size={16} />}
        </button>
        <button className="icon-btn" onClick={game.clearLog} title="Clear view" aria-label="Clear view" disabled={!game.lines.length}>
          <EraserIcon size={16} />
        </button>
        {game.running && (
          <button
            id="btn-kill-minecraft"
            className={`btn sm stop-btn ${confirmStop ? 'danger' : 'ghost danger-text'}`}
            onClick={handleStop}
            title="Force-stop Minecraft (unsaved progress is lost)"
          >
            <StopIcon size={14} /> {confirmStop ? 'Click to confirm' : 'Stop game'}
          </button>
        )}
      </div>

      <div className="console-panel">
        <div className="console-body" ref={bodyRef} onScroll={handleScroll} id="console-log-output">
          {visible.length === 0 ? (
            <div className="console-empty">
              <TerminalIcon size={28} />
              {game.lines.length === 0 ? (
                <>
                  <strong>{game.running ? 'Waiting for output…' : 'Nothing here yet'}</strong>
                  <span>{game.running ? 'Minecraft is starting up.' : 'Launch Minecraft and its log will stream here live.'}</span>
                </>
              ) : (
                <>
                  <strong>No matching lines</strong>
                  <span>Try a different filter.</span>
                </>
              )}
            </div>
          ) : (
            visible.map(entry => <LogRow key={entry.id} entry={entry} />)
          )}
        </div>

        {!autoScroll && visible.length > 0 && (
          <button
            className="jump-btn"
            onClick={() => {
              setAutoScroll(true)
              const el = bodyRef.current
              if (el) el.scrollTop = el.scrollHeight
            }}
          >
            <ArrowDownIcon size={14} /> Jump to latest
          </button>
        )}
      </div>
    </div>
  )
}

function shortSource(source: string): string {
  const last = source.split('/').filter(Boolean).pop() ?? ''
  return last.split('.').pop() ?? last
}

const LEVEL_LABEL: Record<string, string> = { info: 'INFO', warn: 'WARN', error: 'ERROR', debug: 'DEBUG' }

const LogRow = memo(function LogRow({ entry }: { entry: LogEntry }) {
  const src = entry.source ? shortSource(entry.source) : ''
  return (
    <div className={`log-row ${entry.level}`}>
      {entry.time && <span className="log-time">{entry.time}</span>}
      {entry.level !== 'plain' && entry.time && (
        <span className={`log-tag ${entry.level}`} title={entry.thread}>{LEVEL_LABEL[entry.level]}</span>
      )}
      <span className="log-msg">
        {src && <span className="log-src">{src}</span>}
        {entry.message}
      </span>
    </div>
  )
})
