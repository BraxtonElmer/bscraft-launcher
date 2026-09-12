// ============================================================
// lib/format.ts — Small formatting + validation helpers
// ============================================================

import type { LogEntry, LogLevel } from '../types'

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

export function formatSpeed(bps: number): string {
  return bps < 1024 ? '' : `${formatBytes(bps)}/s`
}

/** 4096 → "4 GB", 4352 → "4.25 GB" */
export function formatRam(mb: number): string {
  const gb = mb / 1024
  return `${Number.isInteger(gb) ? gb : gb.toFixed(2).replace(/0$/, '')} GB`
}

export function stageTitle(stage: string): string {
  const map: Record<string, string> = {
    jre: 'Installing Java Runtime',
    minecraft: 'Installing Minecraft',
    forge: 'Installing Forge',
    libraries: 'Downloading Libraries',
    assets: 'Downloading Game Assets',
    modpack: 'Syncing Modpack',
    checking: 'Syncing Modpack',
    downloading: 'Syncing Modpack',
    repair: 'Repairing Files',
    repairing: 'Repairing Files',
  }
  return map[stage] ?? 'Working…'
}

// ── Username ─────────────────────────────────────────────────

/** Strip characters Minecraft doesn't allow in player names */
export function sanitizeUsername(value: string): string {
  return value.replace(/[^A-Za-z0-9_]/g, '').slice(0, 16)
}

export function usernameProblem(name: string): string | null {
  if (!name) return 'Enter a username to play'
  if (name.length < 3) return 'Use at least 3 characters'
  if (!/^[A-Za-z0-9_]+$/.test(name)) return 'Letters, numbers and _ only'
  return null
}

/** FNV-1a — stable across sessions, used to derive the player head */
export function hashString(value: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

// ── Log parsing ──────────────────────────────────────────────

// [12:34:56] [Render thread/INFO] [net.minecraft.client/]: Message
const LOG_RE = /^\[(\d{2}:\d{2}:\d{2}(?:\.\d+)?)\] \[([^\]]*?)\/(INFO|WARN|ERROR|DEBUG|FATAL|TRACE)\](?: \[([^\]]*)\])?:? ?(.*)$/

function guessLevel(line: string): LogLevel {
  const lower = line.toLowerCase()
  if (lower.includes('error') || lower.includes('exception') || lower.includes('crash')) return 'error'
  if (lower.includes('warn')) return 'warn'
  return 'plain'
}

export function parseLogLine(raw: string, id: number, previous: LogLevel | null): LogEntry {
  const m = LOG_RE.exec(raw)
  if (m) {
    const lvl = m[3]
    const level: LogLevel =
      lvl === 'ERROR' || lvl === 'FATAL' ? 'error'
      : lvl === 'WARN' ? 'warn'
      : lvl === 'DEBUG' || lvl === 'TRACE' ? 'debug'
      : 'info'
    return { id, raw, time: m[1], thread: m[2], level, source: m[4] ?? '', message: m[5] }
  }
  // Stack-trace continuation lines inherit the level of the line above
  const continuation = /^\s+(at |\.\.\.)|^Caused by:/.test(raw)
  const level = continuation && previous ? previous : guessLevel(raw)
  return { id, raw, time: '', thread: '', level, source: '', message: raw }
}
