import { getCurrentWindow } from '@tauri-apps/api/window'
import { CloseIcon, MinimizeIcon } from './Icons'
import { isMac } from '../lib/platform'

/**
 * Transparent, draggable strip across the top of the content area.
 * Closing goes through the Rust close guard, which warns if Minecraft is running.
 * On macOS the window has its own traffic-light buttons (tauri.macos.conf.json), so only the strip.
 */
export function TitleBar() {
  return (
    <div className="titlebar" data-tauri-drag-region>
      <div className="titlebar-drag" data-tauri-drag-region />
      {!isMac && <div className="titlebar-controls">
        <button
          id="btn-minimize"
          className="tb-btn"
          onClick={() => getCurrentWindow().minimize()}
          aria-label="Minimize"
          title="Minimize"
        >
          <MinimizeIcon size={16} />
        </button>
        <button
          id="btn-close"
          className="tb-btn close"
          onClick={() => getCurrentWindow().close()}
          aria-label="Close"
          title="Close"
        >
          <CloseIcon size={16} />
        </button>
      </div>}
    </div>
  )
}
