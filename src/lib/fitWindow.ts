import { invoke } from '@tauri-apps/api/core'

// The UI is laid out for 960×580. The launcher sizes its window and zoom to the screen
// (fit.rs); if the page still doesn't match its window, say after a move to a monitor with
// other scaling that the webview picked up late, it asks for the zoom to be corrected.
const WIDTH = 960
const HEIGHT = 580

export function keepUiFitted() {
  let timer: number | undefined
  const check = () => {
    const ratio = Math.min(window.innerWidth / WIDTH, window.innerHeight / HEIGHT)
    if (Math.abs(ratio - 1) > 0.02) invoke('fit_ui', { ratio }).catch(() => {})
  }
  // Measured once things settle: the window and the zoom change a moment apart
  const later = () => {
    window.clearTimeout(timer)
    timer = window.setTimeout(check, 600)
  }
  window.addEventListener('resize', later)
  later()
}
