#!/usr/bin/env python3
"""
Writes launcher/version.json, what every installed launcher checks for updates.

Each release lists every platform built for that version, so no launcher is offered an
update that isn't there: a platform left out simply gets no update (macOS launchers count
themselves up to date; Windows launchers up to 1.1.4 report the check as failed, so always
include Windows). Never keep a platform's entry from an older release, or launchers on it
download the old version over and over.

    python3 tools/launcher-version.py --version 1.1.5 --notes "Now on macOS." \
        --windows https://bscraft.zukashix.com/launcher/bsclauncher-1.1.5-setup.exe "<setup.exe>.sig" \
        --macos   https://bscraft.zukashix.com/launcher/bsclauncher-1.1.5-macos.app.tar.gz "<app.tar.gz>.sig" \
        --out version.json

The macOS build is universal, so its archive serves both darwin-aarch64 and darwin-x86_64.
"""

import argparse
import datetime
import json
import re
import sys
import urllib.request


def signature(path: str) -> str:
    with open(path, encoding="utf-8") as f:
        sig = f.read().strip()
    if not sig or "\n" in sig:
        sys.exit(f"{path} doesn't look like a Tauri updater signature (one base64 line)")
    return sig


def check_url(url: str) -> None:
    req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": "BSCraft release check"})
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            if resp.status != 200:
                sys.exit(f"{url} answered {resp.status}")
    except Exception as e:  # noqa: BLE001 - any failure means players can't download it
        sys.exit(f"{url} isn't downloadable yet: {e}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--version", required=True, help="the release version, same as tauri.conf.json")
    ap.add_argument("--notes", required=True, help="shown on the Play screen; keep it to two short lines")
    ap.add_argument("--windows", nargs=2, metavar=("URL", "SIG_FILE"), help="NSIS installer and its .sig")
    ap.add_argument("--macos", nargs=2, metavar=("URL", "SIG_FILE"), help="universal .app.tar.gz and its .sig")
    ap.add_argument("--out", default="version.json")
    ap.add_argument("--no-check", action="store_true", help="don't check the URLs are already downloadable")
    args = ap.parse_args()

    if not re.fullmatch(r"\d+\.\d+\.\d+", args.version):
        sys.exit("--version must look like 1.2.3")
    if not (args.windows or args.macos):
        sys.exit("Give at least one of --windows and --macos")

    platforms = {}
    if args.windows:
        url, sig = args.windows
        platforms["windows-x86_64"] = {"signature": signature(sig), "url": url}
    if args.macos:
        url, sig = args.macos
        if not url.endswith(".app.tar.gz"):
            sys.exit("--macos wants the .app.tar.gz (the .dmg is for first installs only)")
        entry = {"signature": signature(sig), "url": url}
        platforms["darwin-aarch64"] = entry
        platforms["darwin-x86_64"] = dict(entry)

    for p in platforms.values():
        if args.version not in p["url"]:
            sys.exit(f"{p['url']} doesn't mention version {args.version}; is it this release's file?")
        if not args.no_check:
            check_url(p["url"])

    doc = {
        "version": args.version,
        "notes": args.notes,
        "pub_date": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "platforms": platforms,
    }
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(doc, f, indent=4)
        f.write("\n")
    print(f"Wrote {args.out}: {args.version} for {', '.join(platforms)}")


if __name__ == "__main__":
    main()
