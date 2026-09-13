#!/usr/bin/env python3
"""
BSCraft Modpack Manifest Generator
===================================
Scans a modpack folder, computes SHA-256 hashes, diffs against the
existing manifest, and generates an updated manifest.json.

Optionally uploads changed files + manifest to your server via rsync or SFTP.

Usage
-----
  python update-manifest.py [options]

  # First run (no existing manifest):
  python update-manifest.py \
      --modpack-dir ./my-modpack \
      --base-url https://your-server.com/bscraft/modpack/files \
      --mc-version 1.20.1 \
      --forge-version 47.3.0 \
      --java-version 17 \
      --out manifest.json

  # After updating mods (reads config.ini automatically):
  python update-manifest.py

  # Bump the modpack version and upload:
  python update-manifest.py --bump-version patch --upload
"""

import argparse
import configparser
import hashlib
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Optional

# The Windows console's code page can't print the ✓/✗ marks below
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

CONFIG_FILE = Path(__file__).parent / "config.ini"

# Root-level files that belong to each player, not the pack. The launcher
# re-downloads any listed file whose hash differs, so shipping these would
# reset everyone's settings on every update. (servers.dat is kept up to date
# by the launcher itself, with BSCraft always listed.)
SKIP_ROOT_FILES = {"servers.dat", "usercache.json"}

# Pack defaults the launcher installs only when a player doesn't have the file
# yet (manifest "initial_files"; launchers before 1.1.0 ignore that list).
INITIAL_ROOT_FILES = {"options.txt"}

# Files the launcher's Performance Mode switches off, matched by path prefix so
# the flag survives version bumps. Flags already on the manifest are kept too;
# add more with --performance.
PERFORMANCE_PREFIXES = ["mods/BetterAnimationsCollection-"]

# ── Helpers ────────────────────────────────────────────────────────────────

def sha256_file(path: Path) -> str:
    """Returns lowercase hex SHA-256 of a file."""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def bump_version(version: str, part: str) -> str:
    """Increments major, minor, or patch of a semver string."""
    m = re.match(r"^(\d+)\.(\d+)\.(\d+)$", version)
    if not m:
        return version
    major, minor, patch = int(m.group(1)), int(m.group(2)), int(m.group(3))
    if part == "major":
        return f"{major + 1}.0.0"
    elif part == "minor":
        return f"{major}.{minor + 1}.0"
    else:  # patch
        return f"{major}.{minor}.{patch + 1}"


def load_config() -> dict:
    """Loads settings from config.ini, returns a dict of options."""
    cfg = configparser.ConfigParser()
    if CONFIG_FILE.exists():
        cfg.read(CONFIG_FILE)
    result = {}
    if "server" in cfg:
        result.update(dict(cfg["server"]))
    if "modpack" in cfg:
        result.update(dict(cfg["modpack"]))
    return result


def scan_modpack_dir(modpack_dir: Path, base_url: str) -> list[dict]:
    """
    Recursively scans modpack_dir and returns a list of file entries,
    each with path (relative, forward-slash), url, sha256, and size.
    """
    entries = []
    for abs_path in sorted(modpack_dir.rglob("*")):
        if abs_path.is_dir():
            continue
        rel = abs_path.relative_to(modpack_dir).as_posix()

        # Skip common non-game files
        if any(rel.startswith(p) for p in ["logs/", "crash-reports/", ".git"]):
            continue
        if rel.endswith(".log") or rel.endswith(".tmp"):
            continue
        if rel in SKIP_ROOT_FILES or rel in INITIAL_ROOT_FILES:
            continue

        digest = sha256_file(abs_path)
        size   = abs_path.stat().st_size
        url    = f"{base_url.rstrip('/')}/{rel}"

        entries.append({
            "path":   rel,
            "url":    url,
            "sha256": digest,
            "size":   size,
        })
    return entries


