#!/bin/sh
# VINAC Link {{version}} installer for macOS and Linux (https://vinac.tech).
#   curl -fsSL https://vinac.tech/install.sh | sh
# Downloads the installer from vinac.tech, checks its SHA-256 against
# https://vinac.tech/download/SHA256SUMS.txt, and installs it for this user. Node.js is included.
# Source: https://github.com/vinactech/vinac-link/blob/main/site/install.sh
set -eu
V="{{version}}"
BASE="https://vinac.tech/download"

say() { printf '%s\n' "$*"; }
die() { printf 'VINAC Link: %s\n' "$*" >&2; exit 1; }
command -v curl >/dev/null 2>&1 || die "curl is needed."
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT INT TERM

sha256() {
  if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | cut -d' ' -f1
  else sha256sum "$1" | cut -d' ' -f1; fi
}
fetch() {
  say "Downloading $1 ..."
  curl -fSL --progress-bar "$BASE/$1" -o "$TMP/$1"
  want=$(grep "  $1\$" "$TMP/SHA256SUMS.txt" | cut -d' ' -f1 || true)
  [ -n "$want" ] || die "no published checksum for $1; nothing installed."
  [ "$(sha256 "$TMP/$1")" = "$want" ] || die "checksum mismatch for $1; nothing installed."
  say "Checksum OK."
}

curl -fsSL "$BASE/SHA256SUMS.txt" -o "$TMP/SHA256SUMS.txt"

case "$(uname -s)" in
  Darwin)
    F="VINAC-Link-$V.dmg"
    fetch "$F"
    if [ -w /Applications ]; then APPS=/Applications; else APPS="$HOME/Applications"; mkdir -p "$APPS"; fi
    OLD="$APPS/VINAC Link.app"
    if [ -d "$OLD" ]; then
      # Stop the running service of the old version before replacing it (best effort).
      for A in arm64 x64; do
        N="$OLD/Contents/Resources/node/$A/bin/node"
        if [ -x "$N" ] && "$N" "$OLD/Contents/Resources/connector/bin/vinac.mjs" stop >/dev/null 2>&1; then break; fi
      done
    fi
    MNT="$TMP/mnt"; mkdir "$MNT"
    hdiutil attach -nobrowse -readonly -mountpoint "$MNT" "$TMP/$F" >/dev/null
    rm -rf "$OLD"
    cp -R "$MNT/VINAC Link.app" "$APPS/"
    hdiutil detach "$MNT" >/dev/null
    say "Installed: $APPS/VINAC Link.app"
    open "$APPS/VINAC Link.app"
    ;;
  Linux)
    [ "$(uname -m)" = x86_64 ] || die "Linux on $(uname -m) has no installer yet. See https://vinac.tech/docs/getting-started.html"
    F="VINAC-Link-$V-linux-x64.tar.gz"
    fetch "$F"
    tar -xzf "$TMP/$F" -C "$TMP"
    sh "$TMP/vinac-link-$V/install.sh"
    ;;
  *)
    die "this script is for macOS and Linux. On Windows run: irm https://vinac.tech/install.ps1 | iex"
    ;;
esac

say ""
say "Next: pair a second computer in the VINAC Link window, then connect your agent: vinac setup"
