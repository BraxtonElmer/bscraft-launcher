#!/usr/bin/env python3
"""
End-to-end tests for skin_service.py. Starts a throwaway instance on a spare
port with a fake SimpleLogin registration and temporary folders, so it never
touches the real server data.

    python3 test_skin_service.py
"""

import json
import os
import shlex
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
    # Same shape SimpleLogin 1.20.1-1.0.2 writes: bcrypt(sha256hex(sha256hex(password))),
    # lowercase names (checked against a real registration on the live server)
    wire = sha256(b"hunter22").hexdigest()
    stored = bcrypt.hashpw(sha256(wire.encode()).hexdigest().encode(), bcrypt.gensalt(prefix=b"2a")).decode()
    # A real entry SimpleLogin wrote when a throwaway test account joined the live server
    real = {"username": "bscteste2e", "password": "$2a$10$yqdvC5ruVAMIK96B.sIGhOSxm/CwRBljD9M0axgG6dKKNHZufNjF6", "gameType": 0}
    with open(entries, "w") as f:
        json.dump([{"username": "testuser", "password": stored, "gameType": 0},
                   {"username": "olduser", "password": stored, "gameType": 0}, real], f)
    # An index entry in the format written before capes existed
    os.makedirs(os.path.join(skins, "textures"))
    with open(index, "w") as f:
        json.dump({"olduser": {"name": "OldUser", "model": "slim", "texture": "ab" * 32, "updated": 1}}, f)

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
        real_wire = sha256(b"e2e-Test-Pass-7731").hexdigest()  # what the launcher and the game send
        s, b = call("POST", "/api/account/verify", json.dumps({"username": "BscTestE2E", "passwordHash": real_wire}).encode())
        check("verify: entry written by SimpleLogin itself", s == 200 and b == {"registered": True, "valid": True}, b)
        s, b = call("POST", "/api/account/verify", json.dumps({"username": "testuser", "passwordHash": sha256(b"wrong").hexdigest()}).encode())
        check("verify: wrong password", s == 200 and b == {"registered": True, "valid": False}, b)

        s, b = call("POST", "/api/skin?model=default", png(64, 64), auth("newcomer", "x"))
        check("upload: unregistered name saves a claim", s == 200 and b.get("ok") is True, b)
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
        check("upload: valid slim skin", s == 200 and b == {"ok": True, "kind": "skin", "model": "slim", "texture": digest}, b)
        prof_path = os.path.join(skins, "TestUser.json")

        def profile(name: str):
            p = os.path.join(skins, name + ".json")
            return json.load(open(p)) if os.path.exists(p) else None

        check("profile JSON in CustomSkinAPI format", profile("TestUser") == {"username": "TestUser", "skins": {"slim": digest}}, profile("TestUser"))
        tex = os.path.join(skins, "textures", digest)
        check("texture stored under its sha256", os.path.exists(tex) and open(tex, "rb").read() == skin)
        check("published files are world-readable", oct(os.stat(prof_path).st_mode & 0o777) == "0o644")

        # Capes and elytra
        cape = png(64, 32, (30, 90, 200, 255))
        cape_digest = sha256(cape).hexdigest()
        s, b = call("POST", "/api/cape", cape, auth("TestUser", "hunter22"))
        check("upload: cape", s == 200 and b == {"ok": True, "kind": "cape", "texture": cape_digest}, b)
        check("profile keeps the skin and adds the cape",
              profile("TestUser") == {"username": "TestUser", "skins": {"slim": digest}, "cape": cape_digest}, profile("TestUser"))
        s, b = call("POST", "/api/cape", png(64, 64), auth("TestUser", "hunter22"))
        check("upload: square cape -> 400 bad_size", s == 400 and b["error"] == "bad_size", b)
        s, b = call("POST", "/api/cape", png(22, 17), auth("TestUser", "hunter22"))
        check("upload: 22x17 cape -> 400 bad_size", s == 400 and b["error"] == "bad_size", b)
        hd = png(128, 64, (10, 200, 90, 255))
        s, b = call("POST", "/api/elytra", hd, auth("TestUser", "hunter22"))
        check("upload: HD elytra 128x64", s == 200 and b["texture"] == sha256(hd).hexdigest(), b)
        check("profile has skin, cape and elytra",
              set(profile("TestUser") or {}) == {"username", "skins", "cape", "elytra"}, profile("TestUser"))
        s, b = call("POST", "/api/elytra", b"\x89PNG\r\n\x1a\n" + os.urandom(70000), auth("TestUser", "hunter22"))
        check("upload: oversized elytra -> 413", s == 413, b)

        s, b = call("GET", "/api/profile?name=testUSER")
        check("public profile lookup is case-insensitive",
              s == 200 and b == {"name": "TestUser", "skin": {"model": "slim", "texture": digest}, "cape": cape_digest, "elytra": sha256(hd).hexdigest()}, b)
        s, b = call("GET", "/api/profile?name=nobody")
        check("public profile: unknown name -> 404", s == 404 and b["error"] == "not_found", b)
        s, b = call("GET", "/api/profile?name=bad%20name!")
        check("public profile: bad name -> 400", s == 400, b)
        s, b = call("GET", "/api/profile?name=OldUser")
        check("legacy index entry reads as a skin", s == 200 and b["skin"] == {"model": "slim", "texture": "ab" * 32} and b["cape"] is None, b)

        s, b = call("POST", "/api/skin?model=default", png(64, 32), auth("testuser", "hunter22"))
        check("re-upload with different name case", s == 200, b)
        check("old-case profile removed, one profile left with everything",
              not os.path.exists(prof_path) and set(profile("testuser") or {}) == {"username", "skins", "cape", "elytra"},
              sorted(os.listdir(skins)))

        s, b = call("DELETE", "/api/skin", b"", auth("testuser", "hunter22"))
        check("remove skin keeps cape and elytra",
              s == 200 and b == {"ok": True, "kind": "skin"} and set(profile("testuser") or {}) == {"username", "cape", "elytra"}, profile("testuser"))
        s, b = call("DELETE", "/api/elytra", b"", auth("testuser", "hunter22"))
        check("remove elytra", s == 200 and profile("testuser") == {"username": "testuser", "cape": cape_digest}, profile("testuser"))
        s, b = call("DELETE", "/api/cape", b"", auth("testuser", "hunter22"))
        check("removing the last texture deletes the profile",
              s == 200 and profile("testuser") is None and call("GET", "/api/profile?name=testuser")[0] == 404)
        s, b = call("DELETE", "/api/cape", b"", auth("testuser", "hunter22"))
        check("removing again is harmless", s == 200, b)

        s, b = call("POST", "/api/cape", cape, auth("olduser", "hunter22"))
        check("legacy entry upgraded on change",
              s == 200 and profile("OldUser") is None and profile("olduser") == {"username": "olduser", "skins": {"slim": "ab" * 32}, "cape": cape_digest},
              profile("olduser"))

        s, b = call("GET", "/api/nothing")
        check("unknown route -> 404", s == 404)
        s, b = call("POST", "/api/profile", b"", auth("testuser", "hunter22"))
        check("POST to profile -> 404", s == 404)

        # Two wrong passwords were already used above (verify + upload), so 6 more reach the limit of 8
        codes = [call("POST", "/api/skin?model=default", png(64, 64), auth("testuser", f"bad{i}"))[0] for i in range(7)]
        check("wrong passwords are rate limited after 8", codes[:6] == [401] * 6 and codes[6] == 429, codes)
        s, b = call("POST", "/api/skin?model=default", png(64, 64), auth("testuser", "hunter22"))
        check("right password also blocked while throttled", s == 429, b)
    finally:
        proc.terminate()
        proc.wait(timeout=5)

    remote_accounts(check, stored)
    claims(check)

    print(f"\n{'ALL PASSED' if not failures else f'{len(failures)} FAILED: {failures}'}")
    return 1 if failures else 0


