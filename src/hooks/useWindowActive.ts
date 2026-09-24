import { useEffect, useState } from 'react'

/**
 * Whether the launcher window is the one being looked at: not minimized, and in front.
 * The Play screen's landscape keeps animating while it is, even with Minecraft running,
 * and stops when the window is minimized or another app covers it.
 */
export function useWindowActive() {
  const [active, setActive] = useState(() => !document.hidden && document.hasFocus())

  useEffect(() => {
    const update = () => setActive(!document.hidden && document.hasFocus())
    window.addEventListener('focus', update)
    window.addEventListener('blur', update)
    document.addEventListener('visibilitychange', update)
    update()
    return () => {
      window.removeEventListener('focus', update)
      window.removeEventListener('blur', update)
      document.removeEventListener('visibilitychange', update)
    }
  }, [])

  return active
}
