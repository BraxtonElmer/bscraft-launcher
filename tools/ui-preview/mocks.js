// Mock Tauri backend for UI preview. Scenario via ?s=fresh|installed|update|offline|launcherupdate
const params = new URLSearchParams(location.search)
const scenario = params.get('s') || 'installed'
const speed = Number(params.get('speed') || 1)

const sleep = ms => new Promise(r => setTimeout(r, ms / speed))

export function createMocks() {
  const listeners = new Map()
  const emit = (event, payload) => (listeners.get(event) || []).slice().forEach(fn => fn({ event, payload }))

  const installed = scenario !== 'fresh' && scenario !== 'offline'
  const state = {
    config: {
      username: installed ? 'Raxtray' : '',
      ram_mb: 6144,
      console_enabled: false,
      prefer_dgpu: true,
      performance_mode: false,
      auto_join: false,
      installed_modpack_version: installed ? (scenario === 'update' ? '1.0.0' : '1.0.1') : null,
      installed_mc_version: installed ? '1.20.1' : null,
      installed_forge_version: installed ? '47.4.10' : null,
    },
    running: false,
    logTimer: null,
    hold: params.get('hold') === '1',
    // Server account (SimpleLogin): ?acct=new|registered|mismatch
    acct: params.get('acct') || (installed ? 'registered' : 'new'),
    password: installed && params.get('nopw') !== '1' ? 'hunter22' : null,
    prefs: { cape: true, jacket: true, left_sleeve: true, right_sleeve: true, left_pants_leg: true, right_pants_leg: true, hat: true, main_hand: 'right' },
  }
  const serverPassword = () => (state.acct === 'registered' ? 'hunter22' : state.acct === 'mismatch' ? 'something-else' : null)
  const checkAuth = () => {
    const sp = serverPassword()
    if (sp === null) throw new Error("This name isn't registered yet. Join the server once to claim it.")
    if (sp !== state.password) throw new Error("Password doesn't match the one registered on the server.")
  }

  // A recognisable test texture as PNG bytes (number[] like the Rust side returns)
  async function mockPng(kind) {
    const c = document.createElement('canvas')
    c.width = 64
    c.height = kind === 'skin' ? 64 : 32
    const g = c.getContext('2d')
    const rect = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x, y, w, h) }
    if (kind === 'skin') {
      rect(0, 0, 32, 16, '#f0c9a8'); rect(8, 0, 8, 8, '#e0a030'); rect(0, 8, 32, 3, '#e0a030')
      rect(9, 12, 2, 1, '#fff'); rect(13, 12, 2, 1, '#fff'); rect(10, 12, 1, 1, '#2a6'); rect(14, 12, 1, 1, '#2a6')
      rect(32, 0, 32, 16, 'rgba(0,0,0,0)'); rect(40, 0, 8, 8, '#d02070')
      rect(16, 16, 24, 16, '#2a8fd8'); rect(40, 16, 16, 16, '#f0c9a8'); rect(40, 20, 16, 4, '#2a8fd8')
      rect(0, 16, 16, 16, '#303050'); rect(16, 48, 16, 16, '#303050'); rect(32, 48, 16, 16, '#f0c9a8')
      rect(20, 32, 20, 16, '#1a6fb0') // jacket overlay
    } else {
      rect(0, 0, 22, 17, '#b0203a'); rect(1, 1, 10, 16, '#d8354f'); rect(4, 5, 4, 4, '#ffd84a')
    }
    const blob = await new Promise(r => c.toBlob(r, 'image/png'))
    return Array.from(new Uint8Array(await blob.arrayBuffer()))
  }

  const files = []
  for (let i = 0; i < 209; i++) files.push({ path: `mods/mod-${i}.jar`, url: '', sha256: '', size: 3_400_000 + (i % 7) * 100_000 })
  for (let i = 0; i < 372; i++) files.push({ path: `config/mod-${i}/settings.toml`, url: '', sha256: '', size: 1200 })
  const manifest = { modpack_version: '1.0.1', minecraft_version: '1.20.1', forge_version: '47.4.10', java_version: 17, files }

  async function download(stage, file, detail, total, ms) {
    const steps = 20
    for (let i = 1; i <= steps; i++) {
      await sleep(ms / steps)
      emit('download-progress', { stage, file, detail, downloaded: Math.round(total * i / steps), total, speed_bps: 8_600_000 + Math.random() * 2_000_000, percent: i / steps * 100 })
    }
  }

  const LOG = [
    '[14:02:11] [main/INFO] [cp.mo.mo.Launcher/MODLAUNCHER]: ModLauncher running: args [--username, Raxtray, --version, 1.20.1-forge-47.4.10, --gameDir, .]',
    '[14:02:11] [main/INFO] [ne.mi.fm.lo.FMLLoader/CORE]: Loading FML 47.4.10',
    '[14:02:12] [main/WARN] [mixin/]: Reference map \'examplemod.refmap.json\' could not be read. If this is a development environment you can ignore this message',
    '[14:02:14] [Render thread/INFO] [minecraft/Minecraft]: Setting user: Raxtray',
    '[14:02:15] [modloading-worker-0/INFO] [ne.mi.co.ForgeMod/FORGEMOD]: Forge mod loading, version 47.4.10, for MC 1.20.1 with MCP 20230612.114412',
    '[14:02:16] [Render thread/INFO] [minecraft/ReloadableResourceManager]: Reloading ResourceManager: vanilla, mod_resources',
    '[14:02:18] [Render thread/ERROR] [minecraft/TextureAtlas]: Missing texture: examplemod:block/missing',
    'java.io.FileNotFoundException: examplemod:textures/block/missing.png',
    '\tat net.minecraft.server.packs.resources.ResourceManager.getResource(ResourceManager.java:61)',
    '\tat net.minecraft.client.renderer.texture.TextureAtlas.load(TextureAtlas.java:112)',
    '[14:02:20] [Render thread/INFO] [minecraft/SoundEngine]: Sound engine started',
    '[14:02:21] [Render thread/DEBUG] [ne.mi.cl.lo.ClientModLoader/]: Generating PackInfo named mod_resources for mod file /mods',
    '[14:02:22] [Render thread/INFO] [minecraft/AtlasSet]: Created: 4096x2048x4 minecraft:textures/atlas/blocks.png-atlas',
    '[14:02:23] [Render thread/WARN] [minecraft/ModelBakery]: Unable to load model: \'examplemod:item/unused\' referenced from: examplemod:unused#inventory',
    '[14:02:25] [Render thread/INFO] [minecraft/ConnectScreen]: Connecting to bscraft.zukashix.com, 25565',
  ]

  const handlers = {
    get_config: () => ({ ...state.config }),
    save_config: ({ config }) => { state.config = { ...config } },
    get_system_ram: () => 32607,
    get_gpus: async () => { await sleep(500); return [
      { name: 'NVIDIA GeForce RTX 4070 Laptop GPU', vendor: 'NVIDIA' },
      { name: 'Intel(R) UHD Graphics', vendor: 'Intel Corporation' },
    ] },
    write_error_report: () => 'C:\\Users\\raxtr\\AppData\\Roaming\\bscraft\\reports\\error-2026-09-11_14-02-11.txt',
    check_launcher_update: async () => { await sleep(300); return { has_update: scenario === 'launcherupdate', current_version: '1.0.0', latest_version: '1.1.0', notes: null } },
    apply_launcher_update: async () => {
      for (let i = 1; i <= 30; i++) { await sleep(120); emit('launcher-update-progress', { downloaded: i * 400_000, total: 12_000_000, percent: i / 30 * 100 }) }
      throw new Error('Update installation failed: signature verification failed (mock)')
    },
    get_install_status: async () => { await sleep(250); return { jre_installed: installed, minecraft_installed: installed, forge_installed: installed, jre_path: null } },
    fetch_manifest: async () => {
      await sleep(400)
      if (scenario === 'offline') throw new Error('error sending request for url (https://bscraft.zukashix.com/modpack/manifest.json)')
      return manifest
    },
    install_jre: async () => {
      emit('install-progress', { stage: 'jre', detail: 'Downloading Java 17 JRE…', percent: 5, files_done: 0, files_total: 1 })
      await download('jre', 'OpenJDK17U-jre_x64_windows_hotspot_17.0.12_7.zip', 'Downloading Java 17 JRE', 44_000_000, 2600)
      emit('install-progress', { stage: 'jre', detail: 'Extracting Java runtime…', percent: 90, files_done: 0, files_total: 1 })
      await sleep(600)
    },
    install_minecraft: async () => {
      // Same milestones as commands/install.rs, with each phase reporting its own 0-100%
      const mark = (percent, detail) => emit('install-progress', { stage: 'minecraft', detail, percent, files_done: 0, files_total: 1 })
      mark(2, 'Fetching version manifest…'); await sleep(200)
      mark(5, 'Downloading version metadata…'); await sleep(200)
      mark(10, 'Downloading Minecraft client…')
      await download('minecraft', '1.20.1.jar', 'Downloading Minecraft client', 23_000_000, 1600)
      mark(40, 'Downloading libraries…')
      for (let i = 1; i <= 20; i++) { await sleep(90); emit('install-progress', { stage: 'libraries', detail: 'Downloading libraries', percent: i * 5, files_done: i * 4, files_total: 80 }) }
      mark(70, 'Downloading game assets…')
      for (let i = 1; i <= 20; i++) { await sleep(90); emit('install-progress', { stage: 'assets', detail: 'Downloading game assets', percent: i * 5, files_done: i * 180, files_total: 3600 }) }
      mark(100, 'Minecraft installed')
    },
    install_forge: async () => {
      emit('install-progress', { stage: 'forge', detail: 'Downloading Forge installer…', percent: 5, files_done: 0, files_total: 1 })
      await download('forge', 'forge-1.20.1-47.4.10-installer.jar', 'Downloading Forge installer', 7_000_000, 900)
      emit('install-progress', { stage: 'forge', detail: 'Running Forge installer (this may take a few minutes)…', percent: 60, files_done: 0, files_total: 1 })
      await sleep(1400)
      emit('install-progress', { stage: 'forge', detail: 'Forge installed successfully', percent: 100, files_done: 1, files_total: 1 })
    },
    sync_modpack: async () => {
      const n = files.length
      for (let i = 1; i <= n; i += 7) { await sleep(25); emit('sync-progress', { stage: i % 3 ? 'downloading' : 'checking', file: files[i - 1].path, files_done: i, files_total: n, overall_percent: i / n * 100 }) }
      state.config.installed_modpack_version = manifest.modpack_version
      state.config.installed_mc_version = manifest.minecraft_version
      state.config.installed_forge_version = manifest.forge_version
      return { files_checked: n, files_updated: 0, files_added: n, files_removed: 0, errors: [] }
    },
    verify_all: async () => {
      emit('verify-progress', { step: 'jre', detail: 'Checking Java runtime…', percent: 10 })
      await sleep(300)
      emit('verify-progress', { step: 'minecraft', detail: 'Checking Minecraft client…', percent: 25 })
      await sleep(300)
      const n = files.length
      for (let i = 1; i <= n; i += 11) { await sleep(20); emit('verify-progress', { step: 'modpack', detail: `Checking ${i} / ${n} modpack files…`, percent: 50 + i / n * 50, files_done: i, files_total: n }) }
      return { jre_ok: true, minecraft_ok: true, forge_ok: true, modpack_total: n, modpack_passed: n - 6, modpack_failed: ['mods/create-1.20.1-0.5.1.f.jar', 'mods/jei-1.20.1-forge-15.3.0.4.jar', 'config/ad_astra.jsonc', 'mods/sodium-extra.jar', 'config/alexsmobs/anaconda_spawns.json', 'mods/embeddium-0.3.18.jar'], server_reachable: true }
    },
    repair_files: async ({ paths }) => {
      for (let i = 0; i < paths.length; i++) { await sleep(400); emit('sync-progress', { stage: 'repairing', file: paths[i], files_done: i + 1, files_total: paths.length, overall_percent: (i + 1) / paths.length * 100 }) }
    },
    apply_performance_mode: async () => { await sleep(700); return 'ok' },
    launch_game: async () => {
      await sleep(900)
      state.running = true
      let i = 0
      state.logTimer = setInterval(() => {
        emit('log-line', { line: LOG[i % LOG.length] })
        i++
      }, 140)
    },
    kill_game: async () => { mock.exitGame(1) },
    get_account_status: () => ({ password_set: !!state.password }),
    set_game_password: ({ password }) => {
      if ([...password].length < 4 || [...password].length > 64) throw new Error('Use between 4 and 64 characters.')
      state.password = password
    },
    reveal_game_password: () => state.password,
    check_server_account: async () => {
      await sleep(400)
      const sp = serverPassword()
      return { registered: sp !== null, valid: sp !== null && sp === state.password }
    },
    upload_texture: async ({ kind, model }) => {
      await sleep(700)
      checkAuth()
      return { kind, texture: 'mocktexturehash', model: kind === 'skin' ? model : null }
    },
    remove_texture: async () => { await sleep(400); checkAuth() },
    import_look: async ({ name }) => {
      await sleep(600)
      if (name.toLowerCase() === 'nobody') throw new Error(`No player called ${name} was found on BSCraft or Minecraft.`)
      return { name, source: 'mojang', model: 'slim', skin: await mockPng('skin'), cape: await mockPng('cape'), elytra: null }
    },
    get_skin_prefs: () => ({ ...state.prefs }),
    set_skin_prefs: async ({ prefs }) => { await sleep(80); state.prefsWrites = (state.prefsWrites || 0) + 1; console.log('set_skin_prefs', new Error().stack); state.prefs = { ...prefs }; return { ...state.prefs } },
    'plugin:opener|open_url': ({ url }) => { console.log('open_url', url) },
    get_game_status: () => ({ running: state.running }),
    // Live server status: ?srv=down|empty|busy (default: 3 players, including the mock user)
    server_status: async () => {
      await sleep(350)
      const srv = params.get('srv')
      if (srv === 'down') return { online: false, players_online: 0, players_max: 0, players: [], latency_ms: 0, version: '' }
      const names = srv === 'empty' ? [] : srv === 'busy'
        ? ['Akariyu', 'Blaze_Runner', 'Crafty', 'Dewdrop', 'Ember', 'Frostbyte', 'Gravel', 'Hazel', 'Ivy_', 'Jade', 'Kiln', 'Raxtray']
        : ['Akariyu', 'Raxtray', 'Zukashi']
      const online = srv === 'busy' ? 15 : names.length
      return { online: true, players_online: online, players_max: 20, players: names, latency_ms: 42, version: '1.20.1' }
    },
    get_log_lines: () => [],
    exit_app: () => { console.log('exit_app') },
  }

  const mock = {
    state,
    emit,
    exitGame(code) {
      clearInterval(state.logTimer)
      state.running = false
      emit('game-exited', { exit_code: code })
    },
  }
  window.__mock = mock

  const modules = {
    '@tauri-apps/api/core': {
      invoke: async (cmd, args) => {
        const h = handlers[cmd]
        if (!h) throw new Error(`mock: unknown command ${cmd}`)
        return h(args || {})
      },
    },
    '@tauri-apps/api/event': {
      listen: async (event, fn) => {
        if (!listeners.has(event)) listeners.set(event, [])
        listeners.get(event).push(fn)
        return () => { const l = listeners.get(event); const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1) }
      },
    },
    '@tauri-apps/api/app': { getVersion: async () => '1.0.0' },
    '@tauri-apps/api/window': {
      getCurrentWindow: () => ({
        minimize: async () => console.log('minimize'),
        close: async () => { if (state.running) emit('close-game-warning', null) },
      }),
    },
  }

  return { modules }
}