def remote_accounts(check, stored: str) -> None:
    """The game server on another machine: accounts are fetched when needed, with the
    last copy used while the game server can't be reached."""
    global BASE
    tmp = tempfile.mkdtemp(prefix="bsc-skin-remote-")
    remote = os.path.join(tmp, "remote_sl_entries.dat")   # the file on the game server
    copy = os.path.join(tmp, "data", "sl_entries.dat")    # the skin service's copy
    with open(remote, "w") as f:
        json.dump([{"username": "remoteuser", "password": stored, "gameType": 0}], f)
    # Stands in for the restricted ssh key: prints the file, fails when it's gone
    printer = f"{shlex.quote(sys.executable)} -c {shlex.quote('import sys; sys.stdout.write(open(sys.argv[1]).read())')} {shlex.quote(remote)}"
    port = PORT + 1
    env = dict(os.environ, BSC_SL_ENTRIES=copy, BSC_SL_REMOTE=printer, BSC_SL_REFRESH="0",
               BSC_SKINS_DIR=os.path.join(tmp, "skins"), BSC_INDEX_FILE=os.path.join(tmp, "index.json"), BSC_PORT=str(port))
    proc = subprocess.Popen([sys.executable, os.path.join(HERE, "skin_service.py")], env=env, stderr=subprocess.DEVNULL)
    saved, BASE = BASE, f"http://127.0.0.1:{port}"
    verify = lambda name: call("POST", "/api/account/verify", json.dumps({"username": name, "passwordHash": sha256(b"hunter22").hexdigest()}).encode())
    try:
        for _ in range(50):
            try:
                if call("GET", "/api/health")[0] == 200:
                    break
            except Exception:
                time.sleep(0.1)
        s, b = verify("RemoteUser")
        check("remote: account read from the game server", s == 200 and b == {"registered": True, "valid": True}, b)
        check("remote: copy kept locally", os.path.exists(copy))
        with open(remote, "w") as f:
            json.dump([{"username": "remoteuser", "password": stored, "gameType": 0},
                       {"username": "newplayer", "password": stored, "gameType": 0}], f)
        s, b = verify("NewPlayer")
        check("remote: a player who just registered is seen straight away", b == {"registered": True, "valid": True}, b)
        os.remove(remote)
        s, b = verify("NewPlayer")
        check("remote: game server unreachable -> last copy still works", b == {"registered": True, "valid": True}, b)
        s, b = call("POST", "/api/skin?model=default", png(64, 64), auth("newplayer", "hunter22"))
        check("remote: skin upload works on the last copy", s == 200 and b.get("ok") is True, b)
    finally:
        BASE = saved
        proc.terminate()
        proc.wait(timeout=5)


