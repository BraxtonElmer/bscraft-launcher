// ============================================================
// commands/account.rs — Server account (SimpleLogin) and skins
//
// The BSCraft server runs offline-mode with the SimpleLogin mod: the
// game reads a password from <mc_dir>/.sl_password and sends its
// lowercase hex SHA-256 when joining. The launcher manages that file so
// players never see the in-game prompt, and uses the same hash to
// authorise skin uploads with the skin service. The plain password
// never leaves this machine.
// ============================================================

use crate::commands::install::get_mc_dir;
use crate::constants::SERVER_BASE_URL;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use std::time::Duration;

/// SimpleLogin reads this file (relative to the game's working directory, which is mc_dir)
const PASSWORD_FILE: &str = ".sl_password";

// ── Types ──────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Clone)]
pub struct AccountStatus {
    pub password_set: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ServerAccount {
    /// The name has joined the server at least once and claimed a password
    pub registered: bool,
    /// The password saved on this PC matches the server's
    pub valid: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TextureUploadResult {
    pub kind: String,
    pub texture: String,
    pub model: Option<String>,
}

/// Textures copied from another player, as PNG bytes
#[derive(Debug, Serialize, Clone, Default)]
pub struct ImportedLook {
    /// The player's name as the source spells it
    pub name: String,
    /// "bscraft" or "mojang"
    pub source: String,
    pub skin: Option<Vec<u8>>,
    pub model: String,
    pub cape: Option<Vec<u8>>,
    pub elytra: Option<Vec<u8>>,
}

/// Minecraft's Skin Customization settings, stored in options.txt
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct SkinPrefs {
    pub cape: bool,
    pub jacket: bool,
    pub left_sleeve: bool,
    pub right_sleeve: bool,
    pub left_pants_leg: bool,
    pub right_pants_leg: bool,
    pub hat: bool,
    /// "left" or "right"
    pub main_hand: String,
}

impl Default for SkinPrefs {
    fn default() -> Self {
        SkinPrefs {
            cape: true,
            jacket: true,
            left_sleeve: true,
            right_sleeve: true,
            left_pants_leg: true,
            right_pants_leg: true,
            hat: true,
            main_hand: "right".into(),
        }
    }
}

#[derive(Debug, Deserialize)]
struct ApiError {
    message: Option<String>,
}

#[derive(Debug, Deserialize)]
struct PublicSkin {
    model: String,
    texture: String,
}

#[derive(Debug, Deserialize)]
struct PublicProfile {
    name: String,
    skin: Option<PublicSkin>,
    cape: Option<String>,
    elytra: Option<String>,
}

// ── Helpers ────────────────────────────────────────────────────────────────

fn password_path() -> Result<PathBuf, String> {
    Ok(get_mc_dir()?.join(PASSWORD_FILE))
}

fn read_password() -> Result<Option<String>, String> {
    match std::fs::read_to_string(password_path()?) {
        Ok(p) if !p.is_empty() => Ok(Some(p)),
        Ok(_) => Ok(None),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("Could not read the saved password: {}", e)),
    }
}

/// The credential SimpleLogin sends to the server: lowercase hex SHA-256 of the UTF-8 password
fn credential(password: &str) -> String {
    hex::encode(Sha256::digest(password.as_bytes()))
}

fn validate_username(username: &str) -> Result<(), String> {
    let ok = (3..=16).contains(&username.len())
        && username.chars().all(|c| c.is_ascii_alphanumeric() || c == '_');
    if ok { Ok(()) } else { Err("Set a valid username first (3–16 letters, numbers or _).".into()) }
}

fn http() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .user_agent(concat!("BSCraftLauncher/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| e.to_string())
}

/// Turns a non-2xx response into the service's human-readable message
async fn api_error(resp: reqwest::Response) -> String {
    let status = resp.status();
    match resp.json::<ApiError>().await {
        Ok(ApiError { message: Some(m) }) => m,
        _ => format!("The skin server returned an error ({}).", status),
    }
}

fn require_password() -> Result<String, String> {
    read_password()?.ok_or_else(|| "Set your server password in Profile first.".to_string())
}

// ── Commands ───────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_account_status() -> Result<AccountStatus, String> {
    Ok(AccountStatus { password_set: read_password()?.is_some() })
}

/// Saves the password exactly as SimpleLogin stores it: the raw string, no newline.
#[tauri::command]
pub async fn set_game_password(password: String) -> Result<(), String> {
    let len = password.chars().count();
    if !(4..=64).contains(&len) {
        return Err("Use between 4 and 64 characters.".into());
    }
    if password.chars().any(|c| c.is_control()) || password.trim() != password {
        return Err("The password can't start or end with spaces or contain line breaks.".into());
    }
    let path = password_path()?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("Could not create the game folder: {}", e))?;
    }
    std::fs::write(&path, password.as_bytes()).map_err(|e| format!("Could not save the password: {}", e))
}

