// ============================================================
// servers_dat.rs — Keeps BSCraft in the in-game server list
//
// servers.dat is uncompressed NBT: a root compound holding a list
// "servers" of compounds { name, ip, icon?, acceptTextures?, ... }.
// The reader keeps every tag exactly as it was (strings stay raw
// bytes), so a player's own servers survive untouched; we only add
// BSCraft at the top when it's missing, or point its entry at the new
// address when the server moves.
// ============================================================

use std::path::Path;

#[derive(Debug, Clone, PartialEq)]
enum Tag {
    Byte(i8),
    Short(i16),
    Int(i32),
    Long(i64),
    Float(u32),
    Double(u64),
    ByteArray(Vec<u8>),
    /// Java "modified UTF-8", kept as raw bytes
    String(Vec<u8>),
    List(u8, Vec<Tag>),
    Compound(Vec<(Vec<u8>, Tag)>),
    IntArray(Vec<i32>),
    LongArray(Vec<i64>),
}

impl Tag {
    fn id(&self) -> u8 {
        match self {
            Tag::Byte(_) => 1,
            Tag::Short(_) => 2,
            Tag::Int(_) => 3,
            Tag::Long(_) => 4,
            Tag::Float(_) => 5,
            Tag::Double(_) => 6,
            Tag::ByteArray(_) => 7,
            Tag::String(_) => 8,
            Tag::List(..) => 9,
            Tag::Compound(_) => 10,
            Tag::IntArray(_) => 11,
            Tag::LongArray(_) => 12,
        }
    }
}

struct Reader<'a> {
    data: &'a [u8],
    pos: usize,
}

impl<'a> Reader<'a> {
    fn take(&mut self, n: usize) -> Result<&'a [u8], String> {
        let end = self.pos.checked_add(n).filter(|&e| e <= self.data.len()).ok_or("servers.dat is truncated")?;
        let s = &self.data[self.pos..end];
        self.pos = end;
        Ok(s)
    }
    fn u8(&mut self) -> Result<u8, String> {
        Ok(self.take(1)?[0])
    }
    fn u16(&mut self) -> Result<u16, String> {
        Ok(u16::from_be_bytes(self.take(2)?.try_into().unwrap()))
    }
    fn i32(&mut self) -> Result<i32, String> {
        Ok(i32::from_be_bytes(self.take(4)?.try_into().unwrap()))
    }
    fn i64(&mut self) -> Result<i64, String> {
        Ok(i64::from_be_bytes(self.take(8)?.try_into().unwrap()))
    }
    fn len(&mut self) -> Result<usize, String> {
        let n = self.i32()?;
        usize::try_from(n).map_err(|_| "servers.dat has a negative length".to_string())
    }
    fn string(&mut self) -> Result<Vec<u8>, String> {
        let n = self.u16()? as usize;
        Ok(self.take(n)?.to_vec())
    }

    fn payload(&mut self, id: u8, depth: u32) -> Result<Tag, String> {
        if depth > 64 {
            return Err("servers.dat is nested too deeply".into());
        }
        Ok(match id {
            1 => Tag::Byte(self.u8()? as i8),
            2 => Tag::Short(self.u16()? as i16),
            3 => Tag::Int(self.i32()?),
            4 => Tag::Long(self.i64()?),
            5 => Tag::Float(self.i32()? as u32),
            6 => Tag::Double(self.i64()? as u64),
            7 => {
                let n = self.len()?;
                Tag::ByteArray(self.take(n)?.to_vec())
            }
            8 => Tag::String(self.string()?),
            9 => {
                let elem = self.u8()?;
                let n = self.len()?;
                if n > self.data.len() {
                    return Err("servers.dat has an impossible list length".into());
                }
                let mut items = Vec::with_capacity(n);
                for _ in 0..n {
                    items.push(self.payload(elem, depth + 1)?);
                }
                Tag::List(elem, items)
            }
            10 => {
                let mut fields = Vec::new();
                loop {
                    let t = self.u8()?;
                    if t == 0 {
                        break;
                    }
                    let name = self.string()?;
                    fields.push((name, self.payload(t, depth + 1)?));
                }
                Tag::Compound(fields)
            }
            11 => {
                let n = self.len()?;
                let mut v = Vec::with_capacity(n.min(1 << 16));
                for _ in 0..n {
                    v.push(self.i32()?);
                }
                Tag::IntArray(v)
            }
            12 => {
                let n = self.len()?;
                let mut v = Vec::with_capacity(n.min(1 << 16));
                for _ in 0..n {
                    v.push(self.i64()?);
                }
                Tag::LongArray(v)
            }
            _ => return Err(format!("servers.dat has an unknown tag type {}", id)),
        })
    }
}

