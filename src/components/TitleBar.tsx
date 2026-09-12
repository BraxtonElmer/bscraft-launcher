import { getCurrentWindow } from '@tauri-apps/api/window'
import { CloseIcon, MinimizeIcon } from './Icons'

/**
 * Transparent, draggable strip across the top of the content area.
 * Closing goes through the Rust close guard, which warns if Minecraft is running.
 */
export function TitleBar() {
  return (
    <div className="titlebar" data-tauri-drag-region>
      <div className="titlebar-drag" data-tauri-drag-region />
      <div className="titlebar-controls">
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
      </div>
    </div>
  )
}
