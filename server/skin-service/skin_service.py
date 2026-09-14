#!/usr/bin/env python3
"""
BSCraft skin service.

Lets players set their in-game skin, cape and elytra from the launcher.
Accounts are the SimpleLogin registrations on the game server: a request is
authorised with the same credential the game client sends when joining
(lowercase hex SHA-256 of the SimpleLogin password), checked against
world/sl_entries.dat, where SimpleLogin keeps bcrypt(SHA-256 of that). That file is only ever read here; the game
server owns it. When the game server runs on another machine, BSC_SL_REMOTE fetches it
from there whenever it's needed (see fetch_remote_accounts).

A name nobody has registered yet can still get a look, so new players can set theirs up
before their first join: it's saved as a claim tied to the credential that saved it (see
update_entry), and only that credential can change it. Once the game server registers the
name, the claim settles (settle_claims): the look stays if the name was registered with the
same password and goes if someone else registered it. Claims nobody registers expire.

Textures are published as static files in CustomSkinLoader's CustomSkinAPI
format, which nginx serves from SKINS_DIR:

    <SKINS_DIR>/<Username>.json      {"username": ...,
                                      "skins": {"default"|"slim": <sha256>},   (optional)
                                      "cape": <sha256>, "elytra": <sha256>}    (optional)
    <SKINS_DIR>/textures/<sha256>    the PNG

API (behind nginx at /api/, this process listens on localhost only):

    GET    /api/health
    GET    /api/profile?name=<name>   public, case-insensitive -> {"name", "skin", "cape", "elytra"}
    POST   /api/account/verify        JSON {"username", "passwordHash"} -> {"registered", "valid"}
                                      (+ "claim": "yours"|"someone" for an unregistered name with a claim)
    POST   /api/skin?model=default|slim   body = PNG bytes
    POST   /api/cape                      body = PNG bytes
    POST   /api/elytra                    body = PNG bytes
    DELETE /api/skin | /api/cape | /api/elytra
           Texture routes take the headers X-Username and X-Password-Hash.

Standard library only, plus python3-bcrypt.
"""

import json
import os
import re
import shlex
import struct
import subprocess
import sys
import tempfile
import threading
import time
import zlib
from hashlib import sha256
from hmac import compare_digest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import bcrypt

SL_ENTRIES = os.environ.get("BSC_SL_ENTRIES", "/home/ubuntu/game_hosting/BSCraft4/world/sl_entries.dat")
# When the game server runs on another machine: a command that prints its accounts file
# (an ssh key restricted to exactly that, see server/README.md). It runs whenever accounts
# are needed, at most every SL_REFRESH seconds; SL_ENTRIES then holds the last good copy.
SL_REMOTE = os.environ.get("BSC_SL_REMOTE", "")
SL_REFRESH = float(os.environ.get("BSC_SL_REFRESH", "10"))
SKINS_DIR = os.environ.get("BSC_SKINS_DIR", "/var/www/bscraft/skins")
INDEX_FILE = os.environ.get("BSC_INDEX_FILE", "/home/ubuntu/bscraft-skins/data/index.json")
HOST = os.environ.get("BSC_HOST", "127.0.0.1")
PORT = int(os.environ.get("BSC_PORT", "18765"))

USERNAME_RE = re.compile(r"^[A-Za-z0-9_]{3,16}$")
HASH_RE = re.compile(r"^[0-9a-f]{64}$")
MODELS = ("default", "slim")
KINDS = ("skin", "cape", "elytra")
# Capes and elytra may be HD (the vanilla 64x32 layout at 2x, 4x or 8x); nginx caps bodies at 64k
MAX_BYTES = {"skin": 32 * 1024, "cape": 60 * 1024, "elytra": 60 * 1024}
BACK_SIZES = tuple((64 * k, 32 * k) for k in (1, 2, 4, 8))

# Wrong-password throttling, per (client ip, username)
FAIL_LIMIT = 8
FAIL_WINDOW = 15 * 60

