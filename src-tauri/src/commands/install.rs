// ============================================================
// commands/install.rs — JRE, Minecraft vanilla, and Forge installation
// ============================================================

use crate::commands::settings::{get_data_dir, load_config_internal, save_config_internal};
use crate::constants::*;
use futures_util::StreamExt;
use serde::Serialize;
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use tauri::Emitter;

// ── Types ──────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Clone)]
pub struct InstallStatus {
    pub jre_installed: bool,
    pub minecraft_installed: bool,
    pub forge_installed: bool,
    pub jre_path: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct InstallProgress {
    pub stage: String,
    pub detail: String,
    pub percent: f32,
    pub files_done: u32,
    pub files_total: u32,
}

#[derive(Debug, Serialize, Clone)]
pub struct DownloadProgress {
    pub stage: String,
    pub file: String,
    pub detail: String,
    pub downloaded: u64,
    pub total: u64,
    pub speed_bps: u64,
    pub percent: f32,
}

// ── Path helpers ───────────────────────────────────────────────────────────

pub fn get_mc_dir() -> Result<PathBuf, String> {
    get_data_dir().map(|d| d.join("minecraft"))
}

pub fn get_runtime_dir() -> Result<PathBuf, String> {
    get_mc_dir().map(|d| d.join("runtime"))
}

/// A command for a console program (java.exe) that doesn't pop up a console window.
/// The launcher reads its output through pipes, so nobody needs to see one.
pub fn hidden_command(program: &Path) -> tokio::process::Command {
    #[allow(unused_mut)]
    let mut cmd = tokio::process::Command::new(program);
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    cmd
}

// ── Java runtimes ──────────────────────────────────────────────────────────
//
// Each Java version the modpack asks for gets its own folder, runtime/java-<major>/,
// holding the extracted Adoptium JRE (e.g. jdk-21.0.4+7-jre/). Launchers before 1.1.2
// extracted Java 17 straight into runtime/, and that copy still counts as Java 17.

/// Major version of the Java runtime at `home`, read from its `release` file
fn java_major(home: &Path) -> Option<u8> {
    let release = std::fs::read_to_string(home.join("release")).ok()?;
    parse_java_major(&release)
}

fn parse_java_major(release: &str) -> Option<u8> {
    let line = release.lines().find(|l| l.starts_with("JAVA_VERSION="))?;
    let version = line["JAVA_VERSION=".len()..].trim().trim_matches('"');
    let mut parts = version.split('.');
    let first: u8 = parts.next()?.parse().ok()?;
    // Java 8 and older call themselves "1.8.0_…"
    if first == 1 { parts.next()?.parse().ok() } else { Some(first) }
}

fn java_binary(home: &Path) -> PathBuf {
    home.join("bin").join(if cfg!(windows) { "java.exe" } else { "java" })
}

/// Every Java runtime the launcher has installed, as (major version, java executable)
fn installed_javas() -> Vec<(u8, PathBuf)> {
    let Ok(runtime_dir) = get_runtime_dir() else { return Vec::new() };
    let mut homes = Vec::new();
    for entry in std::fs::read_dir(&runtime_dir).into_iter().flatten().flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        for inner in std::fs::read_dir(&path).into_iter().flatten().flatten() {
            if inner.path().is_dir() {
                homes.push(inner.path());
            }
        }
        homes.push(path);
    }
    homes
        .into_iter()
        .filter(|home| java_binary(home).exists())
        .filter_map(|home| java_major(&home).map(|major| (major, java_binary(&home))))
        .collect()
}

/// The launcher's Java runtime of this major version, if installed
pub fn find_java(major: u8) -> Option<PathBuf> {
    installed_javas().into_iter().find(|(m, _)| *m == major).map(|(_, p)| p)
}

