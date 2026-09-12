// ============================================================
// commands/settings.rs — Config read/write + system info
// ============================================================

use dirs;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use sysinfo::System;

// ── Config schema ──────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppConfig {
    /// Minecraft offline username.
    #[serde(default)]
    pub username: String,

    /// RAM to allocate in MB. Defaults to 50% of system RAM.
    #[serde(default = "default_ram")]
    pub ram_mb: u32,

    /// Whether the in-launcher console view is enabled.
    #[serde(default)]
    pub console_enabled: bool,

    /// Prefer the high-performance GPU for Minecraft (Windows only).
    #[serde(default = "default_prefer_dgpu")]
    pub prefer_dgpu: bool,

    /// Enable Performance Mode: moves flagged mods to a backup folder before launch.
    #[serde(default)]
    pub performance_mode: bool,

    /// Start the game straight into the BSCraft server (Minecraft's quick play).
    #[serde(default = "default_true")]
    pub auto_join: bool,

    /// Modpack version string last successfully installed (e.g. "1.0.5").
    #[serde(default)]
    pub installed_modpack_version: Option<String>,

    /// Minecraft version last successfully installed (e.g. "1.20.1").
    #[serde(default)]
    pub installed_mc_version: Option<String>,

    /// Forge version last successfully installed (e.g. "47.3.0").
    #[serde(default)]
    pub installed_forge_version: Option<String>,
}

fn default_ram() -> u32 {
    2048
}

fn default_prefer_dgpu() -> bool {
    true
}

fn default_true() -> bool {
    true
}

impl Default for AppConfig {
    fn default() -> Self {
        let ram_mb = detect_default_ram();
        Self {
            username: String::new(),
            ram_mb,
            console_enabled: false,
            prefer_dgpu: default_prefer_dgpu(),
            performance_mode: false,
            auto_join: true,
            installed_modpack_version: None,
            installed_mc_version: None,
            installed_forge_version: None,
        }
    }
}

// ── GPU detection ─────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Clone)]
pub struct GpuInfo {
    pub name: String,
    pub vendor: String,
}

#[cfg(target_os = "windows")]
#[derive(Deserialize, Debug)]
#[allow(non_snake_case)] // WMI property names are PascalCase
struct Win32VideoController {
    Name: Option<String>,
    AdapterCompatibility: Option<String>,
}

#[cfg(target_os = "windows")]
fn get_gpus_windows() -> Result<Vec<GpuInfo>, String> {
    let com_con = wmi::COMLibrary::new().map_err(|e| e.to_string())?;
    let wmi_con = wmi::WMIConnection::new(com_con.into()).map_err(|e| e.to_string())?;
    let results: Vec<Win32VideoController> = wmi_con.query().map_err(|e| e.to_string())?;

    let mut gpus = Vec::new();
    for item in results {
        let name = item.Name.unwrap_or_default();
        if name.trim().is_empty() {
            continue;
        }
        let vendor = item.AdapterCompatibility.unwrap_or_default();
        gpus.push(GpuInfo { name, vendor });
    }

    Ok(gpus)
}

#[cfg(not(target_os = "windows"))]
fn get_gpus_windows() -> Result<Vec<GpuInfo>, String> {
    Ok(Vec::new())
}

/// Returns 50% of total system RAM, clamped between 2 GB and 16 GB.
fn detect_default_ram() -> u32 {
    let mut sys = System::new();
    sys.refresh_memory();
    let total_mb = (sys.total_memory() / 1024 / 1024) as u32;
    let half = total_mb / 2;
    half.clamp(2048, 16384)
}

// ── Path helpers ───────────────────────────────────────────────────────────

pub fn get_data_dir() -> Result<PathBuf, String> {
    dirs::data_dir()
        .ok_or_else(|| "Cannot locate %APPDATA% directory".to_string())
        .map(|d| d.join("BSCraft"))
}

pub fn get_config_path() -> Result<PathBuf, String> {
    get_data_dir().map(|d| d.join("config.json"))
}

// ── Internal helpers (used by other command modules) ───────────────────────

pub fn load_config_internal() -> Result<AppConfig, String> {
    let path = get_config_path()?;
    if !path.exists() {
        return Ok(AppConfig::default());
    }
    let raw = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read config.json: {}", e))?;
    serde_json::from_str(&raw)
        .map_err(|e| format!("Failed to parse config.json: {}", e))
}

pub fn save_config_internal(config: &AppConfig) -> Result<(), String> {
    let path = get_config_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create config directory: {}", e))?;
    }
    let raw = serde_json::to_string_pretty(config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;
    std::fs::write(&path, raw)
        .map_err(|e| format!("Failed to write config.json: {}", e))
}

// ── Tauri commands ─────────────────────────────────────────────────────────

/// Returns the current launcher config. Creates a default one if missing.
#[tauri::command]
pub async fn get_config() -> Result<AppConfig, String> {
    load_config_internal()
}

/// Persists the launcher config to disk.
#[tauri::command]
pub async fn save_config(config: AppConfig) -> Result<(), String> {
    save_config_internal(&config)
}

/// Returns total system RAM in MB (used to drive the RAM slider max).
#[tauri::command]
pub async fn get_system_ram() -> Result<u32, String> {
    let mut sys = System::new();
    sys.refresh_memory();
    Ok((sys.total_memory() / 1024 / 1024) as u32)
}

/// Returns a best-effort list of detected GPUs (Windows only for now).
/// Runs in a blocking thread because WMI COM is thread-affine.
#[tauri::command]
pub async fn get_gpus() -> Result<Vec<GpuInfo>, String> {
    tokio::task::spawn_blocking(get_gpus_windows)
        .await
        .map_err(|e| e.to_string())?
}

/// Writes an error report to %AppData%\BSCraft\logs\ and returns the file path.
/// Called from the frontend whenever a launch or install error occurs.
#[tauri::command]
pub async fn write_error_report(context: String, message: String) -> Result<String, String> {
    let data_dir = get_data_dir()?;
    let logs_dir = data_dir.join("logs");
    std::fs::create_dir_all(&logs_dir)
        .map_err(|e| format!("Cannot create logs dir: {}", e))?;

    // Timestamp in seconds since epoch (no chrono dependency needed)
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    let filename = format!("error_{}.log", ts);
    let path = logs_dir.join(&filename);

    let content = format!(
        "BSCraft Launcher — Error Report\n\
         ================================\n\
         Context : {}\n\
         Time    : {} (Unix epoch s)\n\
         \n\
         --- Error Message ---\n\
         {}\n",
        context, ts, message
    );

    std::fs::write(&path, content)
        .map_err(|e| format!("Cannot write error report: {}", e))?;

    Ok(path.to_string_lossy().to_string())
}
