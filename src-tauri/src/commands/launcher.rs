// ============================================================
// commands/launcher.rs — Game launch, log streaming, process control
// ============================================================

use crate::commands::install::{get_mc_dir, hidden_command, java_for_pack};
use crate::commands::settings::load_config_internal;
use crate::constants::{GAME_SERVER_ADDRESS, GAME_SERVER_NAME, LAUNCHER_NAME, LAUNCHER_VERSION, OLD_GAME_SERVER_ADDRESSES};
use crate::state::AppState;
use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;
use tauri::{Emitter, Manager, State};
use tokio::io::{AsyncBufReadExt, AsyncRead, BufReader};

// ── Types ──────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Clone)]
pub struct GameStatus {
    pub running: bool,
}

#[derive(Debug, Serialize, Clone)]
pub struct LogLine {
    pub line: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct GameExited {
    pub exit_code: i32,
}

// ── Tauri commands ─────────────────────────────────────────────────────────

/// Launches Minecraft with Forge using the configured username and RAM allocation.
/// Reads the Forge version JSON to construct the exact JVM + game argument list.
/// Spawns a background task that streams logs via `log-line` events and emits
/// `game-exited` when the process ends.
#[tauri::command]
pub async fn launch_game(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    username: String,
    ram_mb: u32,
) -> Result<(), String> {
    // Guard: prevent double-launch
    {
        let proc = state.game_process.lock().unwrap();
        if proc.is_some() {
            return Err("Minecraft is already running".to_string());
        }
    }

    if username.trim().is_empty() {
        return Err("Username cannot be empty".to_string());
    }

    let config = load_config_internal()?;

    let mc_version = config
        .installed_mc_version
        .as_ref()
        .ok_or("Minecraft not installed")?
        .clone();
    let forge_version = config
        .installed_forge_version
        .as_ref()
        .ok_or("Forge not installed")?
        .clone();

    let mc_dir = get_mc_dir()?;
    let java_exe = java_for_pack()?;

    if config.prefer_dgpu {
        if let Err(err) = set_high_performance_gpu_preference(&java_exe) {
            eprintln!("GPU preference not applied: {}", err);
        }
    }

    let version_id = format!("{}-forge-{}", mc_version, forge_version);

    // Build the full launch command
    let mut cmd = build_launch_command(
        &java_exe,
        &mc_dir,
        &version_id,
        &mc_version,
        &username,
        ram_mb,
    )?;

    // BSCraft is always in the multiplayer list; with auto-join the game goes straight there
    if let Err(err) = crate::servers_dat::ensure_server_listed(&mc_dir, GAME_SERVER_NAME, GAME_SERVER_ADDRESS, OLD_GAME_SERVER_ADDRESSES) {
        eprintln!("Server list not updated: {}", err);
    }
    if config.auto_join {
        cmd.arg("--quickPlayMultiplayer").arg(GAME_SERVER_ADDRESS);
    }

    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());
    cmd.current_dir(&mc_dir);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn Minecraft: {}", e))?;

    // Take stdout and stderr handles before moving child into state
    let stdout = child
        .stdout
        .take()
        .ok_or("Failed to capture Minecraft stdout")?;
    let stderr = child
        .stderr
        .take()
        .ok_or("Failed to capture Minecraft stderr")?;

    // Store child in shared state
    {
        let mut proc = state.game_process.lock().unwrap();
        *proc = Some(child);
    }

    // Clear previous log buffer
    {
        let mut logs = state.log_lines.lock().unwrap();
        logs.clear();
    }

    // Stream the game's output to the console, and separately watch the process itself:
    // the output ending (or containing odd bytes) doesn't mean the game has stopped.
    tokio::spawn(pump_output(app.clone(), stdout));
    tokio::spawn(pump_output(app.clone(), stderr));
    tokio::spawn(watch_exit(app.clone()));

    Ok(())
}

/// Forwards one output stream line by line. Mods print in the system code page
/// (e.g. Ok Zoomer's "úwù"), so lines that aren't UTF-8 are read as Windows-1252/Latin-1
/// instead of ending the stream.
async fn pump_output<R: AsyncRead + Unpin>(app: tauri::AppHandle, stream: R) {
    let mut reader = BufReader::new(stream);
    let mut buf = Vec::new();
    loop {
        buf.clear();
        match reader.read_until(b'\n', &mut buf).await {
            Ok(0) | Err(_) => break,
            Ok(_) => {
                let line = decode_line(&buf);
                push_log(&app, line.trim_end_matches(['\r', '\n']));
            }
        }
    }
}