/// The Java the modpack runs on: the version its manifest asks for (the newest
/// installed one when there's no manifest on this PC yet)
pub fn java_for_pack() -> Result<PathBuf, String> {
    match crate::commands::modpack::required_java() {
        Some(major) => find_java(major)
            .ok_or_else(|| format!("Java {} isn't installed yet. Press Play to install it.", major)),
        None => installed_javas()
            .into_iter()
            .max_by_key(|(m, _)| *m)
            .map(|(_, p)| p)
            .ok_or_else(|| "Java isn't installed yet. Press Play to install it.".to_string()),
    }
}

fn emit_install(app: &tauri::AppHandle, stage: &str, detail: &str, percent: f32, done: u32, total: u32) {
    app.emit(
        "install-progress",
        InstallProgress {
            stage: stage.to_string(),
            detail: detail.to_string(),
            percent,
            files_done: done,
            files_total: total,
        },
    )
    .ok();
}

// ── Tauri commands ─────────────────────────────────────────────────────────

/// Returns what is installed. Given the versions the modpack's manifest asks for,
/// each part only counts as installed in exactly that version; without them, whatever
/// was installed last counts.
#[tauri::command]
pub async fn get_install_status(
    java_version: Option<u8>,
    mc_version: Option<String>,
    forge_version: Option<String>,
) -> Result<InstallStatus, String> {
    let mc_dir = get_mc_dir()?;
    let java = match java_version {
        Some(major) => find_java(major),
        None => java_for_pack().ok(),
    };
    let jre_path = java.map(|p| p.to_string_lossy().to_string());
    let jre_installed = jre_path.is_some();

    let config = load_config_internal()?;
    let mc = mc_version.or(config.installed_mc_version);
    let forge = forge_version.or(config.installed_forge_version);

    let minecraft_installed = mc
        .as_ref()
        .map(|v| {
            mc_dir
                .join("versions")
                .join(v)
                .join(format!("{}.jar", v))
                .exists()
        })
        .unwrap_or(false);

    let forge_installed = match (&mc, &forge) {
        (Some(mc), Some(forge)) => {
            let vid = format!("{}-forge-{}", mc, forge);
            mc_dir
                .join("versions")
                .join(&vid)
                .join(format!("{}.json", vid))
                .exists()
        }
        _ => false,
    };

    Ok(InstallStatus {
        jre_installed,
        minecraft_installed,
        forge_installed,
        jre_path,
    })
}

/// Installs the Java version the modpack asks for (Adoptium's JRE), unless it's already
/// there, then removes runtimes of other versions so old ones don't pile up.
#[tauri::command]
pub async fn install_jre(app: tauri::AppHandle, java_version: u8) -> Result<(), String> {
    let runtime_dir = get_runtime_dir()?;
    std::fs::create_dir_all(&runtime_dir).map_err(|e| e.to_string())?;

    if find_java(java_version).is_none() {
        let client = build_client()?;
        // Adoptium's binary endpoint redirects to the latest release's archive:
        // /v3/binary/latest/{version}/{release_type}/{os}/{arch}/{image_type}/{jvm}/{heap}/{vendor}
        let download_url = format!(
            "https://api.adoptium.net/v3/binary/latest/{}/ga/windows/x64/jre/hotspot/normal/eclipse",
            java_version
        );
        let label = format!("Downloading Java {}", java_version);
        emit_install(&app, "jre", &format!("{}…", label), 5.0, 0, 1);

        let home = runtime_dir.join(format!("java-{}", java_version));
        if home.exists() {
            // A half-finished earlier attempt
            std::fs::remove_dir_all(&home).map_err(|e| format!("Couldn't clear {:?}: {}", home, e))?;
        }
        std::fs::create_dir_all(&home).map_err(|e| e.to_string())?;
        let archive = runtime_dir.join(format!("java-{}.zip", java_version));
        download_file(&app, &client, &download_url, &archive, "jre", &label, 0).await?;

        emit_install(&app, "jre", "Extracting Java runtime…", 90.0, 0, 1);
        let extracted = extract_zip(&archive, &home);
        std::fs::remove_file(&archive).ok();
        extracted?;
        if find_java(java_version).is_none() {
            return Err(format!("The Java {} download didn't contain a usable runtime", java_version));
        }
    }

    // Other versions are no longer needed (the game only runs on the one the pack names)
    for (major, exe) in installed_javas() {
        if major == java_version {
            continue;
        }
        // exe is <home>/bin/java.exe; remove <home>, or its java-<major> folder when it has one
        let Some(home) = exe.parent().and_then(|bin| bin.parent()) else { continue };
        let target = match home.parent() {
            Some(parent) if parent != runtime_dir && parent.starts_with(&runtime_dir) => parent.to_path_buf(),
            _ => home.to_path_buf(),
        };
        if target.starts_with(&runtime_dir) && target != runtime_dir {
            std::fs::remove_dir_all(&target).ok();
        }
    }

    emit_install(&app, "jre", &format!("Java {} ready", java_version), 100.0, 1, 1);
    Ok(())
}


