import { getCurrentWindow } from '@tauri-apps/api/window'

interface Props {
  settingsOpen: boolean
  onSettingsClose: () => void
  consoleOpen: boolean
}

export function TitleBar({ settingsOpen, onSettingsClose, consoleOpen }: Props) {
  const minimize = () => getCurrentWindow().minimize()
  const close    = () => getCurrentWindow().close()

  return (
    /* data-tauri-drag-region on the outer div makes the ENTIRE bar draggable.
       Buttons inside still work because they capture pointer events first. */
    <div className="title-bar" data-tauri-drag-region>

      {/* Left: back button (settings mode only) */}
      {settingsOpen ? (
        <button className="title-bar-back" onClick={onSettingsClose} id="btn-settings-back">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M9 2L4 7l5 5" stroke="currentColor" strokeWidth="1.6"
              strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Settings
        </button>
      ) : (
        <span className="title-bar-label">
          {consoleOpen ? 'Minecraft Console' : 'BSCraft Launcher'}
        </span>
      )}

      {/* Centre spacer — also draggable */}
      <div className="title-bar-drag" data-tauri-drag-region />

      {/* Window controls */}
      <div className="title-bar-controls">
        <button id="btn-minimize" className="tb-btn" onClick={minimize} title="Minimize">
          <svg width="10" height="2" viewBox="0 0 10 2" fill="none">
            <path d="M1 1h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </button>
        <button id="btn-close" className="tb-btn close" onClick={close} title="Close">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="currentColor"
              strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </button>
      </div>
    </div>
  )
}