#[tauri::command]
pub async fn reveal_game_password() -> Result<Option<String>, String> {
    read_password()
}

/// Asks the skin service whether the name is registered and the saved password matches.
#[tauri::command]
pub async fn check_server_account(username: String) -> Result<ServerAccount, String> {
    validate_username(&username)?;
    let hash = match read_password()? {
        Some(p) => credential(&p),
        None => "0".repeat(64),
    };
    let resp = http()?
        .post(format!("{}/api/account/verify", SERVER_BASE_URL))
        .json(&serde_json::json!({ "username": username, "passwordHash": hash }))
        .send()
        .await
        .map_err(|e| format!("Could not reach the BSCraft server: {}", e))?;
    if !resp.status().is_success() {
        return Err(api_error(resp).await);
    }
    resp.json::<ServerAccount>().await.map_err(|e| e.to_string())
}

/// Largest upload the skin service accepts for each texture kind
fn max_texture_bytes(kind: &str) -> Result<usize, String> {
    match kind {
        "skin" => Ok(32 * 1024),
        "cape" | "elytra" => Ok(60 * 1024),
        _ => Err("Unknown texture type.".into()),
    }
}

/// Publishes a skin, cape or elytra texture for this player.
#[tauri::command]
pub async fn upload_texture(
    username: String,
    kind: String,
    model: Option<String>,
    png: Vec<u8>,
) -> Result<TextureUploadResult, String> {
    validate_username(&username)?;
    let max = max_texture_bytes(&kind)?;
    if png.len() > max {
        return Err(format!("That file is too large (max {} KB).", max / 1024));
    }
    let mut url = format!("{}/api/{}", SERVER_BASE_URL, kind);
    if kind == "skin" {
        let model = model.as_deref().unwrap_or("default");
        if model != "default" && model != "slim" {
            return Err("Unknown skin model.".into());
        }
        url = format!("{}?model={}", url, model);
    }
    let hash = credential(&require_password()?);
    let resp = http()?
        .post(url)
        .header("X-Username", &username)
        .header("X-Password-Hash", hash)
        .header("Content-Type", "image/png")
        .body(png)
        .send()
        .await
        .map_err(|e| format!("Could not reach the BSCraft server: {}", e))?;
    if !resp.status().is_success() {
        return Err(api_error(resp).await);
    }
    resp.json::<TextureUploadResult>().await.map_err(|e| e.to_string())
}

/// Removes one texture; the player falls back to the default for it.
#[tauri::command]
pub async fn remove_texture(username: String, kind: String) -> Result<(), String> {
    validate_username(&username)?;
    max_texture_bytes(&kind)?;
    let hash = credential(&require_password()?);
    let resp = http()?
        .delete(format!("{}/api/{}", SERVER_BASE_URL, kind))
        .header("X-Username", &username)
        .header("X-Password-Hash", hash)
        .send()
        .await
        .map_err(|e| format!("Could not reach the BSCraft server: {}", e))?;
    if resp.status().is_success() { Ok(()) } else { Err(api_error(resp).await) }
}

// ── Copying another player's look ──────────────────────────────────────────