/// Downloads vanilla Minecraft: version JSON, client JAR, libraries, and assets.
/// Must be called before install_forge.
#[tauri::command]
pub async fn install_minecraft(app: tauri::AppHandle, mc_version: String) -> Result<(), String> {
    let mc_dir = get_mc_dir()?;
    std::fs::create_dir_all(&mc_dir).map_err(|e| e.to_string())?;

    let client = build_client()?;

    emit_install(&app, "minecraft", "Fetching version manifest…", 2.0, 0, 1);

    // Step 1: Mojang version manifest
    let manifest: serde_json::Value = client
        .get(MOJANG_VERSION_MANIFEST_URL)
        .send()
        .await
        .map_err(|e| format!("Mojang manifest request failed: {}", e))?
        .json()
        .await
        .map_err(|e| format!("Mojang manifest parse failed: {}", e))?;

    let version_entry = manifest["versions"]
        .as_array()
        .ok_or("No versions array in Mojang manifest")?
        .iter()
        .find(|v| v["id"].as_str() == Some(&mc_version))
        .ok_or_else(|| format!("Minecraft version '{}' not found in Mojang manifest", mc_version))?;

    let version_url = version_entry["url"]
        .as_str()
        .ok_or("No URL in version entry")?;

    emit_install(&app, "minecraft", "Downloading version metadata…", 5.0, 0, 1);

    // Step 2: Version JSON
    let version_json: serde_json::Value = client
        .get(version_url)
        .send()
        .await
        .map_err(|e| format!("Version JSON request failed: {}", e))?
        .json()
        .await
        .map_err(|e| format!("Version JSON parse failed: {}", e))?;

    let version_dir = mc_dir.join("versions").join(&mc_version);
    std::fs::create_dir_all(&version_dir).map_err(|e| e.to_string())?;
    std::fs::write(
        version_dir.join(format!("{}.json", mc_version)),
        serde_json::to_string_pretty(&version_json).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;

    // Step 3: Client JAR
    let client_url = version_json["downloads"]["client"]["url"]
        .as_str()
        .ok_or("No client JAR URL in version JSON")?;
    let client_size = version_json["downloads"]["client"]["size"]
        .as_u64()
        .unwrap_or(0);
    let client_jar = version_dir.join(format!("{}.jar", mc_version));

    emit_install(&app, "minecraft", "Downloading Minecraft client…", 10.0, 0, 1);
    if !client_jar.exists() {
        download_file(
            &app,
            &client,
            client_url,
            &client_jar,
            "minecraft",
            "Downloading Minecraft client",
            client_size,
        )
        .await?;
    }

    // Step 4: Libraries
    emit_install(&app, "minecraft", "Downloading libraries…", 40.0, 0, 1);
    let libraries = version_json["libraries"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    download_libraries(&app, &client, &mc_dir, &libraries).await?;

    // Step 5: Assets
    emit_install(&app, "minecraft", "Downloading game assets…", 70.0, 0, 1);
    let asset_index_url = version_json["assetIndex"]["url"]
        .as_str()
        .ok_or("No assetIndex URL")?;
    let asset_index_id = version_json["assetIndex"]["id"]
        .as_str()
        .ok_or("No assetIndex ID")?;
    download_assets(&app, &client, &mc_dir, asset_index_url, asset_index_id).await?;

    // Save installed MC version to config
    let mut config = load_config_internal()?;
    config.installed_mc_version = Some(mc_version.clone());
    save_config_internal(&config)?;

    emit_install(&app, "minecraft", "Minecraft installed", 100.0, 1, 1);
    Ok(())
}

/// Downloads the Forge installer JAR from the official Forge Maven repo and
/// runs it in headless client-install mode targeting our custom MC directory.
#[tauri::command]
pub async fn install_forge(
    app: tauri::AppHandle,
    mc_version: String,
    forge_version: String,
) -> Result<(), String> {
    let mc_dir = get_mc_dir()?;

    let java_exe = java_for_pack()?;

    let client = build_client()?;

    emit_install(&app, "forge", "Downloading Forge installer…", 5.0, 0, 1);

    let installer_url = forge_installer_url(&mc_version, &forge_version);
    let installer_path = mc_dir.join(format!("forge-{}-{}-installer.jar", mc_version, forge_version));

    download_file(
        &app,
        &client,
        &installer_url,
        &installer_path,
        "forge",
        "Downloading Forge installer",
        0,
    )
    .await?;

    emit_install(
        &app,
        "forge",
        "Running Forge installer (this may take a few minutes)…",
        60.0,
        0,
        1,
    );

    // The Forge installer requires launcher_profiles.json to exist in the MC directory.
    // Without it, the installer prints "run the Minecraft launcher at least once first"
    // and exits with a non-zero code. We create a minimal stub to satisfy it.
    let profiles_path = mc_dir.join("launcher_profiles.json");
    if !profiles_path.exists() {
        let stub = serde_json::json!({
            "profiles": {},
            "selectedProfile": "(Default)",
            "clientToken": "00000000-0000-0000-0000-000000000000",
            "authenticationDatabase": {},
            "launcherVersion": { "name": "2.2.2476", "format": 21 }
        });
        std::fs::write(
            &profiles_path,
            serde_json::to_string_pretty(&stub).unwrap_or_default(),
        )
        .ok();
    }

    // Run the official Forge installer in headless client mode
    let output = hidden_command(&java_exe)
        .arg("-jar")
        .arg(&installer_path)
        .arg("--installClient")
        .arg(&mc_dir)
        // It writes its log next to wherever it's run from; keep that in the game folder,
        // not the launcher's install folder
        .current_dir(&mc_dir)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .output()
        .await
        .map_err(|e| format!("Failed to launch Forge installer: {}", e))?;

    // Always clean up installer JAR
    std::fs::remove_file(&installer_path).ok();

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        return Err(format!(
            "Forge installer exited with error.\nstdout: {}\nstderr: {}",
            stdout, stderr
        ));
    }

    // Locate the version JSON the installer produced
    let version_id = format!("{}-forge-{}", mc_version, forge_version);
    let version_json_path = mc_dir
        .join("versions")
        .join(&version_id)
        .join(format!("{}.json", version_id));

    if !version_json_path.exists() {
        // Scan for any new folder in versions/ as a fallback
        let actual_id = find_forge_version_id(&mc_dir, &mc_version)?;
        if actual_id != version_id {
            return Err(format!(
                "Forge installed with unexpected version ID '{}'. Expected '{}'.",
                actual_id, version_id
            ));
        }
    }

    // Save installed Forge version to config
    let mut config = load_config_internal()?;
    config.installed_forge_version = Some(forge_version.clone());
    save_config_internal(&config)?;

    emit_install(&app, "forge", "Forge installed successfully", 100.0, 1, 1);
    Ok(())
}

/// Scans the versions directory for a Forge version folder matching the given MC version.
fn find_forge_version_id(mc_dir: &Path, mc_version: &str) -> Result<String, String> {
    let versions_dir = mc_dir.join("versions");
    let entries = std::fs::read_dir(&versions_dir)
        .map_err(|e| format!("Cannot read versions dir: {}", e))?;

    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with(mc_version) && name.contains("forge") {
            return Ok(name);
        }
    }
    Err(format!(
        "No Forge version folder found for MC {} in {:?}",
        mc_version, versions_dir
    ))
}