fn write_string(out: &mut Vec<u8>, s: &[u8]) {
    out.extend_from_slice(&(s.len() as u16).to_be_bytes());
    out.extend_from_slice(s);
}

fn write_payload(out: &mut Vec<u8>, tag: &Tag) {
    match tag {
        Tag::Byte(v) => out.push(*v as u8),
        Tag::Short(v) => out.extend_from_slice(&v.to_be_bytes()),
        Tag::Int(v) => out.extend_from_slice(&v.to_be_bytes()),
        Tag::Long(v) => out.extend_from_slice(&v.to_be_bytes()),
        Tag::Float(v) => out.extend_from_slice(&v.to_be_bytes()),
        Tag::Double(v) => out.extend_from_slice(&v.to_be_bytes()),
        Tag::ByteArray(v) => {
            out.extend_from_slice(&(v.len() as i32).to_be_bytes());
            out.extend_from_slice(v);
        }
        Tag::String(s) => write_string(out, s),
        Tag::List(elem, items) => {
            // An empty list may carry element type 0 (End); keep whatever it had
            out.push(if items.is_empty() { *elem } else { items[0].id() });
            out.extend_from_slice(&(items.len() as i32).to_be_bytes());
            for t in items {
                write_payload(out, t);
            }
        }
        Tag::Compound(fields) => {
            for (name, t) in fields {
                out.push(t.id());
                write_string(out, name);
                write_payload(out, t);
            }
            out.push(0);
        }
        Tag::IntArray(v) => {
            out.extend_from_slice(&(v.len() as i32).to_be_bytes());
            for x in v {
                out.extend_from_slice(&x.to_be_bytes());
            }
        }
        Tag::LongArray(v) => {
            out.extend_from_slice(&(v.len() as i32).to_be_bytes());
            for x in v {
                out.extend_from_slice(&x.to_be_bytes());
            }
        }
    }
}

/// Parses a whole servers.dat: (root name, root compound fields)
fn parse(data: &[u8]) -> Result<(Vec<u8>, Vec<(Vec<u8>, Tag)>), String> {
    let mut r = Reader { data, pos: 0 };
    if r.u8()? != 10 {
        return Err("servers.dat doesn't start with a compound".into());
    }
    let name = r.string()?;
    match r.payload(10, 0)? {
        Tag::Compound(fields) => Ok((name, fields)),
        _ => unreachable!(),
    }
}

fn serialize(name: &[u8], fields: &[(Vec<u8>, Tag)]) -> Vec<u8> {
    let mut out = vec![10];
    write_string(&mut out, name);
    write_payload(&mut out, &Tag::Compound(fields.to_vec()));
    out
}

/// "Host", "host:25565" and "HOST." all name the same server
fn same_address(a: &str, b: &str) -> bool {
    let norm = |s: &str| {
        let s = s.trim().to_ascii_lowercase();
        let s = s.strip_suffix(":25565").unwrap_or(&s).to_string();
        s.trim_end_matches('.').to_string()
    };
    norm(a) == norm(b)
}

fn server_entry(name: &str, address: &str) -> Tag {
    Tag::Compound(vec![
        (b"name".to_vec(), Tag::String(name.as_bytes().to_vec())),
        (b"ip".to_vec(), Tag::String(address.as_bytes().to_vec())),
    ])
}