fn decode_line(bytes: &[u8]) -> String {
    match std::str::from_utf8(bytes) {
        Ok(s) => s.to_string(),
        Err(_) => bytes.iter().map(|&b| b as char).collect(),
    }
}

/// Emits `game-exited` once the game process ends, or once Stop took it away (kill_game).
async fn watch_exit(app: tauri::AppHandle) {
    let exit_code = loop {
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        let state = app.state::<AppState>();
        let mut proc = state.game_process.lock().unwrap();
        let Some(child) = proc.as_mut() else { break -1 };
        match child.try_wait() {
            Ok(None) => continue,
            Ok(Some(status)) => {
                *proc = None;
                break status.code().unwrap_or(-1);
            }
            Err(_) => {
                *proc = None;
                break -1;
            }
        }
    };
    app.emit("game-exited", GameExited { exit_code }).ok();
}

/// Sends SIGKILL to the Minecraft process if it is running.
#[tauri::command]
pub async fn kill_game(state: State<'_, AppState>) -> Result<(), String> {
    // Take the child out of the mutex *before* awaiting kill,
    // so we don't hold a MutexGuard across an .await point.
    let child_opt = {
        let mut proc = state.game_process.lock().unwrap();
        proc.take()
    };
    if let Some(mut child) = child_opt {
        child
            .kill()
            .await
            .map_err(|e| format!("Failed to kill Minecraft: {}", e))?;
    }
    Ok(())
}

/// Kills any running Minecraft process then exits the launcher.
/// Called by the frontend close-warning modal when the user confirms close.
#[tauri::command]
pub async fn exit_app(state: State<'_, AppState>, app: tauri::AppHandle) -> Result<(), String> {
    let child_opt = {
        let mut proc = state.game_process.lock().unwrap();
        proc.take()
    };
    if let Some(mut child) = child_opt {
        child.kill().await.ok(); // best-effort
    }
    app.exit(0);
    Ok(())
}


/// Returns whether Minecraft is currently running.
#[tauri::command]
pub fn get_game_status(state: State<'_, AppState>) -> GameStatus {
    let proc = state.game_process.lock().unwrap();
    GameStatus { running: proc.is_some() }
}

/// Returns all buffered log lines (for initial Console render).
/// New lines come in via `log-line` events.
#[tauri::command]
pub fn get_log_lines(state: State<'_, AppState>) -> Vec<String> {
    state.log_lines.lock().unwrap().clone()
}

// ── Launch command builder ─────────────────────────────────────────────────

