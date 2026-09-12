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
pub struct SkinUploadResult {
    pub model: String,
    pub texture: String,
}

#[derive(Debug, Deserialize)]
struct ApiError {
    message: Option<String>,
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

#[tauri::command]
pub async fn upload_skin(username: String, model: String, png: Vec<u8>) -> Result<SkinUploadResult, String> {
    validate_username(&username)?;
    if model != "default" && model != "slim" {
        return Err("Unknown skin model.".into());
    }
    if png.len() > 32 * 1024 {
        return Err("Skin file is too large (max 32 KB).".into());
    }
    let hash = credential(&require_password()?);
    let resp = http()?
        .post(format!("{}/api/skin?model={}", SERVER_BASE_URL, model))
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
    resp.json::<SkinUploadResult>().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn reset_skin(username: String) -> Result<(), String> {
    validate_username(&username)?;
    let hash = credential(&require_password()?);
    let resp = http()?
        .delete(format!("{}/api/skin", SERVER_BASE_URL))
        .header("X-Username", &username)
        .header("X-Password-Hash", hash)
        .send()
        .await
        .map_err(|e| format!("Could not reach the BSCraft server: {}", e))?;
    if resp.status().is_success() { Ok(()) } else { Err(api_error(resp).await) }
}

#[cfg(test)]
mod tests {
    use super::credential;

    #[test]
    fn credential_matches_simplelogin_sha256() {
        // SimpleLogin: lowercase hex of SHA-256 over the UTF-8 bytes, zero-padded
        assert_eq!(credential("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
        assert_eq!(credential("hunter22"), "20d2fe5e369db54ec7090639a9dc30ec4d608604936239d39e2de07fda09eb0b");
        assert_eq!(credential("pässwörd"), "46970bef70aced8123f0d5d094717e2a5cd412041e03b26376049fe65b2834a4");
    }
}
