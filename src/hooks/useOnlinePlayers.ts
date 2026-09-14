import { useMemo, useRef } from 'react'
import { useServerStatus } from './useServerStatus'
import { usePublishedLooks } from './useSkin'
import { generatedSkin } from '../lib/defaultSkin'
import type { OnlinePlayer } from '../components/scenePlayers'
import type { ServerStatus } from '../types'

/** Most players the Play screen's landscape shows at once */
const MAX_SHOWN = 8
/** How long a name is remembered after the server last showed it */
const REMEMBER_MS = 20 * 60_000
const SEEN_KEY = 'bscraft.seenPlayers'

type Seen = Record<string, { name: string; at: number }>

/**
 * Who's on the BSCraft server right now, with their skins, ready to be
 * put into the landscape. Players the server doesn't name still show up,
 * just without a name tag.
 *
 * The server stops naming anyone who has died and respawned (Minecraft
 * 1.20.1 forgets their "Allow Server Listings" until they rejoin), so
 * names seen recently are remembered: when a named player drops out of
 * the list and an unnamed one is there instead, it's them.
 */
export function useOnlinePlayers(active: boolean): OnlinePlayer[] {
  const { status } = useServerStatus(active)
  const seen = useRef<Seen | null>(null)
  if (!seen.current) seen.current = loadSeen()

  const names = useMemo(() => withRemembered(status, seen.current!), [status])
  const looks = usePublishedLooks(names)
  const hidden = status?.online ? Math.max(0, Math.min(status.players_online, MAX_SHOWN) - names.length) : 0

  const skinKey = names.map(n => looks.get(n.toLowerCase())?.skin?.src ?? '').join('|')
  return useMemo(() => {
    const players: OnlinePlayer[] = names.map(name => {
      const look = looks.get(name.toLowerCase())
      // Until the published look arrives (or when there is none) they wear the generated default
      return look?.skin
        ? { name, skin: look.skin.image, slim: look.skin.model === 'slim' }
        : { name, skin: generatedSkin(name), slim: false }
    })
    for (let i = 0; i < hidden; i++) players.push({ name: '', skin: generatedSkin(`anonymous-${i}`), slim: false })
    return players
  }, [names, hidden, skinKey])
}

/** The names to show: everyone the server named, plus remembered names for its unnamed players */
export function withRemembered(status: ServerStatus | null, seen: Seen, now = Date.now()): string[] {
  if (!status?.online) return []
  const named = status.players.slice(0, MAX_SHOWN)
  for (const n of named) seen[n.toLowerCase()] = { name: n, at: now }

  const unnamed = Math.max(0, Math.min(status.players_online, MAX_SHOWN) - named.length)
  const listed = new Set(named.map(n => n.toLowerCase()))
  const recent = Object.entries(seen)
    .filter(([key, s]) => !listed.has(key) && now - s.at < REMEMBER_MS)
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, unnamed)
  // Still here, so keep remembering them
  for (const [, s] of recent) s.at = now
  for (const [key, s] of Object.entries(seen)) if (now - s.at >= REMEMBER_MS) delete seen[key]
  saveSeen(seen)
  return [...named, ...recent.map(([, s]) => s.name)]
}

function loadSeen(): Seen {
  try {
    const raw = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '{}')
    return raw && typeof raw === 'object' ? raw : {}
  } catch {
    return {}
  }
}

function saveSeen(seen: Seen) {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify(seen)) } catch { /* storage unavailable */ }
}
