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

    /// RAM to allocate in MB. On automatic it's whatever suits this PC (see `memory_plan`).
    #[serde(default = "default_ram")]
    pub ram_mb: u32,

    /// Memory follows `memory_plan` until the player picks an amount themselves.
    /// Missing (configs from before 1.1.4) counts as automatic.
    #[serde(default)]
    pub ram_auto: Option<bool>,

    /// Whether the in-launcher console view is enabled.
    #[serde(default)]
    pub console_enabled: bool,

    /// Prefer the high-performance GPU for Minecraft (Windows only: macOS switches by itself).
    #[serde(default = "default_prefer_dgpu")]
    pub prefer_dgpu: bool,

    /// Enable Performance Mode: moves flagged mods to a backup folder before launch.
    #[serde(default)]
    pub performance_mode: bool,

    /// Start the game straight into the BSCraft server (Minecraft's quick play);
    /// off means it starts at the main menu.
    #[serde(default)]
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
    memory_plan().recommended_mb
}

fn default_prefer_dgpu() -> bool {
    true
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            username: String::new(),
            ram_mb: memory_plan().recommended_mb,
            ram_auto: Some(true),
            console_enabled: false,
            prefer_dgpu: default_prefer_dgpu(),
            performance_mode: false,
            auto_join: false,
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
#[serde(rename = "Win32_VideoController")] // the WMI class queried; the struct name alone isn't it
#[allow(non_snake_case)] // WMI property names are PascalCase
struct Win32VideoController {
    Name: Option<String>,
    AdapterCompatibility: Option<String>,
}

#[cfg(target_os = "windows")]
fn detect_gpus() -> Result<Vec<GpuInfo>, String> {
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

/// The Mac's graphics as System Information lists them (Apple silicon's built-in GPU, or an
/// Intel Mac's Intel graphics and AMD Radeon card)
#[cfg(target_os = "macos")]
fn detect_gpus() -> Result<Vec<GpuInfo>, String> {
    let output = std::process::Command::new("/usr/sbin/system_profiler")
        .args(["SPDisplaysDataType", "-json", "-detailLevel", "mini"])
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(format!("system_profiler exited with {}", output.status));
    }
    parse_mac_displays(&output.stdout)
}

#[cfg(any(target_os = "macos", test))]
fn parse_mac_displays(json: &[u8]) -> Result<Vec<GpuInfo>, String> {
    let v: serde_json::Value = serde_json::from_slice(json).map_err(|e| e.to_string())?;
    let mut gpus = Vec::new();
    for item in v["SPDisplaysDataType"].as_array().into_iter().flatten() {
        let name = item["sppci_model"].as_str().unwrap_or_default().trim().to_string();
        if name.is_empty() {
            continue;
        }
        // "sppci_vendor_Apple", "sppci_vendor_amd" or "Intel (0x8086)"
        let raw = item["spdisplays_vendor"].as_str().unwrap_or_default();
        let raw = raw.strip_prefix("sppci_vendor_").unwrap_or(raw);
        let raw = raw.split(" (0x").next().unwrap_or(raw).trim();
        let vendor = match raw.to_ascii_lowercase().as_str() {
            "amd" | "ati" => "AMD".to_string(),
            "nvidia" => "NVIDIA".to_string(),
            "intel" => "Intel".to_string(),
            "apple" => "Apple".to_string(),
            _ => raw.to_string(),
        };
        gpus.push(GpuInfo { name, vendor });
    }
    Ok(gpus)
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn detect_gpus() -> Result<Vec<GpuInfo>, String> {
    Ok(Vec::new())
}

// ── Memory plan ───────────────────────────────────────────────────────────
//
// Measured on pack 4.0.3 with Java 21 (2026-09-14, 16 GB laptop with Intel graphics,
// singleplayer, sprinting through new terrain): once in a world the heap holds about
// 4 GB after each clean-up, peaking near 5.5 GB between them, and the game uses about
// 2 GB more outside the heap (Java itself, Distant Horizons, the graphics driver).
// More heap than it needs doesn't make it faster: each clean-up just has more to go
// through, and the memory it takes away from Windows gets swapped to disk. Both show
// up as hitches, the "too much RAM is laggy" everyone notices.

// What big packs of this size tell players (checked 2026-09-14): at least 6 GB (Enigmatica,
// FTB, DawnCraft), 8 GB on a 16 GB PC (Enigmatica: "max 8" there), 8-12 on bigger PCs
// (DawnCraft, All the Mods), and no more than 10-12 (FTB, All the Mods).

/// What the pack needs; the manifest's optional `memory` block can change it without a launcher release
#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq)]
pub struct PackMemory {
    /// Below this the heap is barely above what the pack holds: constant clean-ups, then crashes
    pub min_mb: u32,
    /// Room for big bases, busy areas and joining the server, with nothing wasted
    pub recommended_mb: u32,
    /// The same on PCs with plenty of memory (24 GB or more): more room for Distant Horizons
    pub recommended_large_mb: u32,
    /// Past this the pack can't use it, and clean-ups get longer
    pub max_useful_mb: u32,
}

impl Default for PackMemory {
    fn default() -> Self {
        PackMemory { min_mb: 6 * 1024, recommended_mb: 8 * 1024, recommended_large_mb: 10 * 1024, max_useful_mb: 12 * 1024 }
    }
}

/// PCs with at least this much memory get `recommended_large_mb` (24 GB ones report a bit under)
const LARGE_PC_MB: u32 = 23 * 1024;
/// Kept for everything but the heap: Windows and what people keep open alongside
/// (a browser, Discord), plus the game's own memory outside the heap
const RESERVE_MB: u32 = 7 * 1024;
/// The least Windows and the game's non-heap memory can manage with
const HARD_RESERVE_MB: u32 = 5632;
/// Integrated graphics keep their textures in main memory as well
const INTEGRATED_GPU_MB: u32 = 1536;

#[derive(Debug, Serialize, Clone, Copy)]
pub struct MemoryPlan {
    pub total_mb: u32,
    /// No dedicated graphics card found (or none could be checked)
    pub integrated_gpu: bool,
    /// What automatic uses: the most that helps, that this PC can spare
    pub recommended_mb: u32,
    /// Less than this is too little for the pack
    pub min_mb: u32,
    /// More than this doesn't help, and makes pauses longer
    pub max_useful_mb: u32,
    /// More than this leaves Windows too little and it starts swapping
    pub safe_max_mb: u32,
}

/// Whole gigabytes, rounded down
fn whole_gb(mb: u32) -> u32 {
    mb / 1024 * 1024
}

pub fn plan_for(total_mb: u32, integrated_gpu: bool, pack: PackMemory) -> MemoryPlan {
    let gpu = if integrated_gpu { INTEGRATED_GPU_MB } else { 0 };
    let room = whole_gb(total_mb.saturating_sub(RESERVE_MB + gpu));
    let best = if total_mb >= LARGE_PC_MB { pack.recommended_large_mb } else { pack.recommended_mb };
    let recommended_mb = room.clamp(4 * 1024, best.max(4 * 1024));
    let safe_max_mb = whole_gb(total_mb.saturating_sub(HARD_RESERVE_MB + gpu / 2)).max(recommended_mb);
    MemoryPlan { total_mb, integrated_gpu, recommended_mb, min_mb: pack.min_mb, max_useful_mb: pack.max_useful_mb, safe_max_mb }
}

/// A graphics card with its own memory, going by its name
fn is_dedicated_gpu(name: &str) -> bool {
    let n = name.to_ascii_lowercase();
    ["nvidia", "geforce", "quadro", "rtx", "gtx", "radeon rx", "radeon pro", "firepro"].iter().any(|k| n.contains(k))
        || n.contains(" rx ")
        // Intel Arc A-series cards (A380, A770...), not the Arc graphics built into Core Ultra chips
        || n.split(|c: char| !c.is_ascii_alphanumeric()).any(|w| w.len() == 4 && w.starts_with('a') && w[1..].chars().all(|c| c.is_ascii_digit())) && n.contains("arc")
}

/// The pack's memory needs, from the last manifest (or the built-in ones), kept in memory
static PACK: std::sync::RwLock<Option<PackMemory>> = std::sync::RwLock::new(None);

/// A new manifest arrived; its `memory` block (if any) applies from now on
pub fn set_pack_memory(pack: Option<PackMemory>) {
    if let Ok(mut p) = PACK.write() {
        *p = Some(pack.unwrap_or_default());
    }
}

fn pack_memory() -> PackMemory {
    if let Some(p) = PACK.read().ok().and_then(|p| *p) {
        return p;
    }
    let p = crate::commands::modpack::cached_pack_memory().unwrap_or_default();
    set_pack_memory(Some(p));
    p
}

/// This PC's plan: RAM and graphics cards are looked at once (they don't change while it
/// runs), the pack's needs each time (a modpack update can change them)
pub fn memory_plan() -> MemoryPlan {
    static PC: std::sync::OnceLock<(u32, bool)> = std::sync::OnceLock::new();
    let (total_mb, integrated) = *PC.get_or_init(|| {
        let mut sys = System::new();
        sys.refresh_memory();
        let total_mb = (sys.total_memory() / 1024 / 1024) as u32;
        // WMI wants a thread of its own (COM); unknown counts as integrated, the careful guess.
        // Apple silicon's GPU shares the Mac's memory, so it counts as integrated too.
        let integrated = std::thread::spawn(detect_gpus)
            .join()
            .ok()
            .and_then(Result::ok)
            .map(|gpus| !gpus.iter().any(|g| is_dedicated_gpu(&g.name)))
            .unwrap_or(true);
        (total_mb, integrated)
    });
    plan_for(total_mb, integrated, pack_memory())
}

// ── Path helpers ───────────────────────────────────────────────────────────

pub fn get_data_dir() -> Result<PathBuf, String> {
    dirs::data_dir()
        .ok_or_else(|| "Cannot locate the application data folder".to_string())
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
    let mut config: AppConfig = serde_json::from_str(&raw)
        .map_err(|e| format!("Failed to parse config.json: {}", e))?;
    if config.ram_auto != Some(false) {
        config.ram_auto = Some(true);
        config.ram_mb = memory_plan().recommended_mb;
    }
    Ok(config)
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

/// How much memory suits this PC and the pack, and where too little or too much begins
#[tauri::command]
pub async fn get_memory_plan() -> Result<MemoryPlan, String> {
    tokio::task::spawn_blocking(memory_plan).await.map_err(|e| e.to_string())
}

/// Returns a best-effort list of detected GPUs (WMI on Windows, System Information on macOS).
/// Runs in a blocking thread because WMI COM is thread-affine and system_profiler takes a moment.
#[tauri::command]
pub async fn get_gpus() -> Result<Vec<GpuInfo>, String> {
    tokio::task::spawn_blocking(detect_gpus)
        .await
        .map_err(|e| e.to_string())?
}

/// Writes an error report to <data dir>/BSCraft/logs/ and returns the file path.
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

#[cfg(test)]
mod tests {
    use super::{is_dedicated_gpu, plan_for, PackMemory};

    const GB: u32 = 1024;

    #[test]
    fn plans_memory_for_common_pcs() {
        let pack = PackMemory::default();
        // (installed, integrated graphics) -> recommended
        for (total, integrated, want) in [
            (16_062, true, 7 * GB),   // this laptop: 15.7 GB, Intel Iris Xe
            (16_300, false, 8 * GB),  // 16 GB with a graphics card
            (24_400, false, 10 * GB), // plenty: room for Distant Horizons
            (32_600, false, 10 * GB),
            (65_000, true, 10 * GB),  // but no more than the pack can use
            (12_000, true, 4 * GB),   // short on memory: the least that runs
            (8_000, true, 4 * GB),
        ] {
            let p = plan_for(total, integrated, pack);
            assert_eq!(p.recommended_mb, want, "{total} MB, integrated {integrated}");
            assert!(p.safe_max_mb >= p.recommended_mb);
            assert!(p.recommended_mb <= p.max_useful_mb);
        }
        assert_eq!(plan_for(16_062, true, pack).safe_max_mb, 9 * GB);
        assert_eq!(plan_for(32_600, false, pack).safe_max_mb, 26 * GB);
    }

    #[test]
    fn a_heavier_pack_can_ask_for_more() {
        let heavy = PackMemory { min_mb: 7 * GB, recommended_mb: 9 * GB, recommended_large_mb: 12 * GB, max_useful_mb: 14 * GB };
        assert_eq!(plan_for(20_000, false, heavy).recommended_mb, 9 * GB);
        assert_eq!(plan_for(32_600, false, heavy).recommended_mb, 12 * GB);
        // Still never more than the PC can spare
        assert_eq!(plan_for(16_300, false, heavy).recommended_mb, 8 * GB);
        assert_eq!(plan_for(16_062, true, heavy).recommended_mb, 7 * GB);
        let p = plan_for(32_600, false, heavy);
        assert_eq!((p.min_mb, p.max_useful_mb), (7 * GB, 14 * GB));
    }

    #[test]
    fn reads_mac_graphics_from_system_information() {
        let apple_silicon = br#"{"SPDisplaysDataType":[{"_name":"kHW_AppleM1Item","sppci_model":"Apple M1","spdisplays_vendor":"sppci_vendor_Apple","sppci_cores":"8"}]}"#;
        let gpus = super::parse_mac_displays(apple_silicon).unwrap();
        assert_eq!((gpus[0].name.as_str(), gpus[0].vendor.as_str()), ("Apple M1", "Apple"));
        assert!(!is_dedicated_gpu(&gpus[0].name));

        let intel_mac = br#"{"SPDisplaysDataType":[{"sppci_model":"Intel UHD Graphics 630","spdisplays_vendor":"Intel (0x8086)"},{"sppci_model":"AMD Radeon Pro 5500M","spdisplays_vendor":"sppci_vendor_amd"},{"_name":"no model"}]}"#;
        let gpus = super::parse_mac_displays(intel_mac).unwrap();
        assert_eq!(gpus.len(), 2);
        assert_eq!(gpus[0].vendor, "Intel");
        assert_eq!(gpus[1].vendor, "AMD");
        assert!(!is_dedicated_gpu(&gpus[0].name) && is_dedicated_gpu(&gpus[1].name));
    }

    #[test]
    fn tells_graphics_cards_from_built_in_graphics() {
        for card in ["NVIDIA GeForce RTX 3060 Laptop GPU", "AMD Radeon RX 6600 XT", "Intel(R) Arc(TM) A770 Graphics", "NVIDIA Quadro P1000"] {
            assert!(is_dedicated_gpu(card), "{card}");
        }
        for built_in in ["Intel(R) Iris(R) Xe Graphics", "AMD Radeon(TM) Graphics", "Intel(R) Arc(TM) Graphics", "Intel(R) UHD Graphics 620", "Radeon Vega 8 Graphics"] {
            assert!(!is_dedicated_gpu(built_in), "{built_in}");
        }
    }
}