/// Returns the new file contents, or None if the server is already listed.
/// Entries for the server's `old` addresses are moved to the current one.
fn with_server(existing: Option<&[u8]>, name: &str, address: &str, old: &[&str]) -> Result<Option<Vec<u8>>, String> {
    let (root_name, mut fields) = match existing {
        Some(data) if !data.is_empty() => parse(data)?,
        _ => (Vec::new(), Vec::new()),
    };
    let entry = server_entry(name, address);
    match fields.iter_mut().find(|(n, _)| n.as_slice() == b"servers") {
        Some((_, Tag::List(elem, items))) => {
            if !items.is_empty() && *elem != 10 {
                return Err("servers.dat's server list has an unexpected shape".into());
            }
            let field = |t: &Tag, key: &[u8]| -> Option<Tag> {
                match t {
                    Tag::Compound(f) => f.iter().find(|(k, _)| k.as_slice() == key).map(|(_, v)| v.clone()),
                    _ => None,
                }
            };
            let ip_is = |t: &Tag, addr: &str| matches!(field(t, b"ip"), Some(Tag::String(ip)) if same_address(&String::from_utf8_lossy(&ip), addr));
            let ours = |t: &Tag| ip_is(t, address);
            let moved_away = |t: &Tag| old.iter().any(|o| ip_is(t, o));
            let hidden = |t: &Tag| matches!(field(t, b"hidden"), Some(Tag::Byte(b)) if b != 0);
            // Quick play remembers servers as hidden entries, which the list doesn't show
            let before = items.len();
            items.retain(|t| !((ours(t) || moved_away(t)) && hidden(t)));
            // The server moved: point the player's entry at the new address, keeping its name and icon
            let mut changed = items.len() != before;
            for t in items.iter_mut() {
                if !moved_away(t) {
                    continue;
                }
                if let Tag::Compound(f) = t {
                    for (k, v) in f.iter_mut() {
                        if k.as_slice() == b"ip" {
                            *v = Tag::String(address.as_bytes().to_vec());
                        }
                    }
                }
                changed = true;
            }
            if items.iter().any(|t| ours(t)) {
                // Keep one entry if both the old and the new address were listed
                let mut seen = false;
                items.retain(|t| !ours(t) || !std::mem::replace(&mut seen, true));
                changed |= items.len() != before;
                return Ok(changed.then(|| serialize(&root_name, &fields)));
            }
            *elem = 10;
            items.insert(0, entry);
        }
        Some(_) => return Err("servers.dat's \"servers\" isn't a list".into()),
        None => fields.push((b"servers".to_vec(), Tag::List(10, vec![entry]))),
    }
    Ok(Some(serialize(&root_name, &fields)))
}