// ── Download helpers ───────────────────────────────────────────────────────

fn build_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(format!("{}/{}", LAUNCHER_NAME, LAUNCHER_VERSION))
        .build()
        .map_err(|e| format!("HTTP client init failed: {}", e))
}

/// Downloads a single file to disk, streaming chunks directly via BufWriter.
/// Emits throttled download-progress events (max every 250 ms or 1% change).
pub async fn download_file(
    app: &tauri::AppHandle,
    client: &reqwest::Client,
    url: &str,
    dest: &Path,
    stage: &str,
    detail: &str,
    expected_size: u64,
) -> Result<(), String> {
    use std::time::Instant;

    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("GET {} failed: {}", url, e))?;

    if !response.status().is_success() {
        return Err(format!("HTTP {} for {}", response.status(), url));
    }

    let total = if expected_size > 0 {
        expected_size
    } else {
        response.content_length().unwrap_or(0)
    };

    // Stream directly to disk — avoid holding the whole file in memory
    let file = std::fs::File::create(dest)
        .map_err(|e| format!("Cannot create {:?}: {}", dest, e))?;
    let mut writer = BufWriter::with_capacity(512 * 1024, file); // 512 KB write buffer

    let mut downloaded: u64 = 0;
    let mut stream = response.bytes_stream();
    let start = Instant::now();
    let mut last_emit = start;
    let mut last_pct = -1.0_f32;

    let file_name = dest
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Stream error: {}", e))?;
        downloaded += chunk.len() as u64;
        writer
            .write_all(&chunk)
            .map_err(|e| format!("Write error for {:?}: {}", dest, e))?;

        let elapsed = start.elapsed().as_secs_f64().max(0.001);
        let speed = (downloaded as f64 / elapsed) as u64;
        let percent = if total > 0 {
            (downloaded as f32 / total as f32 * 100.0).min(100.0)
        } else {
            0.0
        };

        // Throttle events: emit at most every 250 ms OR when % changes by ≥ 1
        let now = Instant::now();
        if now.duration_since(last_emit).as_millis() >= 250 || (percent - last_pct).abs() >= 1.0 {
            last_emit = now;
            last_pct = percent;
            app.emit(
                "download-progress",
                DownloadProgress {
                    stage: stage.to_string(),
                    file: file_name.clone(),
                    detail: detail.to_string(),
                    downloaded,
                    total,
                    speed_bps: speed,
                    percent,
                },
            )
            .ok();
        }
    }

    writer
        .flush()
        .map_err(|e| format!("Flush error for {:?}: {}", dest, e))?;
    Ok(())
}

