#!/usr/bin/env python3
"""
BSCraft skin service.

Lets players set their in-game skin from the launcher. Accounts are the
SimpleLogin registrations on the game server: a request is authorised with
the same credential the game client sends when joining (lowercase hex
SHA-256 of the SimpleLogin password), checked with bcrypt against
world/sl_entries.dat. That file is only ever read here; the game server
owns it.

Skins are published as static files in CustomSkinLoader's CustomSkinAPI
format, which nginx serves from SKINS_DIR:

    <SKINS_DIR>/<Username>.json      {"username": ..., "skins": {"default"|"slim": <sha256>}}
    <SKINS_DIR>/textures/<sha256>    the PNG

API (behind nginx at /api/, this process listens on localhost only):

    GET    /api/health
    POST   /api/account/verify   JSON {"username", "passwordHash"} -> {"registered", "valid"}
    POST   /api/skin?model=default|slim   body = PNG bytes
    DELETE /api/skin
           Both skin routes take the headers X-Username and X-Password-Hash.

Standard library only, plus python3-bcrypt.
"""

import json
import os
import re
import struct
import sys
import tempfile
import threading
import time
import zlib
from hashlib import sha256
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import bcrypt

SL_ENTRIES = os.environ.get("BSC_SL_ENTRIES", "/home/ubuntu/game_hosting/BSCraft4/world/sl_entries.dat")
SKINS_DIR = os.environ.get("BSC_SKINS_DIR", "/var/www/bscraft/skins")
INDEX_FILE = os.environ.get("BSC_INDEX_FILE", "/home/ubuntu/bscraft-skins/data/index.json")
HOST = os.environ.get("BSC_HOST", "127.0.0.1")
PORT = int(os.environ.get("BSC_PORT", "18765"))

MAX_PNG_BYTES = 32 * 1024
USERNAME_RE = re.compile(r"^[A-Za-z0-9_]{3,16}$")
HASH_RE = re.compile(r"^[0-9a-f]{64}$")
MODELS = ("default", "slim")

# Wrong-password throttling, per (client ip, username)
FAIL_LIMIT = 8
FAIL_WINDOW = 15 * 60

_lock = threading.Lock()
_fails: dict[tuple[str, str], list[float]] = {}


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


# ── Accounts ─────────────────────────────────────────────────────────────

def load_accounts() -> dict[str, str]:
    """username (lowercase) -> bcrypt hash, from SimpleLogin's file storage."""
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


def authenticate(ip: str, username: str, password_hash: str) -> None:
    """Raises ApiError unless username is registered and the credential matches."""
    if not USERNAME_RE.match(username or ""):
        raise ApiError(400, "bad_username", "Invalid username.")
    if not HASH_RE.match(password_hash or ""):
        raise ApiError(400, "bad_credential", "Invalid password hash.")
    check_throttle(ip, username.lower())
    stored = load_accounts().get(username.lower())
    if stored is None:
        raise ApiError(403, "not_registered", "This name isn't registered yet. Join the server once to claim it.")
    if not bcrypt.checkpw(password_hash.encode(), stored.encode()):
        record_failure(ip, username.lower())
        raise ApiError(401, "bad_password", "Password doesn't match the one registered on the server.")


# ── Skins ────────────────────────────────────────────────────────────────

def validate_png(data: bytes) -> tuple[int, int]:
    """Checks this is a well-formed PNG sized like a Minecraft skin. Returns (width, height)."""
    if len(data) > MAX_PNG_BYTES:
        raise ApiError(413, "too_large", "Skin file is too large (max 32 KB).")
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
    if (width, height) not in ((64, 64), (64, 32)):
        raise ApiError(400, "bad_size", f"Skins must be 64×64 or 64×32 pixels (this one is {width}×{height}).")
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
    try:
        with open(INDEX_FILE, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return {}


def save_index(index: dict) -> None:
    atomic_write(INDEX_FILE, json.dumps(index, indent=2, sort_keys=True).encode(), 0o600)


def set_skin(username: str, model: str, png: bytes) -> dict:
    width, height = validate_png(png)
    if model == "slim" and height != 64:
        raise ApiError(400, "bad_model", "Slim arms need a 64×64 skin.")
    digest = sha256(png).hexdigest()
    with _lock:
        atomic_write(os.path.join(SKINS_DIR, "textures", digest), png)
        profile = {"username": username, "skins": {model: digest}}
        index = load_index()
        old = index.get(username.lower())
        # A name's case can change between uploads; keep a single profile file
        if old and old.get("name") != username:
            try:
                os.unlink(os.path.join(SKINS_DIR, old["name"] + ".json"))
            except FileNotFoundError:
                pass
        atomic_write(os.path.join(SKINS_DIR, username + ".json"), json.dumps(profile).encode())
        index[username.lower()] = {"name": username, "model": model, "texture": digest, "updated": int(time.time())}
        save_index(index)
    return {"ok": True, "model": model, "texture": digest}


def reset_skin(username: str) -> dict:
    with _lock:
        index = load_index()
        entry = index.pop(username.lower(), None)
        for name in {username, (entry or {}).get("name")} - {None}:
            try:
                os.unlink(os.path.join(SKINS_DIR, name + ".json"))
            except FileNotFoundError:
                pass
        save_index(index)
    return {"ok": True}


# ── HTTP ─────────────────────────────────────────────────────────────────

class Handler(BaseHTTPRequestHandler):
    server_version = "bscraft-skins/1"

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
                return self.send_json(200, {"registered": False, "valid": False})
            try:
                authenticate(ip, username, password_hash)
                return self.send_json(200, {"registered": True, "valid": True})
            except ApiError as e:
                if e.code == "bad_password":
                    return self.send_json(200, {"registered": True, "valid": False})
                raise
        if url.path == "/api/skin" and method in ("POST", "DELETE"):
            username = self.headers.get("X-Username", "")
            authenticate(ip, username, self.headers.get("X-Password-Hash", ""))
            if method == "DELETE":
                return self.send_json(200, reset_skin(username))
            model = parse_qs(url.query).get("model", ["default"])[0]
            if model not in MODELS:
                raise ApiError(400, "bad_model", "Model must be 'default' or 'slim'.")
            png = self.read_body(MAX_PNG_BYTES + 1)
            return self.send_json(200, set_skin(username, model, png))
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
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"bscraft-skins listening on {HOST}:{PORT}, skins in {SKINS_DIR}, accounts from {SL_ENTRIES}", flush=True)
    httpd.serve_forever()


if __name__ == "__main__":
    main()
