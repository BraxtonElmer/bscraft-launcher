// ============================================================
// ServerPill.tsx — Live player count for the BSCraft server.
// Hover (or focus) shows who's on, with their BSCraft skins' faces.
// ============================================================

import { useState } from 'react'
import { PlayerHead } from './PlayerHead'
import { usePublishedSkin } from '../hooks/useSkin'
import type { ServerStatus } from '../types'

interface Props {
  status: ServerStatus | null
  /** The launcher's player name, marked "you" in the list */
  me: string
}

export function ServerPill({ status, me }: Props) {
  const [open, setOpen] = useState(false)

  const loading = !status
  const online = !!status?.online
  const count = status?.players_online ?? 0
  const tone = loading ? 'idle' : !online ? 'down' : count > 0 ? 'live' : 'quiet'
  const text = loading
    ? 'Checking server…'
    : !online
      ? 'Server offline'
      : `${count} ${count === 1 ? 'player' : 'players'} online`

  return (
    <div
      className="server-pill-wrap"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      <button type="button" className={`server-pill ${tone}`} aria-expanded={open} aria-label={`BSCraft server: ${text}`}>
        <span className="server-dot" />
        {text}
      </button>

      {open && status && (
        <div className="server-card" role="tooltip">
          <div className="server-card-head">
            <strong>BSCraft</strong>
            <span>
              {online
                ? `${count} / ${status.players_max} online · ${status.latency_ms} ms`
                : "Can't reach the server right now"}
            </span>
          </div>
          {online && (
            count === 0 ? (
              <p className="server-empty">Nobody's on right now. Be the first!</p>
            ) : (
              <ul className="server-players">
                {status.players.map(name => (
                  <PlayerRow key={name} name={name} me={name.toLowerCase() === me.toLowerCase()} />
                ))}
                {count > status.players.length && (
                  <li className="server-more">
                    {status.players.length === 0
                      ? `${count} ${count === 1 ? 'player is' : 'players are'} in game`
                      : `+${count - status.players.length} more`}
                  </li>
                )}
              </ul>
            )
          )}
        </div>
      )}
    </div>
  )
}

function PlayerRow({ name, me }: { name: string; me: boolean }) {
  const { skin } = usePublishedSkin(name)
  return (
    <li className="server-player">
      <PlayerHead name={name} size={22} skin={skin?.image} />
      <span className="server-player-name">{name}</span>
      {me && <span className="server-you">you</span>}
      <span className="server-ingame" title="In game" />
    </li>
  )
}