# Looks saved for names that aren't registered yet: kept this long for their first join,
# at most this many new ones per client address a day, settled this often
CLAIM_DAYS = float(os.environ.get("BSC_CLAIM_DAYS", "7"))
CLAIMS_PER_IP = int(os.environ.get("BSC_CLAIMS_PER_IP", "5"))
CLAIM_SETTLE = float(os.environ.get("BSC_CLAIM_SETTLE", "60"))
CLAIMED = "Someone else has already saved a look for this name. If it's yours, join the server once to claim it, then save."

_lock = threading.Lock()
_fails: dict[tuple[str, str], list[float]] = {}
_claims: dict[str, list[float]] = {}


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


# ── Accounts ─────────────────────────────────────────────────────────────

_remote_lock = threading.Lock()
_remote_checked = 0.0


def fetch_remote_accounts() -> None:
    """Copies the game server's accounts file here, if it's remote and our copy isn't fresh.
    When the game server can't be reached, the last copy stays in use."""
    global _remote_checked
    if not SL_REMOTE:
        return
    with _remote_lock:
        if time.time() - _remote_checked < SL_REFRESH:
            return
        _remote_checked = time.time()
        try:
            out = subprocess.run(shlex.split(SL_REMOTE), stdin=subprocess.DEVNULL, capture_output=True,
                                 timeout=8, check=True).stdout
            if not isinstance(json.loads(out), list):
                raise ValueError("not a list of accounts")
        except (OSError, subprocess.SubprocessError, ValueError) as e:
            print(f"Couldn't fetch accounts from the game server, using the last copy: {e}", file=sys.stderr)
            return
        atomic_write(SL_ENTRIES, out, 0o600)


def load_accounts() -> dict[str, str]:
    """username (lowercase) -> bcrypt hash, from SimpleLogin's file storage."""
    fetch_remote_accounts()
    try:
        with open(SL_ENTRIES, encoding="utf-8") as f:
            entries = json.load(f)
    except FileNotFoundError:
        return {}
    return {e["username"].lower(): e["password"] for e in entries if e.get("username") and e.get("password")}


def check_throttle(ip: str, username: str) -> None:
    now = time.time()
    with _lock:
        recent = [t for t in _fails.get((ip, username), []) if now - t < FAIL_WINDOW]
        _fails[(ip, username)] = recent
        if len(recent) >= FAIL_LIMIT:
            raise ApiError(429, "rate_limited", "Too many wrong passwords. Try again in a few minutes.")


def record_failure(ip: str, username: str) -> None:
    with _lock:
        _fails.setdefault((ip, username), []).append(time.time())


def claim_key(password_hash: str) -> str:
    """What SimpleLogin runs through bcrypt for this credential (see authenticate), so a claim
    can be checked against the registration once there is one. Kept in the private index only
    until the claim settles."""
    return sha256(password_hash.encode()).hexdigest()


def authenticate(ip: str, username: str, password_hash: str, allow_unregistered: bool = False) -> bool:
    """Raises ApiError unless username is registered and the credential matches. With
    allow_unregistered, an unregistered name passes too (False is returned) and the caller
    checks its claim instead."""
    if not USERNAME_RE.match(username or ""):
        raise ApiError(400, "bad_username", "Invalid username.")
    if not HASH_RE.match(password_hash or ""):
        raise ApiError(400, "bad_credential", "Invalid password hash.")
    check_throttle(ip, username.lower())
    stored = load_accounts().get(username.lower())
    if stored is None:
        if allow_unregistered:
            return False
        raise ApiError(403, "not_registered", "This name isn't registered yet. Join the server once to claim it.")
    # SimpleLogin hashes twice: the client sends SHA-256(password), and the server's
    # MessageLogin decoder runs it through the hashing constructor again, so entries
    # hold bcrypt(SHA-256(SHA-256(password))). Requests carry what the client sends.
    if not bcrypt.checkpw(sha256(password_hash.encode()).hexdigest().encode(), stored.encode()):
        record_failure(ip, username.lower())
        raise ApiError(401, "bad_password", "Password doesn't match the one registered on the server.")
    return True


