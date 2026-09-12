import { useEffect, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { getVersion } from '@tauri-apps/api/app'
import { useConfig } from './hooks/useConfig'
import { useOperation } from './hooks/useOperation'
import { useGameSession } from './hooks/useGameSession'
import { useLauncher } from './hooks/useLauncher'
import { NavRail } from './components/NavRail'
import { TitleBar } from './components/TitleBar'
import { PixelScene, useSceneTime, type Scenery } from './components/PixelScene'
import { ActivityCard } from './components/ActivityCard'
import { Toasts, useToasts } from './components/Toasts'
import { ErrorModal } from './components/ErrorModal'
import { CloseWarningModal } from './components/CloseWarningModal'
import { HomePage } from './pages/Home'
import { SettingsPage } from './pages/Settings'
import { ConsolePage } from './pages/Console'
import type { Page } from './types'

// Purely cosmetic, so it lives in the webview rather than the Rust config
const SCENERY_KEY = 'bscraft.scenery'
const SCENERIES: Scenery[] = ['auto', 'dawn', 'day', 'dusk', 'night']

function loadScenery(): Scenery {
  try {
    const v = localStorage.getItem(SCENERY_KEY) as Scenery | null
    if (v && SCENERIES.includes(v)) return v
  } catch { /* storage unavailable */ }
  return 'auto'
}

export default function App() {
  const cfg = useConfig()
  const op = useOperation()
  const game = useGameSession()
  const { toasts, notify, dismiss } = useToasts()

  const [page, setPage] = useState<Page>('home')
  const [launcherVersion, setLauncherVersion] = useState('')
  const [showCloseWarning, setShowCloseWarning] = useState(false)
  const [scenery, setScenery] = useState<Scenery>(loadScenery)
  const sceneTime = useSceneTime(scenery)

  const launcher = useLauncher({
    cfg,
    op,
    game,
    notify,
    onLaunched: () => { if (cfg.config.console_enabled) setPage('console') },
  })

  useEffect(() => {
    getVersion().then(setLauncherVersion).catch(() => {})
  }, [])

  // The Rust close guard asks us to confirm when Minecraft is running
  useEffect(() => {
    const unlisten = listen('close-game-warning', () => setShowCloseWarning(true))
    return () => { unlisten.then(fn => fn()) }
  }, [])

  // Surface crashes even when the console isn't open
  useEffect(() => {
    if (!game.exitSeq || game.exitCode === 0 || game.stoppedByUser || page === 'console') return
    notify({
      tone: 'error',
      title: 'Minecraft closed unexpectedly',
      body: `Exit code ${game.exitCode}. The log may show what went wrong.`,
      action: { label: 'View log', onClick: () => setPage('console') },
    })
  }, [game.exitSeq])

  const changeScenery = (s: Scenery) => {
    setScenery(s)
    try { localStorage.setItem(SCENERY_KEY, s) } catch { /* storage unavailable */ }
  }

  const operation = op.operation
  const showActivity =
    !!operation && (page === 'console' || (page === 'settings' && operation.kind === 'install'))

  return (
    <div className="app" data-time={sceneTime}>
      <NavRail
        page={page}
        onNavigate={setPage}
        gameRunning={game.running}
        working={!!operation}
        launcherVersion={launcherVersion}
      />

      <main className={`stage on-${page}`}>
        <PixelScene
          time={sceneTime}
          paused={page !== 'home' || game.running}
          title={page === 'home'}
          className={page !== 'home' ? 'dimmed' : ''}
        />
        <TitleBar />

        {cfg.loaded && (
          page === 'home' ? (
            <HomePage
              launcher={launcher}
              config={cfg.config}
              operation={operation}
              startedAt={game.startedAt}
              onNavigate={setPage}
              onStopGame={game.kill}
            />
          ) : page === 'settings' ? (
            <SettingsPage
              launcher={launcher}
              config={cfg.config}
              persist={cfg.persist}
              operation={operation}
              launcherVersion={launcherVersion}
              scenery={scenery}
              onSceneryChange={changeScenery}
            />
          ) : (
            <ConsolePage game={game} />
          )
        )}

        {showActivity && operation && (
          <ActivityCard operation={operation} onClick={() => setPage('home')} />
        )}
        <Toasts toasts={toasts} onDismiss={dismiss} />
      </main>

      {launcher.error && (
        <ErrorModal
          error={launcher.error.message}
          context={launcher.error.context}
          onClose={launcher.dismissError}
        />
      )}
      {showCloseWarning && (
        <CloseWarningModal onCancel={() => setShowCloseWarning(false)} />
      )}
    </div>
  )
}
