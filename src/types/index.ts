// ============================================================
// types/index.ts — Shared TypeScript interfaces mirroring Rust types
// ============================================================

export interface AppConfig {
  username: string;
  ram_mb: number;
  console_enabled: boolean;
  prefer_dgpu: boolean;
  performance_mode: boolean;
  /** Start the game straight into the BSCraft server */
  auto_join: boolean;
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
  /** Installed only when missing (e.g. the pack's default options.txt) */
  initial_files?: ManifestFile[];
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

export interface VerifyProgress {
  step: string;
  detail: string;
  percent: number;
  files_done?: number;
  files_total?: number;
}

// ── UI state ────────────────────────────────────────────────

export type Page = 'home' | 'console' | 'profile' | 'settings';

/** Mirrors commands::account::AccountStatus */
export interface AccountStatus {
  password_set: boolean;
}

/** Mirrors commands::account::ServerAccount */
export interface ServerAccount {
  /** The name has joined the server once and claimed a password */
  registered: boolean;
  /** The password saved on this PC matches the server's */
  valid: boolean;
}

/** Mirrors commands::account::TextureUploadResult */
export interface TextureUploadResult {
  kind: 'skin' | 'cape' | 'elytra';
  texture: string;
  model: 'default' | 'slim' | null;
}

/** Mirrors commands::account::ImportedLook — another player's textures as PNG bytes */
export interface ImportedLook {
  name: string;
  source: 'bscraft' | 'mojang';
  skin: number[] | null;
  model: 'default' | 'slim';
  cape: number[] | null;
  elytra: number[] | null;
}

/** Mirrors commands::account::SkinPrefs — Minecraft's Skin Customization (options.txt) */
export interface SkinPrefs {
  cape: boolean;
  jacket: boolean;
  left_sleeve: boolean;
  right_sleeve: boolean;
  left_pants_leg: boolean;
  right_pants_leg: boolean;
  hat: boolean;
  main_hand: 'left' | 'right';
}

/** Drives the play button label and enabled state (game running is tracked separately) */
export type LaunchStatus =
  | 'init'       // First load, nothing checked yet
  | 'offline'    // Not installed and the server is unreachable
  | 'ready'      // Can install / play
  | 'busy'       // Installing, updating or syncing
  | 'launching'  // Game process starting
  | 'error';     // Last action failed — next click re-runs startup checks

export type OperationKind =
  | 'install'
  | 'modpack-update'
  | 'launcher-update'
  | 'check'
  | 'verify'
  | 'repair';

export interface ActiveOperation {
  kind: OperationKind;
  title: string;
  detail: string;
  file: string;
  filePercent: number;
  overallPercent: number;
  speedBps: number;
  filesDone: number;
  filesTotal: number;
  bytesDone: number;
  bytesTotal: number;
  /** 1-based step within a multi-step flow; 0 = no step indicator */
  step: number;
  stepCount: number;
  /** No meaningful percentage yet */
  indeterminate: boolean;
}

export interface TaskResult {
  state: 'busy' | 'done' | 'error';
  message: string;
}

export interface ErrorInfo {
  message: string;
  context: string;
}

export type LogLevel = 'info' | 'warn' | 'error' | 'debug' | 'plain';

export interface LogEntry {
  id: number;
  raw: string;
  time: string;
  thread: string;
  level: LogLevel;
  source: string;
  message: string;
}

export interface Toast {
  id: number;
  tone: 'success' | 'error' | 'info';
  title: string;
  body?: string;
  action?: { label: string; onClick: () => void };
}