def registration(password: str) -> str:
    """An sl_entries.dat password field for this password, as SimpleLogin writes it."""
    wire = sha256(password.encode()).hexdigest()
    return bcrypt.hashpw(sha256(wire.encode()).hexdigest().encode(), bcrypt.gensalt(prefix=b"2a")).decode()


def start(port: int, tmp: str, **extra) -> subprocess.Popen:
    env = dict(os.environ, BSC_SL_ENTRIES=os.path.join(tmp, "sl_entries.dat"), BSC_SKINS_DIR=os.path.join(tmp, "skins"),
               BSC_INDEX_FILE=os.path.join(tmp, "index.json"), BSC_PORT=str(port), **extra)
    proc = subprocess.Popen([sys.executable, os.path.join(HERE, "skin_service.py")], env=env, stderr=subprocess.DEVNULL)
    for _ in range(50):
        try:
            if urllib.request.urlopen(f"http://127.0.0.1:{port}/api/health", timeout=2).status == 200:
                break
        except Exception:
            time.sleep(0.1)
    return proc


def claims(check) -> None:
    """Looks saved before the name is registered: only the password that saved one can change
    it, it stays when that password registers the name, and goes when someone else does or
    nobody does in time."""
    global BASE
    saved = BASE
    verify = lambda name, pw: call("POST", "/api/account/verify", json.dumps({"username": name, "passwordHash": sha256(pw.encode()).hexdigest()}).encode())[1]
    register = lambda path, accounts: json.dump([{"username": n, "password": registration(p), "gameType": 0} for n, p in accounts.items()], open(path, "w"))

    # Settling left to requests, so each step can be seen
    tmp = tempfile.mkdtemp(prefix="bsc-skin-claims-")
    skins, entries = os.path.join(tmp, "skins"), os.path.join(tmp, "sl_entries.dat")
    profile = lambda name: json.load(open(os.path.join(skins, name + ".json"))) if os.path.exists(os.path.join(skins, name + ".json")) else None
    index = lambda: json.load(open(os.path.join(tmp, "index.json")))
    register(entries, {"regular": "pw"})
    os.makedirs(os.path.join(skins, "textures"))
    # A look left from before this name was unregistered on the game server
    json.dump({"resetname": {"name": "ResetName", "cape": "cd" * 32, "updated": 1}}, open(os.path.join(tmp, "index.json"), "w"))
    json.dump({"username": "ResetName", "cape": "cd" * 32}, open(os.path.join(skins, "ResetName.json"), "w"))
    proc = start(PORT + 2, tmp, BSC_CLAIM_SETTLE="3600", BSC_CLAIMS_PER_IP="4")
    BASE = f"http://127.0.0.1:{PORT + 2}"
    try:
        skin, cape = png(64, 64, (1, 2, 3, 255)), png(64, 32, (9, 9, 9, 255))
        s, b = call("POST", "/api/skin?model=slim", skin, auth("NewKid", "kidpw"))
        check("claim: a new name can save a skin", s == 200 and b.get("ok") is True, b)
        check("claim: published straight away, for the first join", profile("NewKid") == {"username": "NewKid", "skins": {"slim": sha256(skin).hexdigest()}}, profile("NewKid"))
        check("claim: the index keeps no password, only the claim key",
              index()["newkid"]["claim"]["key"] == sha256(sha256(b"kidpw").hexdigest().encode()).hexdigest())
        check("claim: verify says it's yours", verify("newkid", "kidpw") == {"registered": False, "valid": False, "claim": "yours"}, verify("newkid", "kidpw"))
        check("claim: verify tells others it's taken", verify("newkid", "other") == {"registered": False, "valid": False, "claim": "someone"})
        s, b = call("POST", "/api/cape", cape, auth("NewKid", "kidpw"))
        check("claim: the same password adds a cape", s == 200 and set(profile("NewKid") or {}) == {"username", "skins", "cape"}, b)
        s, b = call("POST", "/api/skin?model=default", png(64, 64), auth("NewKid", "other"))
        check("claim: another password can't change it", s == 403 and b["error"] == "claimed" and profile("NewKid")["skins"] == {"slim": sha256(skin).hexdigest()}, b)
        s, b = call("DELETE", "/api/cape", b"", auth("newkid", "other"))
        check("claim: or remove anything", s == 403 and "cape" in profile("NewKid"), b)
        s, b = call("GET", "/api/profile?name=newkid")
        check("claim: shows in the public profile", s == 200 and b["skin"] == {"model": "slim", "texture": sha256(skin).hexdigest()}, b)

        s, b = call("POST", "/api/skin?model=default", skin, auth("ResetName", "fresh"))
        check("claim: a name reset on the game server starts from a clean look",
              s == 200 and profile("ResetName") == {"username": "ResetName", "skins": {"default": sha256(skin).hexdigest()}}, profile("ResetName"))

        s, b = call("POST", "/api/skin?model=default", skin, auth("Squatter", "grief"))
        s2, b2 = call("POST", "/api/skin?model=default", skin, auth("Name4", "x"))
        s3, b3 = call("POST", "/api/skin?model=default", skin, auth("Name5", "x"))
        # NewKid, ResetName, Squatter and Name4 are four new names; Name5 is one too many
        check("claim: at most 4 new names a day from one address", (s, s2, s3) == (200, 200, 429) and b3["error"] == "too_many_claims", (s, s2, s3))
        s, b = call("POST", "/api/skin?model=default", skin, dict(auth("Name5", "x"), **{"X-Real-IP": "10.9.9.9"}))
        check("claim: another address still can", s == 200, b)
        s, b = call("POST", "/api/cape", cape, auth("NewKid", "kidpw"))
        check("claim: changing your own claim doesn't count as a new name", s == 200, b)
        s, b = call("POST", "/api/skin?model=default", skin, auth("regular", "pw"))
        check("claim: registered players aren't limited", s == 200, b)

        # The game server registers both names: NewKid with the claim's password, Squatter's name by its real owner
        register(entries, {"regular": "pw", "newkid": "kidpw", "squatter": "realowner"})
        check("claim: verify once registered", verify("NewKid", "kidpw") == {"registered": True, "valid": True})
        s, b = call("POST", "/api/skin?model=default", skin, auth("newkid", "kidpw"))
        check("claim: settles on the owner's next save and the look is kept",
              s == 200 and "claim" not in index()["newkid"] and set(profile("newkid") or {}) == {"username", "skins", "cape"}, index().get("newkid"))
        new = png(64, 64, (7, 7, 7, 255))
        s, b = call("POST", "/api/skin?model=default", new, auth("Squatter", "realowner"))
        check("claim: the real owner's save replaces someone else's look",
              s == 200 and profile("Squatter") == {"username": "Squatter", "skins": {"default": sha256(new).hexdigest()}} and "claim" not in index()["squatter"], profile("Squatter"))
        s, b = call("POST", "/api/skin?model=default", skin, auth("Squatter", "grief"))
        check("claim: the old claim's password is just a wrong password now", s == 401, b)
    finally:
        proc.terminate()
        proc.wait(timeout=5)

    # Settling in the background: after registration, and for claims nobody registers
    tmp = tempfile.mkdtemp(prefix="bsc-skin-settle-")
    skins, entries = os.path.join(tmp, "skins"), os.path.join(tmp, "sl_entries.dat")
    register(entries, {})
    proc = start(PORT + 3, tmp, BSC_CLAIM_SETTLE="0.3", BSC_CLAIM_DAYS=str(4 / 86400))
    BASE = f"http://127.0.0.1:{PORT + 3}"
    try:
        skin = png(64, 64)
        for name, pw in (("Keeper", "k"), ("Victim", "grief"), ("Ghost", "g")):
            call("POST", "/api/skin?model=default", skin, auth(name, pw))
        check("settle: three claims published", all(profile(n) for n in ("Keeper", "Victim", "Ghost")))
        register(entries, {"keeper": "k", "victim": "the-real-one"})
        time.sleep(1.5)
        idx = index()
        check("settle: registered with the claim's password -> kept, claim gone", profile("Keeper") and "claim" not in idx["keeper"], idx.get("keeper"))
        check("settle: registered by someone else -> look removed", profile("Victim") is None and "victim" not in idx, idx.get("victim"))
        check("settle: still waiting for its first join", profile("Ghost") and "claim" in idx["ghost"], idx.get("ghost"))
        time.sleep(4)
        check("settle: expires when nobody registers the name", profile("Ghost") is None and "ghost" not in index())
    finally:
        BASE = saved
        proc.terminate()
        proc.wait(timeout=5)


if __name__ == "__main__":
    sys.exit(main())