/// Makes sure the server appears in the game's multiplayer list. Leaves an
/// unreadable servers.dat alone rather than risk losing a player's servers.
pub fn ensure_server_listed(mc_dir: &Path, name: &str, address: &str, old: &[&str]) -> Result<bool, String> {
    let path = mc_dir.join("servers.dat");
    let existing = match std::fs::read(&path) {
        Ok(d) => Some(d),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(format!("Could not read servers.dat: {}", e)),
    };
    let Some(updated) = with_server(existing.as_deref(), name, address, old)? else {
        return Ok(false);
    };
    std::fs::create_dir_all(mc_dir).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("dat.tmp");
    std::fs::write(&tmp, &updated).map_err(|e| format!("Could not write servers.dat: {}", e))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("Could not write servers.dat: {}", e))?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creates_list_when_missing() {
        let out = with_server(None, "BSCraft", "bscraft.zukashix.com", &[]).unwrap().unwrap();
        let (_, fields) = parse(&out).unwrap();
        assert_eq!(fields.len(), 1);
        assert!(with_server(Some(&out), "BSCraft", "bscraft.zukashix.com:25565", &[]).unwrap().is_none());
    }

    #[test]
    fn replaces_hidden_quick_play_entry() {
        let hidden = Tag::Compound(vec![
            (b"hidden".to_vec(), Tag::Byte(1)),
            (b"ip".to_vec(), Tag::String(b"bscraft.zukashix.com:25565".to_vec())),
            (b"name".to_vec(), Tag::String(b"Minecraft Server".to_vec())),
        ]);
        let original = serialize(b"", &[(b"servers".to_vec(), Tag::List(10, vec![hidden]))]);
        let out = with_server(Some(&original), "BSCraft", "bscraft.zukashix.com", &[]).unwrap().unwrap();
        let (_, fields) = parse(&out).unwrap();
        assert_eq!(fields[0].1, Tag::List(10, vec![server_entry("BSCraft", "bscraft.zukashix.com")]));
    }

    #[test]
    fn moves_entry_from_old_address() {
        let old_entry = Tag::Compound(vec![
            (b"icon".to_vec(), Tag::String(b"iVBOR".to_vec())),
            (b"ip".to_vec(), Tag::String(b"bscraft.zukashix.com".to_vec())),
            (b"name".to_vec(), Tag::String(b"BSCraft".to_vec())),
        ]);
        let original = serialize(b"", &[(b"servers".to_vec(), Tag::List(10, vec![old_entry]))]);
        let out = with_server(Some(&original), "BSCraft", "bsc.akariyu.com", &["bscraft.zukashix.com"]).unwrap().unwrap();
        let (_, fields) = parse(&out).unwrap();
        let moved = Tag::Compound(vec![
            (b"icon".to_vec(), Tag::String(b"iVBOR".to_vec())),
            (b"ip".to_vec(), Tag::String(b"bsc.akariyu.com".to_vec())),
            (b"name".to_vec(), Tag::String(b"BSCraft".to_vec())),
        ]);
        assert_eq!(fields[0].1, Tag::List(10, vec![moved]));
        // Nothing more to do on the next launch
        assert!(with_server(Some(&out), "BSCraft", "bsc.akariyu.com", &["bscraft.zukashix.com"]).unwrap().is_none());
    }

    #[test]
    fn keeps_one_entry_when_old_and_new_are_listed() {
        let entry = |ip: &[u8]| Tag::Compound(vec![
            (b"ip".to_vec(), Tag::String(ip.to_vec())),
            (b"name".to_vec(), Tag::String(b"BSCraft".to_vec())),
        ]);
        let original = serialize(b"", &[(b"servers".to_vec(), Tag::List(10, vec![entry(b"bsc.akariyu.com"), entry(b"bscraft.zukashix.com")]))]);
        let out = with_server(Some(&original), "BSCraft", "bsc.akariyu.com", &["bscraft.zukashix.com"]).unwrap().unwrap();
        let (_, fields) = parse(&out).unwrap();
        assert_eq!(fields[0].1, Tag::List(10, vec![entry(b"bsc.akariyu.com")]));
    }

    #[test]
    fn keeps_existing_servers_byte_for_byte() {
        let mine = Tag::Compound(vec![
            (b"icon".to_vec(), Tag::String(b"iVBOR".to_vec())),
            (b"ip".to_vec(), Tag::String(b"play.example.net".to_vec())),
            (b"name".to_vec(), Tag::String("Caf\u{e9}".as_bytes().to_vec())),
            (b"acceptTextures".to_vec(), Tag::Byte(1)),
        ]);
        let original = serialize(b"", &[(b"servers".to_vec(), Tag::List(10, vec![mine.clone()]))]);
        let out = with_server(Some(&original), "BSCraft", "bscraft.zukashix.com", &[]).unwrap().unwrap();
        let (_, fields) = parse(&out).unwrap();
        match &fields[0].1 {
            Tag::List(10, items) => {
                assert_eq!(items.len(), 2);
                assert_eq!(items[1], mine);
            }
            other => panic!("unexpected {:?}", other),
        }
    }
}