# ── Textures ─────────────────────────────────────────────────────────────

def validate_png(data: bytes, kind: str = "skin") -> tuple[int, int]:
    """Checks this is a well-formed PNG sized like a Minecraft skin/cape/elytra. Returns (width, height)."""
    label = kind.capitalize()
    if len(data) > MAX_BYTES[kind]:
        raise ApiError(413, "too_large", f"{label} file is too large (max {MAX_BYTES[kind] // 1024} KB).")
    if not data.startswith(b"\x89PNG\r\n\x1a\n"):
        raise ApiError(400, "bad_png", "That file isn't a PNG image.")
    pos, width, height, seen_end = 8, None, None, False
    while pos + 8 <= len(data):
        length, ctype = struct.unpack(">I4s", data[pos:pos + 8])
        chunk = data[pos + 8:pos + 8 + length]
        crc = data[pos + 8 + length:pos + 12 + length]
        if len(chunk) != length or len(crc) != 4 or zlib.crc32(ctype + chunk) != struct.unpack(">I", crc)[0]:
            raise ApiError(400, "bad_png", "The PNG file is damaged.")
        if ctype == b"IHDR":
            width, height = struct.unpack(">II", chunk[:8])
        if ctype == b"IEND":
            seen_end = True
            break
        pos += 12 + length
    if width is None or not seen_end:
        raise ApiError(400, "bad_png", "The PNG file is incomplete.")
    if kind == "skin" and (width, height) not in ((64, 64), (64, 32)):
        raise ApiError(400, "bad_size", f"Skins must be 64×64 or 64×32 pixels (this one is {width}×{height}).")
    if kind != "skin" and (width, height) not in BACK_SIZES:
        raise ApiError(400, "bad_size", f"{label}s must be 64×32 pixels, or an HD version like 128×64 (this one is {width}×{height}).")
    return width, height


def atomic_write(path: str, data: bytes, mode: int = 0o644) -> None:
    folder = os.path.dirname(path)
    os.makedirs(folder, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=folder, prefix=".tmp-")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        os.chmod(tmp, mode)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except FileNotFoundError:
            pass
        raise


def load_index() -> dict:
    """username (lowercase) -> {"name", "skin": {"model", "texture"}?, "cape"?, "elytra"?, "updated"}"""
    try:
        with open(INDEX_FILE, encoding="utf-8") as f:
            index = json.load(f)
    except FileNotFoundError:
        return {}
    for entry in index.values():
        # Entries written before capes existed kept the skin at the top level
        if "texture" in entry:
            entry["skin"] = {"model": entry.pop("model", "default"), "texture": entry.pop("texture")}
    return index


def save_index(index: dict) -> None:
    atomic_write(INDEX_FILE, json.dumps(index, indent=2, sort_keys=True).encode(), 0o600)


def unlink_quiet(path: str) -> None:
    try:
        os.unlink(path)
    except FileNotFoundError:
        pass


def publish(entry: dict) -> None:
    """Writes the CustomSkinAPI profile for an index entry, or removes it once nothing is left."""
    path = os.path.join(SKINS_DIR, entry["name"] + ".json")
    profile: dict = {"username": entry["name"]}
    if entry.get("skin"):
        profile["skins"] = {entry["skin"]["model"]: entry["skin"]["texture"]}
    for kind in ("cape", "elytra"):
        if entry.get(kind):
            profile[kind] = entry[kind]
    if len(profile) == 1:
        unlink_quiet(path)
    else:
        atomic_write(path, json.dumps(profile).encode())