async fn download_png(client: &reqwest::Client, url: &str, max: usize) -> Result<Vec<u8>, String> {
    let resp = client.get(url).send().await.map_err(|e| format!("Could not download the texture: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("Could not download the texture ({}).", resp.status()));
    }
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    if bytes.len() > max || !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err("The texture isn't a usable PNG.".into());
    }
    Ok(bytes.to_vec())
}

/// A player's published BSCraft look, or None if they don't have one
async fn bscraft_look(client: &reqwest::Client, name: &str) -> Result<Option<ImportedLook>, String> {
    let resp = client
        .get(format!("{}/api/profile", SERVER_BASE_URL))
        .query(&[("name", name)])
        .send()
        .await
        .map_err(|e| format!("Could not reach the BSCraft server: {}", e))?;
    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    if !resp.status().is_success() {
        return Err(api_error(resp).await);
    }
    let p: PublicProfile = resp.json().await.map_err(|e| e.to_string())?;
    let texture = |id: &str| format!("{}/skins/textures/{}", SERVER_BASE_URL, id);
    let mut look = ImportedLook { name: p.name, source: "bscraft".into(), model: "default".into(), ..Default::default() };
    if let Some(s) = p.skin {
        look.skin = Some(download_png(client, &texture(&s.texture), 32 * 1024).await?);
        look.model = if s.model == "slim" { "slim".into() } else { "default".into() };
    }
    if let Some(c) = p.cape {
        look.cape = Some(download_png(client, &texture(&c), 60 * 1024).await?);
    }
    if let Some(e) = p.elytra {
        look.elytra = Some(download_png(client, &texture(&e), 60 * 1024).await?);
    }
    Ok(Some(look))
}

/// Only fetch texture URLs that point at Mojang's texture host
fn mojang_texture_url(url: &str) -> Option<String> {
    let rest = url.strip_prefix("http://").or_else(|| url.strip_prefix("https://"))?;
    rest.starts_with("textures.minecraft.net/texture/").then(|| format!("https://{}", rest))
}

/// The skin and cape of a real Minecraft account, or None if the name doesn't exist
async fn mojang_look(client: &reqwest::Client, name: &str) -> Result<Option<ImportedLook>, String> {
    use base64::Engine;

    #[derive(Deserialize)]
    struct Lookup { id: String, name: String }
    #[derive(Deserialize)]
    struct Property { name: String, value: String }
    #[derive(Deserialize)]
    struct SessionProfile { properties: Vec<Property> }

    let unreachable = |e: reqwest::Error| format!("Could not reach Minecraft's servers: {}", e);
    let mut resp = client
        .get(format!("https://api.mojang.com/users/profiles/minecraft/{}", name))
        .send()
        .await
        .map_err(unreachable)?;
    if !resp.status().is_success() && resp.status() != reqwest::StatusCode::NOT_FOUND {
        // The older API is flaky; the newer one answers the same question
        resp = client
            .get(format!("https://api.minecraftservices.com/minecraft/profile/lookup/name/{}", name))
            .send()
            .await
            .map_err(unreachable)?;
    }
    if resp.status() == reqwest::StatusCode::NOT_FOUND || resp.status() == reqwest::StatusCode::NO_CONTENT {
        return Ok(None);
    }
    if !resp.status().is_success() {
        return Err(format!("Minecraft's servers returned an error ({}).", resp.status()));
    }
    let who: Lookup = resp.json().await.map_err(|e| e.to_string())?;

    let session: SessionProfile = client
        .get(format!("https://sessionserver.mojang.com/session/minecraft/profile/{}", who.id))
        .send()
        .await
        .map_err(unreachable)?
        .error_for_status()
        .map_err(|e| format!("Minecraft's servers returned an error: {}", e))?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    let encoded = session
        .properties
        .into_iter()
        .find(|p| p.name == "textures")
        .map(|p| p.value)
        .ok_or("That account has no texture information.")?;
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(encoded.as_bytes())
        .map_err(|_| "Couldn't read that account's textures.")?;
    let textures: serde_json::Value = serde_json::from_slice(&decoded).map_err(|e| e.to_string())?;
    let textures = &textures["textures"];

    let mut look = ImportedLook { name: who.name, source: "mojang".into(), model: "default".into(), ..Default::default() };
    if let Some(url) = textures["SKIN"]["url"].as_str().and_then(mojang_texture_url) {
        look.skin = Some(download_png(client, &url, 32 * 1024).await?);
        if textures["SKIN"]["metadata"]["model"].as_str() == Some("slim") {
            look.model = "slim".into();
        }
    }
    if let Some(url) = textures["CAPE"]["url"].as_str().and_then(mojang_texture_url) {
        look.cape = Some(download_png(client, &url, 60 * 1024).await?);
    }
    Ok(Some(look))
}

