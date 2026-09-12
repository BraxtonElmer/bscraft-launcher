

interface Props {
  activePage: 'home' | 'settings'
  onNavigate: (page: 'home' | 'settings') => void
  gameRunning: boolean
  modpackVersion: string | null
  launcherVersion: string
}

export function Sidebar({ activePage, onNavigate, gameRunning, modpackVersion, launcherVersion }: Props) {
  return (
    <aside className="sidebar">
      {/* Logo */}
      <div className="sidebar-logo">
        <div className="sidebar-logo-icon" aria-hidden>⛏</div>
        <div className="sidebar-logo-text">
          <span className="sidebar-logo-name">BSCraft</span>
          <span className="sidebar-logo-sub">Launcher</span>
        </div>
      </div>

      {/* Navigation */}
      <nav>
        <button
          id="nav-home"
          className={`nav-item ${activePage === 'home' ? 'active' : ''}`}
          onClick={() => onNavigate('home')}
        >
          {/* Home icon */}
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1.5 6.5L8 1.5l6.5 5V14a.5.5 0 0 1-.5.5H10V10H6v4.5H2a.5.5 0 0 1-.5-.5V6.5z"/>
          </svg>
          Home
          {gameRunning && <span className="game-status-dot running" style={{ marginLeft: 'auto' }} title="Minecraft is running" />}
        </button>

        <button
          id="nav-settings"
          className={`nav-item ${activePage === 'settings' ? 'active' : ''}`}
          onClick={() => onNavigate('settings')}
        >
          {/* Settings icon */}
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="8" cy="8" r="2.5"/>
            <path d="M8 1.5v1.3M8 13.2v1.3M1.5 8h1.3M13.2 8h1.3M3.3 3.3l.9.9M11.8 11.8l.9.9M11.8 3.3l-.9.9M3.3 12.7l.9-.9"/>
          </svg>
          Settings
        </button>
      </nav>

      {/* Bottom meta */}
      <div className="sidebar-bottom">
        <div className="sidebar-version">
          <div>Launcher <span className="text-dim">v{launcherVersion}</span></div>
          {modpackVersion && (
            <div>Modpack <span className="text-dim">v{modpackVersion}</span></div>
          )}
        </div>
      </div>
    </aside>
  )
}