def update_entry(username: str, change, key: str, registered: bool, ip: str = "") -> dict:
    """Applies change(entry) to a player's entry and republishes their profile.

    key is claim_key() of the request's credential. On an unregistered name the entry is a
    claim that only that credential can change; on a registered one (the credential already
    checked) a claim still waiting to settle is settled on the spot."""
    with _lock:
        index = load_index()
        entry = index.get(username.lower())
        held = (entry or {}).get("claim")
        if held and not compare_digest(held["key"], key):
            if not registered:
                raise ApiError(403, "claimed", CLAIMED)
            entry = None  # someone else's look from before the owner registered
        elif held and registered:
            del entry["claim"]  # the look they saved before joining is theirs now
        elif entry and not held and not registered:
            entry = None  # a look from before the name was reset on the game server: it's free again
        fresh = entry is None
        if fresh:
            old = index.get(username.lower())
            if old:
                unlink_quiet(os.path.join(SKINS_DIR, old["name"] + ".json"))
            entry = {"name": username}
            if not registered:
                entry["claim"] = {"key": key, "since": int(time.time())}
        # A name's case can change between uploads; keep a single profile file
        if entry["name"] != username:
            unlink_quiet(os.path.join(SKINS_DIR, entry["name"] + ".json"))
            entry["name"] = username
        change(entry)
        if fresh and not registered and any(entry.get(k) for k in KINDS):
            now = time.time()
            recent = [t for t in _claims.get(ip, []) if now - t < 24 * 3600]
            if len(recent) >= CLAIMS_PER_IP:
                raise ApiError(429, "too_many_claims", "Too many new names saved from here today. Join the server with yours first.")
            _claims[ip] = recent + [now]
        entry["updated"] = int(time.time())
        publish(entry)
        if any(entry.get(k) for k in KINDS):
            index[username.lower()] = entry
        else:
            index.pop(username.lower(), None)
        save_index(index)
        return entry


def settle_claims() -> None:
    """Looks saved before their name was registered: kept once the game server registered the
    name with the same password, dropped when someone else registered it, or when nobody has
    within CLAIM_DAYS."""
    if not any(entry.get("claim") for entry in load_index().values()):
        return
    accounts = load_accounts()
    with _lock:
        index = load_index()
        changed = False
        for name, entry in list(index.items()):
            held = entry.get("claim")
            if not held:
                continue
            stored = accounts.get(name)
            if stored is None:
                if time.time() - held["since"] < CLAIM_DAYS * 24 * 3600:
                    continue
                keep = False
            else:
                try:
                    keep = bcrypt.checkpw(held["key"].encode(), stored.encode())
                except ValueError:
                    keep = False
            if keep:
                del entry["claim"]
            else:
                unlink_quiet(os.path.join(SKINS_DIR, entry["name"] + ".json"))
                del index[name]
            changed = True
        if changed:
            save_index(index)


def settle_claims_forever() -> None:
    while True:
        time.sleep(CLAIM_SETTLE)
        try:
            settle_claims()
        except Exception as e:  # keep settling; the next round may work
            print(f"Couldn't settle claims: {e!r}", file=sys.stderr)


def set_texture(username: str, kind: str, png: bytes, model: str, key: str, registered: bool, ip: str) -> dict:
    width, height = validate_png(png, kind)
    if kind == "skin" and model == "slim" and height != 64:
        raise ApiError(400, "bad_model", "Slim arms need a 64×64 skin.")
    digest = sha256(png).hexdigest()
    atomic_write(os.path.join(SKINS_DIR, "textures", digest), png)

    def change(entry: dict) -> None:
        entry[kind] = {"model": model, "texture": digest} if kind == "skin" else digest

    update_entry(username, change, key, registered, ip)
    result = {"ok": True, "kind": kind, "texture": digest}
    if kind == "skin":
        result["model"] = model
    return result


def remove_texture(username: str, kind: str, key: str, registered: bool, ip: str) -> dict:
    update_entry(username, lambda entry: entry.pop(kind, None), key, registered, ip)
    return {"ok": True, "kind": kind}


def public_profile(name: str) -> dict:
    if not USERNAME_RE.match(name or ""):
        raise ApiError(400, "bad_username", "Invalid username.")
    entry = load_index().get(name.lower())
    if not entry:
        raise ApiError(404, "not_found", "No BSCraft skin for that name.")
    return {"name": entry["name"], "skin": entry.get("skin"), "cape": entry.get("cape"), "elytra": entry.get("elytra")}


# ── HTTP ─────────────────────────────────────────────────────────────────

