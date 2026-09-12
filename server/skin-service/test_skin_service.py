#!/usr/bin/env python3
"""
End-to-end tests for skin_service.py. Starts a throwaway instance on a spare
port with a fake SimpleLogin registration and temporary folders, so it never
touches the real server data.

    python3 test_skin_service.py
"""

import json
import os
import struct
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import zlib
from hashlib import sha256

import bcrypt

PORT = 18799
BASE = f"http://127.0.0.1:{PORT}"
HERE = os.path.dirname(os.path.abspath(__file__))


def png(width: int, height: int, color=(200, 80, 160, 255)) -> bytes:
    raw = b"".join(b"\x00" + bytes(color) * width for _ in range(height))
    def chunk(t: bytes, d: bytes) -> bytes:
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d))
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


def call(method: str, path: str, body: bytes = b"", headers: dict | None = None):
    req = urllib.request.Request(BASE + path, data=body if method != "GET" else None, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def auth(user: str, password: str) -> dict:
    return {"X-Username": user, "X-Password-Hash": sha256(password.encode()).hexdigest()}


def main() -> int:
    tmp = tempfile.mkdtemp(prefix="bsc-skin-test-")
    skins, index, entries = os.path.join(tmp, "skins"), os.path.join(tmp, "index.json"), os.path.join(tmp, "sl_entries.dat")
    # Same shape SimpleLogin writes: bcrypt(sha256hex(password)), lowercase names
    stored = bcrypt.hashpw(sha256(b"hunter22").hexdigest().encode(), bcrypt.gensalt(prefix=b"2a")).decode()
    with open(entries, "w") as f:
        json.dump([{"username": "testuser", "password": stored, "gameType": 0}], f)

    env = dict(os.environ, BSC_SL_ENTRIES=entries, BSC_SKINS_DIR=skins, BSC_INDEX_FILE=index, BSC_PORT=str(PORT))
    proc = subprocess.Popen([sys.executable, os.path.join(HERE, "skin_service.py")], env=env)
    failures = []

    def check(name: str, cond: bool, detail=""):
        print(("  PASS " if cond else "  FAIL ") + name + (f"  ({detail})" if detail and not cond else ""))
        if not cond:
            failures.append(name)

    try:
        for _ in range(50):
            try:
                if call("GET", "/api/health")[0] == 200:
                    break
            except Exception:
                time.sleep(0.1)
        s, b = call("GET", "/api/health")
        check("health", s == 200 and b.get("ok") is True)

        s, b = call("POST", "/api/account/verify", json.dumps({"username": "nobody", "passwordHash": "0" * 64}).encode())
        check("verify: unregistered name", s == 200 and b == {"registered": False, "valid": False}, b)
        s, b = call("POST", "/api/account/verify", json.dumps({"username": "TestUser", "passwordHash": sha256(b"hunter22").hexdigest()}).encode())
        check("verify: right password (case-insensitive name)", s == 200 and b == {"registered": True, "valid": True}, b)
        s, b = call("POST", "/api/account/verify", json.dumps({"username": "testuser", "passwordHash": sha256(b"wrong").hexdigest()}).encode())
        check("verify: wrong password", s == 200 and b == {"registered": True, "valid": False}, b)

        s, b = call("POST", "/api/skin?model=default", png(64, 64), auth("nobody", "x"))
        check("upload: unregistered -> 403 not_registered", s == 403 and b["error"] == "not_registered", b)
        s, b = call("POST", "/api/skin?model=default", png(64, 64), auth("testuser", "nope"))
        check("upload: wrong password -> 401", s == 401 and b["error"] == "bad_password", b)
        s, b = call("POST", "/api/skin?model=default", b"not a png at all", auth("testuser", "hunter22"))
        check("upload: not a PNG -> 400", s == 400 and b["error"] == "bad_png", b)
        s, b = call("POST", "/api/skin?model=default", png(128, 128), auth("testuser", "hunter22"))
        check("upload: wrong size -> 400 bad_size", s == 400 and b["error"] == "bad_size", b)
        s, b = call("POST", "/api/skin?model=slim", png(64, 32), auth("testuser", "hunter22"))
        check("upload: slim on 64x32 -> 400", s == 400 and b["error"] == "bad_model", b)
        broken = bytearray(png(64, 64)); broken[40] ^= 0xFF
        s, b = call("POST", "/api/skin?model=default", bytes(broken), auth("testuser", "hunter22"))
        check("upload: corrupted PNG -> 400", s == 400 and b["error"] == "bad_png", b)
        s, b = call("POST", "/api/skin?model=default", b"\x89PNG\r\n\x1a\n" + os.urandom(40000), auth("testuser", "hunter22"))
        check("upload: oversized -> 413", s == 413, b)
        s, b = call("POST", "/api/skin?model=weird", png(64, 64), auth("testuser", "hunter22"))
        check("upload: unknown model -> 400", s == 400 and b["error"] == "bad_model", b)

        skin = png(64, 64)
        s, b = call("POST", "/api/skin?model=slim", skin, auth("TestUser", "hunter22"))
        digest = sha256(skin).hexdigest()
        check("upload: valid slim skin", s == 200 and b == {"ok": True, "model": "slim", "texture": digest}, b)
        prof_path = os.path.join(skins, "TestUser.json")
        prof = json.load(open(prof_path)) if os.path.exists(prof_path) else None
        check("profile JSON in CustomSkinAPI format", prof == {"username": "TestUser", "skins": {"slim": digest}}, prof)
        tex = os.path.join(skins, "textures", digest)
        check("texture stored under its sha256", os.path.exists(tex) and open(tex, "rb").read() == skin)
        check("published files are world-readable", oct(os.stat(prof_path).st_mode & 0o777) == "0o644")

        s, b = call("POST", "/api/skin?model=default", png(64, 32), auth("testuser", "hunter22"))
        check("re-upload with different name case", s == 200, b)
        check("old-case profile removed, one profile left",
              not os.path.exists(prof_path) and os.path.exists(os.path.join(skins, "testuser.json")),
              sorted(os.listdir(skins)))

        s, b = call("DELETE", "/api/skin", b"", auth("testuser", "hunter22"))
        check("reset skin", s == 200 and b == {"ok": True} and not os.path.exists(os.path.join(skins, "testuser.json")), b)

        s, b = call("GET", "/api/nothing")
        check("unknown route -> 404", s == 404)

        # Two wrong passwords were already used above (verify + upload), so 6 more reach the limit of 8
        codes = [call("POST", "/api/skin?model=default", png(64, 64), auth("testuser", f"bad{i}"))[0] for i in range(7)]
        check("wrong passwords are rate limited after 8", codes[:6] == [401] * 6 and codes[6] == 429, codes)
        s, b = call("POST", "/api/skin?model=default", png(64, 64), auth("testuser", "hunter22"))
        check("right password also blocked while throttled", s == 429, b)
    finally:
        proc.terminate()
        proc.wait(timeout=5)

    print(f"\n{'ALL PASSED' if not failures else f'{len(failures)} FAILED: {failures}'}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