/// Copies a player's look: their BSCraft skin if they have one, otherwise their Minecraft account's.
#[tauri::command]
pub async fn import_look(name: String) -> Result<ImportedLook, String> {
    let name = name.trim().to_string();
    if !(3..=16).contains(&name.len()) || !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
        return Err("Enter a valid player name (3–16 letters, numbers or _).".into());
    }
    let client = http()?;
    if let Some(look) = bscraft_look(&client, &name).await? {
        return Ok(look);
    }
    match mojang_look(&client, &name).await? {
        Some(look) if look.skin.is_some() || look.cape.is_some() => Ok(look),
        Some(look) => Err(format!("{} uses the default skin.", look.name)),
        None => Err(format!("No player called {} was found on BSCraft or Minecraft.", name)),
    }
}

// ── Skin Customization (options.txt) ───────────────────────────────────────

/// Data version Minecraft 1.20.1 writes at the top of options.txt
const OPTIONS_DATA_VERSION: &str = "3465";

fn options_path() -> Result<PathBuf, String> {
    Ok(get_mc_dir()?.join("options.txt"))
}

/// options.txt keys for each skin part, in the order Minecraft writes them
fn part_keys(p: &mut SkinPrefs) -> [(&'static str, &mut bool); 7] {
    [
        ("modelPart_cape", &mut p.cape),
        ("modelPart_jacket", &mut p.jacket),
        ("modelPart_left_sleeve", &mut p.left_sleeve),
        ("modelPart_right_sleeve", &mut p.right_sleeve),
        ("modelPart_left_pants_leg", &mut p.left_pants_leg),
        ("modelPart_right_pants_leg", &mut p.right_pants_leg),
        ("modelPart_hat", &mut p.hat),
    ]
}

fn parse_skin_prefs(text: &str) -> SkinPrefs {
    let mut prefs = SkinPrefs::default();
    for line in text.lines() {
        let Some((key, value)) = line.trim_end_matches('\r').split_once(':') else { continue };
        if key == "mainHand" {
            prefs.main_hand = if value == "\"left\"" { "left".into() } else { "right".into() };
            continue;
        }
        for (k, slot) in part_keys(&mut prefs) {
            if k == key {
                *slot = value == "true";
            }
        }
    }
    prefs
}

/// Rewrites only the skin lines of options.txt, keeping everything else as it was
fn apply_skin_prefs(text: Option<&str>, prefs: &SkinPrefs) -> String {
    let mut prefs = prefs.clone();
    let hand = format!("\"{}\"", if prefs.main_hand == "left" { "left" } else { "right" });
    let mut wanted: Vec<(String, String)> = part_keys(&mut prefs)
        .into_iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect();
    wanted.insert(0, ("mainHand".into(), hand));

    let text = text.unwrap_or("");
    let newline = if text.contains("\r\n") { "\r\n" } else if text.is_empty() { "\r\n" } else { "\n" };
    let mut out: Vec<String> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    if text.is_empty() {
        out.push(format!("version:{}", OPTIONS_DATA_VERSION));
    }
    for line in text.lines() {
        let line = line.trim_end_matches('\r');
        let key = line.split_once(':').map(|(k, _)| k);
        match key.and_then(|k| wanted.iter().find(|(w, _)| w == k)) {
            Some((k, v)) => {
                if seen.insert(k.clone()) {
                    out.push(format!("{}:{}", k, v));
                }
            }
            None => out.push(line.to_string()),
        }
    }
    for (k, v) in &wanted {
        if !seen.contains(k) {
            out.push(format!("{}:{}", k, v));
        }
    }
    let mut result = out.join(newline);
    result.push_str(newline);
    result
}

#[tauri::command]
pub async fn get_skin_prefs() -> Result<SkinPrefs, String> {
    match std::fs::read_to_string(options_path()?) {
        Ok(text) => Ok(parse_skin_prefs(&text)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(SkinPrefs::default()),
        Err(e) => Err(format!("Could not read the game settings: {}", e)),
    }
}

/// Saves the skin parts and main hand into options.txt (the game must be closed, it rewrites the file on exit)
#[tauri::command]
pub async fn set_skin_prefs(prefs: SkinPrefs) -> Result<SkinPrefs, String> {
    let path = options_path()?;
    let current = match std::fs::read_to_string(&path) {
        Ok(t) => Some(t),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(format!("Could not read the game settings: {}", e)),
    };
    let updated = apply_skin_prefs(current.as_deref(), &prefs);
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("Could not create the game folder: {}", e))?;
    }
    let tmp = path.with_extension("txt.tmp");
    std::fs::write(&tmp, updated.as_bytes()).map_err(|e| format!("Could not save the game settings: {}", e))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("Could not save the game settings: {}", e))?;
    Ok(parse_skin_prefs(&updated))
}

