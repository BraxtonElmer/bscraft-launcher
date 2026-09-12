import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getVersion } from '@tauri-apps/api/app'
import type { AppConfig, ActiveOperation } from './types'
import { TitleBar } from './components/TitleBar'
import { ProgressOverlay } from './components/ProgressOverlay'
import { CloseWarningModal } from './components/CloseWarningModal'
import { MainPage } from './pages/Main'
import { SettingsPage } from './pages/Settings'
import { ConsolePage } from './pages/Console'

export default function App() {
  const [config, setConfig] = useState<AppConfig>({
    username: '',
    ram_mb: 2048,
    console_enabled: false,
    prefer_dgpu: true,
    performance_mode: false,
    installed_modpack_version: null,
    installed_mc_version: null,
    installed_forge_version: null,
  })
  const [configLoaded, setConfigLoaded] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [gameRunning, setGameRunning] = useState(false)
  const [showConsole, setShowConsole] = useState(false)
  const [launcherVersion, setLauncherVersion] = useState('0.1.0')
  const [operation, setOperation] = useState<ActiveOperation | null>(null)
  const [showCloseWarning, setShowCloseWarning] = useState(false)

  useEffect(() => {
    invoke<AppConfig>('get_config')
      .then(cfg => { setConfig(cfg); setConfigLoaded(true) })
      .catch(() => setConfigLoaded(true))
    getVersion().then(setLauncherVersion).catch(() => {})
  }, [])

  // Listen for the Rust window-close guard event
  useEffect(() => {
    const unlisten = listen('close-game-warning', () => {
      setShowCloseWarning(true)
    })
    return () => { unlisten.then(fn => fn()) }
  }, [])

  const handleGameStart = () => {
    setGameRunning(true)
    if (config.console_enabled) setShowConsole(true)
  }

  const handleGameStopped = () => {
    setGameRunning(false)
    setShowConsole(false)
  }

  const handleConfigChange = (newConfig: AppConfig) => setConfig(newConfig)

  if (!configLoaded) return (
    <div className="app-shell">
      <TitleBar settingsOpen={false} consoleOpen={false} onSettingsClose={() => {}} />
    </div>
  )

  return (
    <div className="app-shell">
      <TitleBar
        settingsOpen={settingsOpen}
        consoleOpen={showConsole}
        onSettingsClose={() => setSettingsOpen(false)}
      />
      <div className="app-content">
        {showConsole ? (
          <ConsolePage onGameStopped={handleGameStopped} />
        ) : settingsOpen ? (
          <SettingsPage
            config={config}
            onConfigChange={handleConfigChange}
            launcherVersion={launcherVersion}
            operation={operation}
            onOperation={setOperation}
          />
        ) : (
          <MainPage
            config={config}
            onConfigChange={handleConfigChange}
            onGameStart={handleGameStart}
            onSettingsOpen={() => setSettingsOpen(true)}
            launcherVersion={launcherVersion}
            gameRunning={gameRunning}
            operation={operation}
            onOperation={setOperation}
          />
        )}

        {/* Progress overlay floats above all page content */}
        {operation && !showConsole && <ProgressOverlay operation={operation} />}
      </div>

      {/* Close warning — shown when user closes window while Minecraft is running */}
      {showCloseWarning && (
        <CloseWarningModal onCancel={() => setShowCloseWarning(false)} />
      )}
    </div>
  )
}
