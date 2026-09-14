#!/bin/zsh
# ============================================================
# build-macos.sh — Release build of the macOS launcher
#
# One universal app (Apple silicon + Intel), signed for the launcher's
# updater, and optionally with an Apple Developer ID and notarized.
# See README › Releasing the launcher › macOS.
#
#   tools/build-macos.sh            # needs bscraft-private.key(.password.txt) in the repo folder
#
# Environment (all optional):
#   TAURI_SIGNING_PRIVATE_KEY[_PASSWORD]  the updater key, instead of the files above
#   APPLE_SIGNING_IDENTITY                "Developer ID Application: …" (ad-hoc signed without it)
#   APPLE_ID, APPLE_PASSWORD, APPLE_TEAM_ID
#     or APPLE_API_KEY, APPLE_API_ISSUER, APPLE_API_KEY_PATH  notarization (needs the identity)
# ============================================================
set -euo pipefail

ROOT=${0:A:h:h}
cd "$ROOT"

VERSION=$(node -p "require('./package.json').version")
TAURI_VERSION=$(node -p "require('./src-tauri/tauri.conf.json').version")
CARGO_VERSION=$(sed -n 's/^version = "\(.*\)"/\1/p' src-tauri/Cargo.toml | head -1)
if [[ "$VERSION" != "$TAURI_VERSION" || "$VERSION" != "$CARGO_VERSION" ]]; then
  echo "Versions differ: package.json $VERSION, tauri.conf.json $TAURI_VERSION, Cargo.toml $CARGO_VERSION" >&2
  exit 1
fi

# The updater only installs archives signed with the key whose public half is in tauri.conf.json
if [[ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ]]; then
  if [[ ! -f bscraft-private.key ]]; then
    echo "No updater key: put bscraft-private.key (and bscraft-private.key.password.txt) in $ROOT," >&2
    echo "or set TAURI_SIGNING_PRIVATE_KEY and TAURI_SIGNING_PRIVATE_KEY_PASSWORD." >&2
    exit 1
  fi
  export TAURI_SIGNING_PRIVATE_KEY="$(cat bscraft-private.key)"
  [[ -f bscraft-private.key.password.txt ]] && export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$(cat bscraft-private.key.password.txt)"
fi
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}"

for target in aarch64-apple-darwin x86_64-apple-darwin; do
  rustup target list --installed | grep -qx "$target" || rustup target add "$target"
done

if [[ -n "${APPLE_SIGNING_IDENTITY:-}" ]]; then
  echo "Signing with $APPLE_SIGNING_IDENTITY"
else
  echo "No APPLE_SIGNING_IDENTITY: ad-hoc signed (players confirm the first open in System Settings)"
fi

# createUpdaterArtifacts only here, so everyday `npm run tauri build` works without the key
npm run tauri build -- --target universal-apple-darwin --config '{"bundle":{"createUpdaterArtifacts":true}}'

TARGET_DIR=${CARGO_TARGET_DIR:-src-tauri/target}
BUNDLE=$TARGET_DIR/universal-apple-darwin/release/bundle
OUT=$TARGET_DIR/release-macos/$VERSION
rm -rf "$OUT" && mkdir -p "$OUT"
cp "$BUNDLE/dmg/BSCraft Launcher_${VERSION}_universal.dmg" "$OUT/bsclauncher-$VERSION-macos.dmg"
cp "$BUNDLE/macos/BSCraft Launcher.app.tar.gz" "$OUT/bsclauncher-$VERSION-macos.app.tar.gz"
cp "$BUNDLE/macos/BSCraft Launcher.app.tar.gz.sig" "$OUT/bsclauncher-$VERSION-macos.app.tar.gz.sig"

echo
echo "Built $OUT:"
ls -lh "$OUT"
lipo -archs "$BUNDLE/macos/BSCraft Launcher.app/Contents/MacOS/bscraft-launcher"
codesign -dv "$BUNDLE/macos/BSCraft Launcher.app" 2>&1 | grep -E '^(Authority|Signature|TeamIdentifier)=' || true
echo
echo "Next: upload the .dmg and .app.tar.gz to /var/www/bscraft/launcher/, then write version.json"
echo "with tools/launcher-version.py (README › Releasing the launcher)."
