// ============================================================
// OnlineField.tsx — Live player count in the Play dock.
// Hover (or focus) shows who's on in a Minecraft-style tooltip.
// ============================================================

import { useState } from 'react'
import { PixelText } from './PixelText'
import { PlayerHead } from './PlayerHead'
import { usePublishedSkin } from '../hooks/useSkin'
import type { ServerStatus } from '../types'

// Minecraft's chat colours
const MC_WHITE = '#ffffff'
const MC_GRAY = '#aaaaaa'
const MC_GREEN = '#55ff55'
const MC_RED = '#ff5555'
const MC_SHADOW = 'rgba(0, 0, 0, 0.45)'

interface Props {
  status: ServerStatus | null
  /** The launcher's player name, marked in the list */
  me: string
}

export function OnlineField({ status, me }: Props) {
  const [open, setOpen] = useState(false)
  const online = !!status?.online
  const count = status?.players_online ?? 0
  const tone = !status ? 'idle' : !online ? 'down' : count > 0 ? 'live' : 'quiet'

  return (
    <div
      className="dock-field dock-online"
      tabIndex={0}
      aria-label={!status ? 'Checking the server' : online ? `${count} of ${status.players_max} players online` : 'Server offline'}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      <span className="overline">Online</span>
      <span className="online-value">
        <span className={`online-dot ${tone}`} />
        {!status ? '…' : online ? `${count}/${status.players_max}` : 'Offline'}
      </span>

      {open && status && (
        <div className="mc-tooltip" role="tooltip">
          {!online ? (
            <PixelText text="Server offline" scale={2} color={MC_RED} shadow={MC_SHADOW} />
          ) : (
            <>
              <PixelText text={`${count} of ${status.players_max} online`} scale={2} color={MC_GREEN} shadow={MC_SHADOW} />
              {count === 0 ? (
                <PixelText text="Nobody's on yet" scale={2} color={MC_GRAY} shadow={MC_SHADOW} />
              ) : (
                <ul className="mc-players">
                  {status.players.map(name => (
                    <PlayerRow key={name} name={name} me={name.toLowerCase() === me.toLowerCase()} />
                  ))}
                  {count > status.players.length && (
                    <li>
                      <PixelText text={`+${count - status.players.length} more`} scale={2} color={MC_GRAY} shadow={MC_SHADOW} />
                    </li>
                  )}
                </ul>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function PlayerRow({ name, me }: { name: string; me: boolean }) {
  const { skin } = usePublishedSkin(name)
  return (
    <li>
      <PlayerHead name={name} size={16} skin={skin?.image} />
      <PixelText text={name} scale={2} color={MC_WHITE} shadow={MC_SHADOW} />
      {me && <PixelText text="(you)" scale={2} color={MC_GRAY} shadow={MC_SHADOW} />}
    </li>
  )
}