#[cfg(test)]
mod tests {
    use super::{apply_skin_prefs, credential, mojang_texture_url, parse_skin_prefs, SkinPrefs};

    #[test]
    fn skin_prefs_round_trip_keeps_other_options() {
        let original = "version:3465\r\nfov:0.5\r\nmainHand:\"right\"\r\nmodelPart_cape:true\r\nmodelPart_hat:true\r\nkey_key.jump:key.keyboard.space\r\n";
        let mut prefs = parse_skin_prefs(original);
        assert_eq!(prefs, SkinPrefs::default());
        prefs.cape = false;
        prefs.left_sleeve = false;
        prefs.main_hand = "left".into();
        let out = apply_skin_prefs(Some(original), &prefs);
        assert!(out.starts_with("version:3465\r\nfov:0.5\r\nmainHand:\"left\"\r\nmodelPart_cape:false\r\nmodelPart_hat:true\r\nkey_key.jump:key.keyboard.space\r\n"));
        assert!(out.contains("modelPart_left_sleeve:false\r\n"));
        assert!(out.ends_with("\r\n") && !out.contains("\r\n\r\n"));
        assert_eq!(parse_skin_prefs(&out), prefs);
    }

    #[test]
    fn skin_prefs_new_file_has_data_version() {
        let out = apply_skin_prefs(None, &SkinPrefs::default());
        assert!(out.starts_with("version:3465\r\nmainHand:\"right\"\r\nmodelPart_cape:true\r\n"));
    }

    #[test]
    fn only_mojang_texture_urls_are_fetched() {
        assert_eq!(
            mojang_texture_url("http://textures.minecraft.net/texture/abc").as_deref(),
            Some("https://textures.minecraft.net/texture/abc")
        );
        assert_eq!(mojang_texture_url("http://evil.example/texture/abc"), None);
        assert_eq!(mojang_texture_url("http://textures.minecraft.net.evil.example/texture/abc"), None);
    }

    #[test]
    fn credential_matches_simplelogin_sha256() {
        // SimpleLogin: lowercase hex of SHA-256 over the UTF-8 bytes, zero-padded
        assert_eq!(credential("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
        assert_eq!(credential("hunter22"), "20d2fe5e369db54ec7090639a9dc30ec4d608604936239d39e2de07fda09eb0b");
        assert_eq!(credential("pässwörd"), "46970bef70aced8123f0d5d094717e2a5cd412041e03b26376049fe65b2834a4");
    }
}