/// Downloads a file silently (no events) — used during modpack sync where
/// `sync-progress` events already provide overall progress feedback.
pub async fn download_file_quiet(
    client: &reqwest::Client,
    url: &str,
    dest: &Path,
) -> Result<(), String> {
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("GET {} failed: {}", url, e))?;

    if !response.status().is_success() {
        return Err(format!("HTTP {} for {}", response.status(), url));
    }

    let file = std::fs::File::create(dest)
        .map_err(|e| format!("Cannot create {:?}: {}", dest, e))?;
    let mut writer = BufWriter::with_capacity(512 * 1024, file);
    let mut stream = response.bytes_stream();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Stream error: {}", e))?;
        writer
            .write_all(&chunk)
            .map_err(|e| format!("Write error for {:?}: {}", dest, e))?;
    }

    writer
        .flush()
        .map_err(|e| format!("Flush error for {:?}: {}", dest, e))?;
    Ok(())
}

/// Downloads Minecraft library JARs (respecting OS rules) and extracts native classifiers.
async fn download_libraries(
    app: &tauri::AppHandle,
    client: &reqwest::Client,
    mc_dir: &Path,
    libraries: &[serde_json::Value],
) -> Result<(), String> {
    let total = libraries.len() as u32;
    let done = Arc::new(AtomicU32::new(0));

    for lib in libraries {
        let d = done.fetch_add(1, Ordering::SeqCst) + 1;

        if !should_download_library(lib) {
            emit_install(
                app,
                "libraries",
                &format!("Skipped {}", lib["name"].as_str().unwrap_or("unknown")),
                d as f32 / total as f32 * 100.0,
                d,
                total,
            );
            continue;
        }

        let lib_name = lib["name"].as_str().unwrap_or("library").to_string();

        // Main artifact
        if let Some(artifact) = lib["downloads"]["artifact"].as_object() {
            let url = artifact["url"].as_str().unwrap_or("");
            let path = artifact["path"].as_str().unwrap_or("");
            if !url.is_empty() && !path.is_empty() {
                let dest = mc_dir.join("libraries").join(path);
                if !dest.exists() {
                    download_file(
                        app,
                        client,
                        url,
                        &dest,
                        "libraries",
                        &format!("Downloading {}", lib_name),
                        artifact["size"].as_u64().unwrap_or(0),
                    )
                    .await?;
                }
            }
        }

        // Native classifier (e.g. natives-windows)
        let native_key = lib["natives"]["windows"]
            .as_str()
            .unwrap_or("natives-windows")
            .replace("${arch}", "64");
        if let Some(classifiers) = lib["downloads"]["classifiers"].as_object() {
            if let Some(native) = classifiers.get(&native_key) {
                let url = native["url"].as_str().unwrap_or("");
                let path = native["path"].as_str().unwrap_or("");
                if !url.is_empty() && !path.is_empty() {
                    let dest = mc_dir.join("libraries").join(path);
                    if !dest.exists() {
                        download_file(
                            app,
                            client,
                            url,
                            &dest,
                            "libraries",
                            &format!("Downloading native {}", lib_name),
                            native["size"].as_u64().unwrap_or(0),
                        )
                        .await?;
                    }
                    // Extract natives to mc_dir/natives/
                    let natives_dir = mc_dir.join("natives");
                    std::fs::create_dir_all(&natives_dir).ok();
                    extract_zip_filtered(&dest, &natives_dir, &["META-INF"]).ok();
                }
            }
        }

        emit_install(
            app,
            "libraries",
            &format!("Downloaded {}", lib_name),
            d as f32 / total as f32 * 100.0,
            d,
            total,
        );
    }

    Ok(())
}