def load_existing_manifest(out_path: Path) -> Optional[dict]:
    if out_path.exists():
        try:
            return json.loads(out_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            print(f"  ⚠  Existing {out_path} is invalid JSON — starting fresh.")
    return None


def diff_files(old_files: list[dict], new_files: list[dict]):
    """
    Returns (added, removed, changed, unchanged) lists of file dicts.
    """
    old_map = {f["path"]: f for f in old_files}
    new_map = {f["path"]: f for f in new_files}

    added     = [f for p, f in new_map.items() if p not in old_map]
    removed   = [f for p, f in old_map.items() if p not in new_map]
    changed   = [f for p, f in new_map.items() if p in old_map and old_map[p]["sha256"] != f["sha256"]]
    unchanged = [f for p, f in new_map.items() if p in old_map and old_map[p]["sha256"] == f["sha256"]]

    return added, removed, changed, unchanged


def upload_via_rsync(local_modpack_dir: Path, manifest_path: Path,
                     changed_paths: list[str], cfg: dict):
    """
    Uploads only changed files + manifest using rsync over SSH.
    Requires rsync and SSH key access to your server.
    """
    host        = cfg.get("host", "")
    user        = cfg.get("user", "")
    remote_path = cfg.get("remote_path", "")

    if not all([host, user, remote_path]):
        print("  ✗  Upload skipped: missing host/user/remote_path in config.ini")
        return

    print(f"\nUploading to {user}@{host}:{remote_path}…")

    # Upload each changed file individually (preserving relative structure)
    ok = 0
    for rel in changed_paths:
        local = local_modpack_dir / Path(rel)
        remote = f"{user}@{host}:{remote_path}/files/{rel}"
        # Ensure remote directory exists
        remote_dir = f"{user}@{host}:{remote_path}/files/{'/'.join(rel.split('/')[:-1])}"
        subprocess.run(["ssh", f"{user}@{host}", f"mkdir -p {remote_path}/files/{'/'.join(rel.split('/')[:-1])}"],
                       check=False, capture_output=True)
        ret = subprocess.run(["rsync", "-az", str(local), remote], capture_output=True)
        if ret.returncode == 0:
            print(f"  ✓  {rel}")
            ok += 1
        else:
            print(f"  ✗  {rel}: {ret.stderr.decode().strip()}")

    # Upload manifest
    remote_manifest = f"{user}@{host}:{remote_path}/manifest.json"
    ret = subprocess.run(["rsync", "-az", str(manifest_path), remote_manifest], capture_output=True)
    if ret.returncode == 0:
        print("  ✓  manifest.json")
    else:
        print(f"  ✗  manifest.json: {ret.stderr.decode().strip()}")

    print(f"\nUpload complete: {ok}/{len(changed_paths)} files")


# ── Main ───────────────────────────────────────────────────────────────────

def main():
    # Load config.ini defaults first
    ini = load_config()

    parser = argparse.ArgumentParser(
        description="BSCraft modpack manifest generator",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--modpack-dir",    default=ini.get("local_path",   "./modpack"),
                        help="Local path to your modpack folder")
    parser.add_argument("--base-url",       default=ini.get("base_url",     ""),
                        help="Base URL where modpack files are served (no trailing slash)")
    parser.add_argument("--mc-version",     default=ini.get("mc_version",   ""),
                        help="Minecraft version (e.g. 1.20.1)")
    parser.add_argument("--forge-version",  default=ini.get("forge_version",""),
                        help="Forge version (e.g. 47.3.0)")
    parser.add_argument("--java-version",   default=int(ini.get("java_version", "17")), type=int,
                        help="Required Java major version (default: 17)")
    parser.add_argument("--out",            default="manifest.json",
                        help="Output manifest JSON path (default: manifest.json)")
    parser.add_argument("--bump-version",   choices=["major", "minor", "patch"],
                        help="Auto-increment modpack_version before writing")
    parser.add_argument("--upload",         action="store_true",
                        help="Upload changed files + manifest via rsync after generation")
    parser.add_argument("--yes",            action="store_true",
                        help="Skip confirmation prompts")
    parser.add_argument("--performance",    action="append", default=[], metavar="PATH_PREFIX",
                        help="Mark files starting with this path for Performance Mode (repeatable)")

    args = parser.parse_args()

    modpack_dir = Path(args.modpack_dir).resolve()
    out_path    = Path(args.out).resolve()
    base_url    = args.base_url.rstrip("/")

    # Validate
    if not modpack_dir.exists():
        sys.exit(f"✗  Modpack directory not found: {modpack_dir}")
    if not base_url:
        sys.exit("✗  --base-url is required (or set base_url in config.ini)")
    if not args.mc_version:
        sys.exit("✗  --mc-version is required (or set mc_version in config.ini)")
    if not args.forge_version:
        sys.exit("✗  --forge-version is required (or set forge_version in config.ini)")

    print("BSCraft Manifest Generator")
    print("=" * 40)
    print(f"Modpack dir : {modpack_dir}")
    print(f"Base URL    : {base_url}")
    print(f"Minecraft   : {args.mc_version}  Forge: {args.forge_version}")
    print()

    # Load existing manifest
    existing = load_existing_manifest(out_path)
    existing_version = existing.get("modpack_version", "1.0.0") if existing else "1.0.0"
    existing_files   = existing.get("files", []) if existing else []

    print(f"Existing manifest: v{existing_version} ({len(existing_files)} files)" if existing
          else "No existing manifest — creating fresh.")
    print()

    # Scan
    print("Scanning modpack directory…")
    new_files = scan_modpack_dir(modpack_dir, base_url)
    print(f"  Found {len(new_files)} files")

    # Performance Mode flags: the known ones, any given on the command line, and any already set
    perf_paths = {f["path"] for f in existing_files if f.get("performance")}
    perf_prefixes = PERFORMANCE_PREFIXES + args.performance
    for f in new_files:
        if f["path"] in perf_paths or any(f["path"].startswith(p) for p in perf_prefixes):
            f["performance"] = True
    perf_now = [f["path"] for f in new_files if f.get("performance")]
    for rel in perf_now:
        print(f"  [p] {rel}  (off in Performance Mode)")
    perf_changed = set(perf_now) != perf_paths
    print()

    initial_files = [
        {"path": rel, "url": f"{base_url}/{rel}", "sha256": sha256_file(modpack_dir / rel), "size": (modpack_dir / rel).stat().st_size}
        for rel in sorted(INITIAL_ROOT_FILES) if (modpack_dir / rel).is_file()
    ]
    old_initial = {f["path"]: f["sha256"] for f in (existing.get("initial_files", []) if existing else [])}
    initial_changed = [f for f in initial_files if old_initial.get(f["path"]) != f["sha256"]]
    for f in initial_changed:
        print(f"  [i] {f['path']}  (pack default for new players)")

    # Diff
    added, removed, changed, unchanged = diff_files(existing_files, new_files)

    if not added and not removed and not changed:
        print("✓  No changes detected.")
    else:
        print("Changes detected:")
        for f in added:
            print(f"  [+] {f['path']}  (NEW)")
        for f in changed:
            print(f"  [~] {f['path']}  (CHANGED)")
        for f in removed:
            print(f"  [-] {f['path']}  (REMOVED)")
        if unchanged:
            print(f"  … {len(unchanged)} other files unchanged")
    print()

    # Determine new version
    if args.bump_version:
        new_version = bump_version(existing_version, args.bump_version)
        print(f"Modpack version: {existing_version} → {new_version}")
    elif added or removed or changed:
        # Auto-bump patch when there are changes
        new_version = bump_version(existing_version, "patch")
        print(f"Modpack version: {existing_version} → {new_version}  (auto patch bump)")
    else:
        new_version = existing_version
        print(f"Modpack version: {existing_version}  (no change)")
    print()

    # Confirm
    if not args.yes and (added or removed or changed or initial_changed or perf_changed):
        answer = input("Write manifest.json? (y/n): ").strip().lower()
        if answer != "y":
            print("Aborted.")
            sys.exit(0)

    # Write manifest
    manifest = {
        "modpack_version": new_version,
        "minecraft_version": args.mc_version,
        "forge_version": args.forge_version,
        "java_version": args.java_version,
        "files": new_files,
        "initial_files": initial_files,
    }
    out_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"✓  Written: {out_path}  ({len(new_files)} files)")

    # Upload
    if args.upload:
        changed_paths = [f["path"] for f in added + changed + initial_changed]
        upload_via_rsync(modpack_dir, out_path, changed_paths, ini)
    elif added or removed or changed or initial_changed or perf_changed:
        print()
        print("Tip: run with --upload to sync changed files to your server.")

    print()
    print("Done.")


if __name__ == "__main__":
    main()