fn build_launch_command(
    java_exe: &Path,
    mc_dir: &Path,
    version_id: &str,
    mc_version: &str,
    username: &str,
    ram_mb: u32,
) -> Result<tokio::process::Command, String> {
    // Read Forge version JSON
    let forge_json = read_version_json(mc_dir, version_id)?;

    // If the version inherits from vanilla, read the parent too
    let parent_id = forge_json["inheritsFrom"].as_str().unwrap_or("");
    let vanilla_json: Option<serde_json::Value> = if !parent_id.is_empty() {
        Some(read_version_json(mc_dir, parent_id)?)
    } else {
        None
    };

    // Determine asset index ID
    let asset_index = forge_json["assetIndex"]["id"]
        .as_str()
        .or_else(|| {
            vanilla_json
                .as_ref()
                .and_then(|v| v["assetIndex"]["id"].as_str())
        })
        .unwrap_or(mc_version)
        .to_string();

    // Build classpath from all libraries
    let classpath = build_classpath(
        mc_dir,
        version_id,
        parent_id,
        &forge_json,
        vanilla_json.as_ref(),
    )?;

    // Offline UUID
    let uuid = offline_uuid(username);

    // Template variable map — "legacy" userType is correct for offline/cracked
    let natives_dir = mc_dir.join("natives");
    let mut vars: HashMap<String, String> = HashMap::new();
    vars.insert("natives_directory".into(), path_str(&natives_dir));
    vars.insert("library_directory".into(), path_str(&mc_dir.join("libraries")));
    vars.insert("classpath_separator".into(), ";".into()); // Windows
    vars.insert("launcher_name".into(), LAUNCHER_NAME.into());
    vars.insert("launcher_version".into(), LAUNCHER_VERSION.into());
    vars.insert("auth_player_name".into(), username.to_string());
    vars.insert("auth_uuid".into(), uuid.clone());
    vars.insert("auth_access_token".into(), "0".into());
    vars.insert("auth_session".into(), "0".into());
    vars.insert("user_type".into(), "legacy".into());
    vars.insert("user_properties".into(), "{}".into());
    vars.insert("profile_name".into(), username.to_string());
    vars.insert("version_name".into(), version_id.to_string());
    vars.insert("game_directory".into(), path_str(mc_dir));
    vars.insert("assets_root".into(), path_str(&mc_dir.join("assets")));
    vars.insert("game_assets".into(), path_str(&mc_dir.join("assets")));
    vars.insert("assets_index_name".into(), asset_index.clone());
    vars.insert("version_type".into(), "release".into());
    vars.insert("classpath".into(), classpath.clone());
    // Optional / resolution vars — leave blank so they get filtered out
    vars.insert("resolution_width".into(), "".into());
    vars.insert("resolution_height".into(), "".into());
    vars.insert("quickPlayPath".into(), "".into());
    vars.insert("quickPlaySingleplayer".into(), "".into());
    vars.insert("quickPlayMultiplayer".into(), "".into());
    vars.insert("quickPlayRealms".into(), "".into());
    vars.insert("clientid".into(), "".into());
    vars.insert("auth_xuid".into(), "".into());

    let mut cmd = hidden_command(java_exe);

    // ── JVM arguments ──────────────────────────────────────────
    //
    // CRITICAL: --add-opens appears multiple times with DIFFERENT values.
    // We must NEVER deduplicate by the flag token alone — that strips the flag
    // while leaving the value, which makes Java treat the orphaned value as
    // the main class.
    //
    // Strategy:
    //   1. Add Forge JVM args verbatim (they include all --add-opens, -p, etc.)
    //   2. Add vanilla JVM args for tokens NOT already emitted by Forge
    //      (checked per full resolved string, so --add-opens dedup is safe
    //       as long as the full "--add-opens X" pair is the unit — handled below)
    //   3. Add -cp <classpath> only if ${classpath} wasn't already in the JSON args

    cmd.arg(format!("-Xms512m"));
    cmd.arg(format!("-Xmx{}m", ram_mb));

    let forge_jvm_raw = collect_string_args(&forge_json["arguments"]["jvm"]);
    let vanilla_jvm_raw = vanilla_json
        .as_ref()
        .map(|v| collect_string_args(&v["arguments"]["jvm"]))
        .unwrap_or_default();

    // Resolve all tokens upfront
    let mut forge_jvm: Vec<String> = forge_jvm_raw
        .iter()
        .map(|a| substitute(a, &vars))
        .filter(|a| !a.contains("${") && !a.is_empty())
        .collect();

    // ── Fix Forge's -DignoreList ────────────────────────────────
    // Forge 47.x ships: -DignoreList=...,${version_name}.jar
    // ${version_name} = "1.20.1-forge-47.4.10" (the Forge version id).
    // The vanilla client JAR "1.20.1.jar" is NOT in the list, so
    // BootstrapLauncher promotes it to auto-module "_1._20._1", which
    // conflicts with Forge's own "minecraft" module when mods (like JADE)
    // open exports from it.
    //
    // Fix: append "<mc_version>.jar" to the existing -DignoreList entry.
    let vanilla_jar_name = format!("{}.jar", mc_version);
    let ignore_prefix = "-DignoreList=";
    let mut found_ignore_list = false;
    for tok in forge_jvm.iter_mut() {
        if tok.starts_with(ignore_prefix) {
            found_ignore_list = true;
            if !tok.contains(&vanilla_jar_name) {
                tok.push(',');
                tok.push_str(&vanilla_jar_name);
            }
            break;
        }
    }
    if !found_ignore_list {
        // Forge JSON didn't have one — add it ourselves
        forge_jvm.insert(0, format!("{}{}", ignore_prefix, vanilla_jar_name));
    }

    // Track every resolved token Forge emits (for vanilla dedup check)
    // Rebuild AFTER mutating forge_jvm (ignore list patch above)
    let vanilla_jvm: Vec<String> = vanilla_jvm_raw
        .iter()
        .map(|a| substitute(a, &vars))
        .filter(|a| !a.contains("${") && !a.is_empty())
        .collect();

    let forge_jvm_set: std::collections::HashSet<&str> =
        forge_jvm.iter().map(|s| s.as_str()).collect();

    // Add Forge JVM args — no deduplication, preserves all --add-opens pairs
    let mut classpath_in_jvm = false;
    for tok in &forge_jvm {
        if tok == &classpath {
            classpath_in_jvm = true;
        }
        cmd.arg(tok);
    }

    // Add vanilla JVM args that Forge didn't already emit
    // We check pair-wise: if a flag AND its value are both from Forge, skip both.
    let mut vi = 0;
    while vi < vanilla_jvm.len() {
        let tok = &vanilla_jvm[vi];
        if forge_jvm_set.contains(tok.as_str()) {
            // This exact token is already from Forge — skip it
            // If it's a flag (starts with -), also skip its value
            if tok.starts_with('-') {
                vi += 2; // skip flag + value
            } else {
                vi += 1;
            }
            continue;
        }
        if tok == &classpath {
            classpath_in_jvm = true;
        }
        cmd.arg(tok);
        vi += 1;
    }

    // Add -cp explicitly if ${classpath} wasn't already provided by the JSON
    if !classpath_in_jvm {
        cmd.arg("-cp").arg(&classpath);
    }

    // ── Main class ─────────────────────────────────────────────
    let main_class = forge_json["mainClass"]
        .as_str()
        .unwrap_or("net.minecraft.client.main.Main");
    cmd.arg(main_class);

    // ── Game arguments ─────────────────────────────────────────
    // Strategy: use Forge game args as the primary source (they already contain
    // everything needed for Forge). For vanilla args, only add flags that Forge
    // didn't include. Finally add our own explicit offline flags at the end so
    // they take precedence over any template-provided values.
    //
    // Problematic args we always strip:
    //   --demo          (runs demo mode)
    //   --quickPlay*    (not applicable)
    //   --clientId      (online-mode only)
    //   --xuid          (online-mode only)
    //   --width / --height with empty values

    const BLOCKLIST: &[&str] = &[
        "--demo",
        "--quickPlayPath",
        "--quickPlaySingleplayer",
        "--quickPlayMultiplayer",
        "--quickPlayRealms",
        "--clientId",
        "--xuid",
    ];

    // Keys whose resolved value must be non-empty to keep the pair
    const EMPTY_VALUE_FLAGS: &[&str] = &[
        "--width", "--height",
    ];

    // Collect game args from both sources, resolve, filter
    let forge_game_args = collect_string_args(&forge_json["arguments"]["game"]);
    // We intentionally do NOT chain vanilla game args here — Forge already
    // inherits and re-exports the vanilla args in its own list. Adding them again
    // would produce every argument twice (which is exactly what was happening).

    let mut game_tokens: Vec<String> = Vec::new();
    let mut skip_next = false;
    let mut i = 0;
    let resolved_game: Vec<String> = forge_game_args
        .iter()
        .map(|a| substitute(a, &vars))
        .collect();

    while i < resolved_game.len() {
        let tok = &resolved_game[i];

        if skip_next {
            skip_next = false;
            i += 1;
            continue;
        }

        // Skip any bare --demo flag
        if tok == "--demo" {
            i += 1;
            continue;
        }

        // If this is a blocklisted flag, skip it and its value
        if BLOCKLIST.contains(&tok.as_str()) {
            skip_next = true;
            i += 1;
            continue;
        }

        // If this is a flag whose value resolved to empty, skip both
        if EMPTY_VALUE_FLAGS.contains(&tok.as_str()) {
            let next_val = resolved_game.get(i + 1).map(|s| s.as_str()).unwrap_or("");
            if next_val.is_empty() || next_val.contains("${") {
                skip_next = true;
                i += 1;
                continue;
            }
        }

        // Skip unresolved placeholders
        if tok.contains("${") || tok.is_empty() {
            i += 1;
            continue;
        }

        game_tokens.push(tok.clone());
        i += 1;
    }

    // Merge into command, tracking which flags we've already set
    let mut game_flags: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut j = 0;
    while j < game_tokens.len() {
        let tok = &game_tokens[j];
        if tok.starts_with("--") {
            // It's a --flag value pair
            if let Some(val) = game_tokens.get(j + 1) {
                game_flags.insert(tok.clone());
                cmd.arg(tok).arg(val);
                j += 2;
                continue;
            }
        }
        cmd.arg(tok);
        j += 1;
    }

    // Explicit offline flags — override anything from the JSON
    // (only add if not already set, to avoid another duplication)
    let offline_pairs: &[(&str, &str)] = &[
        ("--username",    username),
        ("--version",     version_id),
        ("--gameDir",     &path_str(mc_dir)),
        ("--assetsDir",   &path_str(&mc_dir.join("assets"))),
        ("--assetIndex",  &asset_index),
        ("--uuid",        &uuid),
        ("--accessToken", "0"),
        ("--userType",    "legacy"),
    ];
    for (flag, value) in offline_pairs {
        if !game_flags.contains(*flag) {
            cmd.arg(flag).arg(value);
        }
    }

    Ok(cmd)
}