/// Downloads the asset index and all referenced game assets, with 8-way concurrency.
async fn download_assets(
    app: &tauri::AppHandle,
    client: &reqwest::Client,
    mc_dir: &Path,
    asset_index_url: &str,
    asset_index_id: &str,
) -> Result<(), String> {
    // Download and save the asset index
    let indexes_dir = mc_dir.join("assets").join("indexes");
    std::fs::create_dir_all(&indexes_dir).map_err(|e| e.to_string())?;

    let index_json: serde_json::Value = client
        .get(asset_index_url)
        .send()
        .await
        .map_err(|e| format!("Asset index request failed: {}", e))?
        .json()
        .await
        .map_err(|e| format!("Asset index parse failed: {}", e))?;

    std::fs::write(
        indexes_dir.join(format!("{}.json", asset_index_id)),
        serde_json::to_string(&index_json).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;

    let objects = match index_json["objects"].as_object() {
        Some(o) => o.clone(),
        None => return Ok(()),
    };

    // Filter to only assets we don't already have
    let mc_dir_arc = Arc::new(mc_dir.to_path_buf());
    let total = objects.len() as u32;
    let missing: Vec<String> = objects
        .values()
        .filter_map(|v| v["hash"].as_str().map(|s| s.to_string()))
        .filter(|hash| {
            let prefix = &hash[..2];
            !mc_dir_arc
                .join("assets")
                .join("objects")
                .join(prefix)
                .join(hash)
                .exists()
        })
        .collect();

    let done = Arc::new(AtomicU32::new(0));
    let client_arc = Arc::new(client.clone());
    let app_arc = Arc::new(app.clone());

    futures_util::stream::iter(missing)
        .map(|hash| {
            let mc_dir = mc_dir_arc.clone();
            let client = client_arc.clone();
            let app = app_arc.clone();
            let done = done.clone();
            async move {
                let prefix = &hash[..2];
                let url = format!("{}/{}/{}", MINECRAFT_RESOURCES_URL, prefix, hash);
                let dest = mc_dir.join("assets").join("objects").join(prefix).join(&hash);

                if let Some(parent) = dest.parent() {
                    std::fs::create_dir_all(parent).ok();
                }
                if let Ok(resp) = client.get(&url).send().await {
                    if let Ok(bytes) = resp.bytes().await {
                        std::fs::write(&dest, &bytes).ok();
                    }
                }

                let d = done.fetch_add(1, Ordering::SeqCst) + 1;
                app.emit(
                    "install-progress",
                    InstallProgress {
                        stage: "assets".to_string(),
                        detail: "Downloading game assets".to_string(),
                        percent: (d as f32 / total as f32 * 100.0).min(100.0),
                        files_done: d,
                        files_total: total,
                    },
                )
                .ok();
            }
        })
        .buffer_unordered(8)
        .collect::<Vec<_>>()
        .await;

    Ok(())
}

// ── Archive helpers ────────────────────────────────────────────────────────

/// Returns true if this library should be downloaded on Windows.
fn should_download_library(lib: &serde_json::Value) -> bool {
    let rules = match lib["rules"].as_array() {
        Some(r) => r,
        None => return true, // No rules = always download
    };

    // Default to deny if rules exist but are empty
    let mut allowed = false;

    for rule in rules {
        let action = rule["action"].as_str().unwrap_or("allow");
        let os = &rule["os"];

        if os.is_null() {
            // Applies to all OSes
            allowed = action == "allow";
        } else if let Some(os_name) = os["name"].as_str() {
            if os_name == "windows" {
                allowed = action == "allow";
            }
            // Rules for other OSes don't change our decision
        }
    }

    allowed
}

/// Extracts all entries from a ZIP archive to dest_dir.
pub fn extract_zip(zip_path: &Path, dest_dir: &Path) -> Result<(), String> {
    let file = std::fs::File::open(zip_path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;

    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let entry_name = entry.name().to_string();
        let dest_path = dest_dir.join(&entry_name);

        if entry.is_dir() {
            std::fs::create_dir_all(&dest_path).map_err(|e| e.to_string())?;
        } else {
            if let Some(parent) = dest_path.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            let mut out = std::fs::File::create(&dest_path).map_err(|e| e.to_string())?;
            std::io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}

/// Extracts a ZIP archive, skipping entries whose path starts with any exclude prefix.
fn extract_zip_filtered(zip_path: &Path, dest_dir: &Path, exclude: &[&str]) -> Result<(), String> {
    let file = std::fs::File::open(zip_path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;

    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let name = entry.name().to_string();

        if exclude.iter().any(|ex| name.starts_with(ex)) {
            continue;
        }

        let dest_path = dest_dir.join(&name);
        if entry.is_dir() {
            std::fs::create_dir_all(&dest_path).ok();
        } else {
            if let Some(parent) = dest_path.parent() {
                std::fs::create_dir_all(parent).ok();
            }
            if let Ok(mut out) = std::fs::File::create(&dest_path) {
                std::io::copy(&mut entry, &mut out).ok();
            }
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::parse_java_major;

    #[test]
    fn reads_java_major_from_release_file() {
        let jre21 = "IMPLEMENTOR=\"Eclipse Adoptium\"\nJAVA_RUNTIME_VERSION=\"21.0.4+7-LTS\"\nJAVA_VERSION=\"21.0.4\"\n";
        assert_eq!(parse_java_major(jre21), Some(21));
        assert_eq!(parse_java_major("JAVA_VERSION=\"17.0.12\"\r\n"), Some(17));
        assert_eq!(parse_java_major("JAVA_VERSION=\"1.8.0_402\""), Some(8));
        assert_eq!(parse_java_major("JAVA_VERSION=\"25\""), Some(25));
        assert_eq!(parse_java_major("IMPLEMENTOR=\"x\""), None);
    }
}
