// ============================================================
// commands/server.rs — Live status of the BSCraft game server
//
// Uses Minecraft's Server List Ping (what the multiplayer screen does):
// handshake + status request over TCP, then a ping for the latency.
// The server answers with the player count and a sample of up to 12
// online players' names.
// ============================================================

use crate::constants::GAME_SERVER_ADDRESS;
use serde::Serialize;
use std::time::{Duration, Instant};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

const GAME_SERVER_PORT: u16 = 25565;
/// Minecraft 1.20.1
const PROTOCOL_VERSION: i32 = 763;

#[derive(Debug, Serialize, Clone, Default)]
pub struct ServerStatus {
    pub online: bool,
    pub players_online: u32,
    pub players_max: u32,
    /// Names the server shared (it lists at most 12, and hides players who opted out)
    pub players: Vec<String>,
    pub latency_ms: u32,
    pub version: String,
}

#[tauri::command]
pub async fn server_status() -> Result<ServerStatus, String> {
    match tokio::time::timeout(Duration::from_secs(6), query(GAME_SERVER_ADDRESS, GAME_SERVER_PORT)).await {
        Ok(Ok(status)) => Ok(status),
        // Unreachable, refused or too slow: the server is down as far as players are concerned
        _ => Ok(ServerStatus::default()),
    }
}

async fn query(host: &str, port: u16) -> Result<ServerStatus, String> {
    let mut stream = TcpStream::connect((host, port)).await.map_err(|e| e.to_string())?;
    stream.set_nodelay(true).ok();

    let mut handshake = Vec::new();
    write_varint(&mut handshake, 0x00);
    write_varint(&mut handshake, PROTOCOL_VERSION);
    write_varint(&mut handshake, host.len() as i32);
    handshake.extend_from_slice(host.as_bytes());
    handshake.extend_from_slice(&port.to_be_bytes());
    write_varint(&mut handshake, 1); // next state: status
    send_packet(&mut stream, &handshake).await?;
    send_packet(&mut stream, &[0x00]).await?; // status request

    let response = read_packet(&mut stream).await?;
    let mut cursor = &response[..];
    if read_varint_slice(&mut cursor)? != 0x00 {
        return Err("unexpected status packet".into());
    }
    let len = read_varint_slice(&mut cursor)? as usize;
    let json = cursor.get(..len).ok_or("truncated status")?;
    let mut status = parse_status(json)?;

    // Ping for the round trip time
    let started = Instant::now();
    let mut ping = vec![0x01];
    ping.extend_from_slice(&0x42_i64.to_be_bytes());
    send_packet(&mut stream, &ping).await?;
    read_packet(&mut stream).await?;
    status.latency_ms = started.elapsed().as_millis().min(u32::MAX as u128) as u32;
    Ok(status)
}

fn parse_status(json: &[u8]) -> Result<ServerStatus, String> {
    let v: serde_json::Value = serde_json::from_slice(json).map_err(|e| e.to_string())?;
    let players = &v["players"];
    let mut names = players["sample"]
        .as_array()
        .map(|sample| {
            sample
                .iter()
                .filter_map(|p| p["name"].as_str())
                // Players who turned off "Allow Server Listings" show as "Anonymous Player"
                .filter(|n| (1..=16).contains(&n.len()) && n.chars().all(|c| c.is_ascii_alphanumeric() || c == '_'))
                .map(str::to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    names.sort_by_key(|n| n.to_lowercase());
    names.dedup();
    Ok(ServerStatus {
        online: true,
        players_online: players["online"].as_u64().unwrap_or(0) as u32,
        players_max: players["max"].as_u64().unwrap_or(0) as u32,
        players: names,
        latency_ms: 0,
        version: v["version"]["name"].as_str().unwrap_or_default().to_string(),
    })
}

fn write_varint(out: &mut Vec<u8>, value: i32) {
    let mut v = value as u32;
    loop {
        let byte = (v & 0x7f) as u8;
        v >>= 7;
        if v == 0 {
            out.push(byte);
            return;
        }
        out.push(byte | 0x80);
    }
}

async fn send_packet(stream: &mut TcpStream, body: &[u8]) -> Result<(), String> {
    let mut packet = Vec::with_capacity(body.len() + 5);
    write_varint(&mut packet, body.len() as i32);
    packet.extend_from_slice(body);
    stream.write_all(&packet).await.map_err(|e| e.to_string())
}

async fn read_varint(stream: &mut TcpStream) -> Result<i32, String> {
    let mut value: u32 = 0;
    for shift in (0..35).step_by(7) {
        let byte = stream.read_u8().await.map_err(|e| e.to_string())?;
        value |= ((byte & 0x7f) as u32) << shift;
        if byte & 0x80 == 0 {
            return Ok(value as i32);
        }
    }
    Err("varint too long".into())
}

fn read_varint_slice(data: &mut &[u8]) -> Result<i32, String> {
    let mut value: u32 = 0;
    for shift in (0..35).step_by(7) {
        let (&byte, rest) = data.split_first().ok_or("truncated varint")?;
        *data = rest;
        value |= ((byte & 0x7f) as u32) << shift;
        if byte & 0x80 == 0 {
            return Ok(value as i32);
        }
    }
    Err("varint too long".into())
}

async fn read_packet(stream: &mut TcpStream) -> Result<Vec<u8>, String> {
    let len = read_varint(stream).await?;
    // Forge lists every mod in its status, so this can be tens of KB; cap it well above that
    if !(1..=2 * 1024 * 1024).contains(&len) {
        return Err("bad packet length".into());
    }
    let mut buf = vec![0u8; len as usize];
    stream.read_exact(&mut buf).await.map_err(|e| e.to_string())?;
    Ok(buf)
}

#[cfg(test)]
mod tests {
    use super::{parse_status, read_varint_slice, write_varint};

    #[test]
    fn varints_round_trip() {
        for n in [0, 1, 127, 128, 255, 25565, 763, 2_097_151, i32::MAX] {
            let mut buf = Vec::new();
            write_varint(&mut buf, n);
            assert_eq!(read_varint_slice(&mut &buf[..]).unwrap(), n);
        }
    }

    #[test]
    fn reads_players_and_skips_hidden_ones() {
        let json = br#"{"version":{"name":"1.20.1","protocol":763},"players":{"max":20,"online":3,
            "sample":[{"name":"Zed","id":"a"},{"name":"Anonymous Player","id":"0"},{"name":"akariyu","id":"b"}]}}"#;
        let s = parse_status(json).unwrap();
        assert!(s.online);
        assert_eq!((s.players_online, s.players_max), (3, 20));
        assert_eq!(s.players, vec!["akariyu".to_string(), "Zed".to_string()]);
        assert_eq!(s.version, "1.20.1");
    }
}
