import { useMemo } from 'react'
import { useServerStatus } from './useServerStatus'
import { usePublishedLooks } from './useSkin'
import { generatedSkin } from '../lib/defaultSkin'
import type { OnlinePlayer } from '../components/scenePlayers'

/** Most players the Play screen's landscape shows at once */
const MAX_SHOWN = 8

/**
 * Who's on the BSCraft server right now, with their skins, ready to be
 * put into the landscape. Players the server doesn't name (they turned
 * off server listings) still show up, just without a name tag.
 */
export function useOnlinePlayers(active: boolean): OnlinePlayer[] {
  const { status } = useServerStatus(active)
  const names = useMemo(() => (status?.online ? status.players.slice(0, MAX_SHOWN) : []), [status])
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
