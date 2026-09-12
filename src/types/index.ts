// ============================================================
// types/index.ts — Shared TypeScript interfaces mirroring Rust types
// ============================================================

export interface AppConfig {
  username: string;
  ram_mb: number;
  console_enabled: boolean;
  prefer_dgpu: boolean;
  performance_mode: boolean;
  installed_modpack_version: string | null;
  installed_mc_version: string | null;
  installed_forge_version: string | null;
}

export interface GpuInfo {
  name: string;
  vendor: string;
}

export interface ModpackManifest {
  modpack_version: string;
  minecraft_version: string;
  forge_version: string;
  java_version: number;
  files: ManifestFile[];
}

export interface ManifestFile {
  path: string;
  url: string;
  sha256: string;
  size: number;
  /** True = this file is removed when Performance Mode is ON */
  performance?: boolean;
}

export interface InstallStatus {
  jre_installed: boolean;
  minecraft_installed: boolean;
  forge_installed: boolean;
  jre_path: string | null;
}

export interface UpdateCheckResult {
  has_update: boolean;
  current_version: string;
  latest_version: string;
  notes: string | null;
}

export interface SyncResult {
  files_checked: number;
  files_updated: number;
  files_added: number;
  files_removed: number;
  errors: string[];
}

export interface VerifyResult {
  total: number;
  passed: number;
  failed: string[];
}

export interface VerifyAllResult {
  jre_ok: boolean;
  minecraft_ok: boolean;
  forge_ok: boolean;
  modpack_total: number;
  modpack_passed: number;
  modpack_failed: string[];
  server_reachable: boolean;
}

export interface GameStatus {
  running: boolean;
}

// ── Event payloads ──────────────────────────────────────────

export interface DownloadProgress {
  stage: string;
  file: string;
  detail: string;
  downloaded: number;
  total: number;
  speed_bps: number;
  percent: number;
}

export interface InstallProgress {
  stage: string;
  detail: string;
  percent: number;
  files_done: number;
  files_total: number;
}

export interface SyncProgress {
  stage: string;
  file: string;
  files_done: number;
  files_total: number;
  overall_percent: number;
}

export interface UpdateProgress {
  downloaded: number;
  total: number | null;
  percent: number;
}

export interface LogLine {
  line: string;
}

export interface GameExited {
  exit_code: number;
}

// ── UI state ────────────────────────────────────────────────

/** Drives the play button label and enabled state */
export type LauncherPhase =
  | 'init'            // First load, nothing checked yet
  | 'launcher-update' // Launcher update available (hard block)
  | 'updating-launcher' // Downloading launcher update
  | 'install'         // Runtime/MC/Forge not installed
  | 'installing'      // Currently installing
  | 'syncing'         // Modpack files downloading
  | 'ready'           // All good, can play
  | 'launching'       // Game process starting
  | 'running'         // Game is running
  | 'error';          // Something went wrong

export interface ActiveOperation {
  title: string;
  detail: string;
  file: string;
  filePercent: number;
  overallPercent: number;
  speedBps: number;
  filesDone: number;
  filesTotal: number;
}