class Handler(BaseHTTPRequestHandler):
    server_version = "bscraft-skins/2"

    def client_ip(self) -> str:
        # nginx is the only client; it passes the real address along
        return self.headers.get("X-Real-IP") or self.client_address[0]

    def send_json(self, status: int, body: dict) -> None:
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def read_body(self, limit: int) -> bytes:
        length = int(self.headers.get("Content-Length") or 0)
        if length > limit:
            raise ApiError(413, "too_large", "Request is too large.")
        return self.rfile.read(length) if length else b""

    def route(self, method: str) -> None:
        url = urlparse(self.path)
        ip = self.client_ip()
        if method == "GET" and url.path == "/api/health":
            return self.send_json(200, {"ok": True})
        if method == "GET" and url.path == "/api/profile":
            return self.send_json(200, public_profile(parse_qs(url.query).get("name", [""])[0]))
        if method == "POST" and url.path == "/api/account/verify":
            try:
                body = json.loads(self.read_body(4096) or b"{}")
            except json.JSONDecodeError:
                raise ApiError(400, "bad_request", "Invalid JSON.")
            username, password_hash = str(body.get("username", "")), str(body.get("passwordHash", ""))
            if not USERNAME_RE.match(username):
                raise ApiError(400, "bad_username", "Invalid username.")
            registered = username.lower() in load_accounts()
            if not registered:
                body = {"registered": False, "valid": False}
                held = (load_index().get(username.lower()) or {}).get("claim")
                if held:
                    # Guessing at a claim is throttled like guessing at a password
                    check_throttle(ip, username.lower())
                    if HASH_RE.match(password_hash) and compare_digest(held["key"], claim_key(password_hash)):
                        body["claim"] = "yours"
                    else:
                        record_failure(ip, username.lower())
                        body["claim"] = "someone"
                return self.send_json(200, body)
            try:
                authenticate(ip, username, password_hash)
                return self.send_json(200, {"registered": True, "valid": True})
            except ApiError as e:
                if e.code == "bad_password":
                    return self.send_json(200, {"registered": True, "valid": False})
                raise
        kind = url.path.removeprefix("/api/")
        if kind in KINDS and method in ("POST", "DELETE"):
            username, password_hash = self.headers.get("X-Username", ""), self.headers.get("X-Password-Hash", "")
            registered = authenticate(ip, username, password_hash, allow_unregistered=True)
            key = claim_key(password_hash)
            try:
                if method == "DELETE":
                    return self.send_json(200, remove_texture(username, kind, key, registered, ip))
                model = parse_qs(url.query).get("model", ["default"])[0]
                if model not in MODELS:
                    raise ApiError(400, "bad_model", "Model must be 'default' or 'slim'.")
                png = self.read_body(MAX_BYTES[kind] + 1)
                return self.send_json(200, set_texture(username, kind, png, model, key, registered, ip))
            except ApiError as e:
                if e.code == "claimed":
                    record_failure(ip, username.lower())
                raise
        raise ApiError(404, "not_found", "Not found.")

    def handle_any(self, method: str) -> None:
        try:
            self.route(method)
        except ApiError as e:
            self.send_json(e.status, {"error": e.code, "message": e.message})
        except Exception as e:  # never leak internals to clients
            self.log_error("internal error: %r", e)
            self.send_json(500, {"error": "internal", "message": "Something went wrong on the server."})

    def do_GET(self):
        self.handle_any("GET")

    def do_POST(self):
        self.handle_any("POST")

    def do_DELETE(self):
        self.handle_any("DELETE")

    def log_message(self, fmt, *args):
        sys.stderr.write("%s %s\n" % (self.client_ip(), fmt % args))


def main() -> None:
    os.makedirs(os.path.join(SKINS_DIR, "textures"), exist_ok=True)
    threading.Thread(target=settle_claims_forever, daemon=True).start()
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"bscraft-skins listening on {HOST}:{PORT}, skins in {SKINS_DIR}, accounts from {SL_ENTRIES}", flush=True)
    httpd.serve_forever()


if __name__ == "__main__":
    main()
