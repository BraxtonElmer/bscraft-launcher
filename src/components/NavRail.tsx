import type { ReactNode } from 'react'
import { PixelText } from './PixelText'
import { GearIcon, PlayIcon, TerminalIcon } from './Icons'
import type { Page } from '../types'

interface Props {
  page: Page
  onNavigate: (page: Page) => void
  gameRunning: boolean
  working: boolean
  launcherVersion: string
}

export function NavRail({ page, onNavigate, gameRunning, working, launcherVersion }: Props) {
  return (
    <nav className="rail" aria-label="Main">
      <div className="rail-brand" data-tauri-drag-region>
        <div className="rail-logo" data-tauri-drag-region title="BSCraft">
          <PixelText text="BSC" scale={2} color="#ffffff" shadow="rgba(42, 12, 70, 0.55)" />
        </div>
      </div>

      <div className="rail-nav">
        <RailItem
          id="nav-home"
          label="Play"
          icon={<PlayIcon size={20} />}
          active={page === 'home'}
          onClick={() => onNavigate('home')}
          badge={working && page !== 'home' ? 'work' : undefined}
        />
        <RailItem
          id="nav-console"
          label="Console"
          icon={<TerminalIcon size={20} />}
          active={page === 'console'}
          onClick={() => onNavigate('console')}
          badge={gameRunning ? 'live' : undefined}
        />
      </div>

      <div className="rail-bottom">
        <RailItem
          id="nav-settings"
          label="Settings"
          icon={<GearIcon size={20} />}
          active={page === 'settings'}
          onClick={() => onNavigate('settings')}
        />
        <div className="rail-version" title="Launcher version">v{launcherVersion}</div>
      </div>
    </nav>
  )
}

interface ItemProps {
  id: string
  label: string
  icon: ReactNode
  active: boolean
  onClick: () => void
  badge?: 'live' | 'work'
}

function RailItem({ id, label, icon, active, onClick, badge }: ItemProps) {
  return (
    <button
      id={id}
      className={`rail-item${active ? ' active' : ''}`}
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
    >
      <span className="rail-icon">
        {icon}
        {badge && <span className={`rail-badge ${badge}`} />}
      </span>
      <span className="rail-label">{label}</span>
    </button>
  )
}