// ── Windows GPU preference helper ─────────────────────────────────────────

#[cfg(target_os = "windows")]
fn set_high_performance_gpu_preference(java_exe: &Path) -> Result<(), String> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (key, _) = hkcu
        .create_subkey("Software\\Microsoft\\DirectX\\UserGpuPreferences")
        .map_err(|e| e.to_string())?;

    let value = "GpuPreference=2;";

    let java_path = java_exe.to_string_lossy().to_string();
    key.set_value(&java_path, &value).map_err(|e| e.to_string())?;

    // Also set javaw.exe in the same bin directory if present.
    if let Some(parent) = java_exe.parent() {
        let javaw_path = parent.join("javaw.exe");
        if javaw_path.exists() {
            let javaw_str = javaw_path.to_string_lossy().to_string();
            key.set_value(&javaw_str, &value).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn set_high_performance_gpu_preference(_java_exe: &Path) -> Result<(), String> {
    Ok(())
}

/// Reads and parses a Minecraft version JSON file.
fn read_version_json(mc_dir: &Path, version_id: &str) -> Result<serde_json::Value, String> {
    let path = mc_dir
        .join("versions")
        .join(version_id)
        .join(format!("{}.json", version_id));

    let raw = std::fs::read_to_string(&path)
        .map_err(|e| format!("Cannot read version JSON {:?}: {}", path, e))?;

    serde_json::from_str(&raw)
        .map_err(|e| format!("Cannot parse version JSON {:?}: {}", path, e))
}

/// Constructs the Java classpath string from all present library JARs + client JAR.
fn build_classpath(
    mc_dir: &Path,
    _forge_version_id: &str,
    vanilla_version_id: &str,
    forge_json: &serde_json::Value,
    vanilla_json: Option<&serde_json::Value>,
) -> Result<String, String> {
    let mut entries: Vec<String> = Vec::new();

    // Collect library entries from both version JSONs
    let empty_arr = serde_json::Value::Array(vec![]);
    let forge_libs = forge_json["libraries"].as_array().unwrap_or_else(|| empty_arr.as_array().unwrap());
    let vanilla_libs = vanilla_json
        .and_then(|v| v["libraries"].as_array())
        .map(|a| a.as_slice())
        .unwrap_or(&[]);

    for lib in vanilla_libs.iter().chain(forge_libs.iter()) {
        if let Some(path) = lib["downloads"]["artifact"]["path"].as_str() {
            let full = mc_dir.join("libraries").join(path);
            if full.exists() {
                entries.push(path_str(&full));
            }
        }
        // For libraries without download info, derive path from Maven coordinate
        else if let Some(name) = lib["name"].as_str() {
            let rel_path = maven_to_path(name);
            let full = mc_dir.join("libraries").join(&rel_path);
            if full.exists() {
                entries.push(path_str(&full));
            }
        }
    }

    // Client JAR (vanilla) goes at the end
    if !vanilla_version_id.is_empty() {
        let client_jar = mc_dir
            .join("versions")
            .join(vanilla_version_id)
            .join(format!("{}.jar", vanilla_version_id));
        if client_jar.exists() {
            entries.push(path_str(&client_jar));
        }
    }

    Ok(entries.join(";")) // Windows separator
}

/// Converts a Maven coordinate string to a relative file path.
/// `com.example:artifact:1.0` → `com/example/artifact/1.0/artifact-1.0.jar`
/// `com.example:artifact:1.0:native` → `com/example/artifact/1.0/artifact-1.0-native.jar`
fn maven_to_path(coord: &str) -> String {
    let parts: Vec<&str> = coord.splitn(4, ':').collect();
    if parts.len() < 3 {
        return coord.to_string();
    }
    let group = parts[0].replace('.', "/");
    let artifact = parts[1];
    let version = parts[2];
    let classifier = parts.get(3).copied();

    match classifier {
        Some(cls) => format!(
            "{}/{}/{}/{}-{}-{}.jar",
            group, artifact, version, artifact, version, cls
        ),
        None => format!(
            "{}/{}/{}/{}-{}.jar",
            group, artifact, version, artifact, version
        ),
    }
}

/// Collects string arguments from a version JSON `arguments.jvm` or `arguments.game` array.
/// Handles both plain strings and conditional rule objects (applies Windows filter).
fn collect_string_args(args: &serde_json::Value) -> Vec<String> {
    let arr = match args.as_array() {
        Some(a) => a,
        None => return Vec::new(),
    };

    let mut result = Vec::new();
    for item in arr {
        if let Some(s) = item.as_str() {
            result.push(s.to_string());
        } else if item.is_object() {
            // Conditional argument — check if it applies on Windows
            if arg_applies_to_windows(item) {
                match &item["value"] {
                    serde_json::Value::String(s) => result.push(s.clone()),
                    serde_json::Value::Array(arr) => {
                        for v in arr {
                            if let Some(s) = v.as_str() {
                                result.push(s.to_string());
                            }
                        }
                    }
                    _ => {}
                }
            }
        }
    }

    result
}

fn arg_applies_to_windows(arg: &serde_json::Value) -> bool {
    let rules = match arg["rules"].as_array() {
        Some(r) => r,
        None => return true,
    };

    let mut allowed = false;
    for rule in rules {
        let action = rule["action"].as_str().unwrap_or("allow");
        let os = &rule["os"];

        if os.is_null() {
            allowed = action == "allow";
        } else if let Some(name) = os["name"].as_str() {
            if name == "windows" {
                allowed = action == "allow";
            }
        }
    }
    allowed
}

/// Replaces `${var}` placeholders in a string from the variables map.
fn substitute(s: &str, vars: &HashMap<String, String>) -> String {
    let mut result = s.to_string();
    for (k, v) in vars {
        result = result.replace(&format!("${{{}}}", k), v);
    }
    result
}

/// Generates a Minecraft-compatible offline UUID for the given username.
/// Uses the same algorithm as the vanilla launcher: MD5 of "OfflinePlayer:{username}".
/// (A name-based version 3 UUID: the version nibble replaces the top of byte 6.)
fn offline_uuid(username: &str) -> String {
    let input = format!("OfflinePlayer:{}", username);
    let hash = md5::compute(input.as_bytes());
    let b = hash.0;
    format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        b[0], b[1], b[2], b[3],
        b[4], b[5],
        (b[6] & 0x0f) | 0x30, b[7],
        (b[8] & 0x3f) | 0x80, b[9],
        b[10], b[11], b[12], b[13], b[14], b[15]
    )
}

#[cfg(test)]
mod tests {
    use super::offline_uuid;

    #[test]
    fn offline_uuid_matches_minecraft() {
        // Java: UUID.nameUUIDFromBytes("OfflinePlayer:<name>".getBytes(UTF_8))
        assert_eq!(offline_uuid("Elmer"), "74bcea26-1e4c-3c82-97df-7e8021d6a9c8");
    }
}

fn path_str(p: &Path) -> String {
    p.to_string_lossy().to_string()
}

// ── Log helper ─────────────────────────────────────────────────────────────

/// Appends a log line to the buffer (capped at 5000) and emits a `log-line` event.
fn push_log(app: &tauri::AppHandle, line: &str) {
    {
        let state = app.state::<AppState>();
        let mut logs = state.log_lines.lock().unwrap();
        if logs.len() >= 5000 {
            logs.remove(0);
        }
        logs.push(line.to_string());
    }
    app.emit("log-line", LogLine { line: line.to_string() }).ok();
}
