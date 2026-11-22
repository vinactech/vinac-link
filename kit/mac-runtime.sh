#!/bin/bash
# Shared by the macOS app (VINAC Link.app) and the macOS shortcuts in the tester package.
# In the app, only the INCLUDED runtime is used (never an unrelated PATH node). The tester zip has
# no included runtime (no node/ folder); there, and only there, an installed Node.js 22+ is used.
vinac_runtime() {
  VINAC_RESOURCES="$1"
  VINAC_RUNTIME_ERROR=''
  local version major minor arch hardware p
  version="$(/usr/bin/sw_vers -productVersion 2>/dev/null)"
  major="${version%%.*}"; minor="${version#*.}"; minor="${minor%%.*}"
  if [[ ! "$major" =~ ^[0-9]+$ || ! "$minor" =~ ^[0-9]+$ ]]; then
    VINAC_RUNTIME_ERROR='Could not determine the macOS version.'; return 1
  fi
  if [ ! -d "$VINAC_RESOURCES/node" ]; then
    # Tester package (zip): no included runtime, so use an installed Node.js 22 or newer.
    VINAC_NODE=''
    for p in "$(command -v node 2>/dev/null)" /opt/homebrew/bin/node /usr/local/bin/node; do
      if [ -n "$p" ] && [ -x "$p" ] && "$p" -e "process.exit(Number(process.versions.node.split('.')[0]) >= 22 ? 0 : 1)" 2>/dev/null; then
        VINAC_NODE="$p"; return 0
      fi
    done
    VINAC_RUNTIME_ERROR='Node.js 22 or newer is needed for this package. Install the LTS version from https://nodejs.org (or: brew install node), or use the macOS installer, which includes it.'
    return 1
  fi
  if (( major < 13 || (major == 13 && minor < 5) )); then
    VINAC_RUNTIME_ERROR='VINAC Link requires macOS 13.5 or newer. This copy cannot run on this macOS version.'; return 1
  fi
  hardware="$(/usr/sbin/sysctl -n hw.optional.arm64 2>/dev/null)"
  if [ "$hardware" = '1' ]; then arch=arm64
  else
    arch="$(/usr/bin/uname -m)"
    case "$arch" in x86_64) arch=x64;; arm64) arch=arm64;;
      *) VINAC_RUNTIME_ERROR='This Mac architecture is not supported by this installer.'; return 1;;
    esac
  fi
  VINAC_NODE="$VINAC_RESOURCES/node/$arch/bin/node"
  if [ ! -f "$VINAC_NODE" ] || [ ! -x "$VINAC_NODE" ]; then
    VINAC_RUNTIME_ERROR='The included Node.js runtime is missing or is not executable. Copy the complete VINAC Link.app from the installer; do not copy only its launcher.'; return 1
  fi
}

vinac_error_summary() {
  if [ -n "$VINAC_RUNTIME_ERROR" ]; then printf '%s\n' "$VINAC_RUNTIME_ERROR"
  elif /usr/bin/grep -Eqi 'security:|SecKeychain|User interaction is not allowed|errSec' "$1"; then
    printf '%s\n' 'macOS Keychain could not release the device key. Unlock your login keychain and allow the access request, then try again. Your existing keys and pairings have not been reset.'
  elif /usr/bin/grep -Eqi 'EADDRINUSE|address already in use' "$1"; then
    printf '%s\n' 'Another process is using the VINAC Link ports. Close other VINAC Link copies and try again. No unrelated process was stopped.'
  elif /usr/bin/grep -Eqi 'bad CPU type|incompatible architecture|dyld:' "$1"; then
    printf '%s\n' 'The included runtime could not load. Use the complete macOS installer on macOS 13.5 or newer. See the startup log for the loader error.'
  else
    printf '%s\n' 'Startup stopped before the service was ready. Show the startup log for the exact error. Your keys and pairings have not been reset.'
  fi
}

vinac_start() {
  local dir status=1 message choice
  umask 077
  dir="${VINAC_DIAGNOSTIC_LOG_DIR:-$HOME/Library/Logs/VINAC Link}"
  if ! /bin/mkdir -p "$dir"; then
    dir="${TMPDIR:-/tmp}"
  fi
  VINAC_STARTUP_LOG="$(/usr/bin/mktemp "$dir/vinac-startup.XXXXXX")" || return 1
  if vinac_runtime "$VINAC_RESOURCES"; then
    "$VINAC_NODE" "$VINAC_RESOURCES/connector/bin/vinac.mjs" start "$@" 2>"$VINAC_STARTUP_LOG"
    status=$?
  else
    printf '%s\n' "$VINAC_RUNTIME_ERROR" >"$VINAC_STARTUP_LOG"
  fi
  if [ "$status" -eq 0 ]; then /bin/rm -f "$VINAC_STARTUP_LOG"; return 0; fi
  message="$(vinac_error_summary "$VINAC_STARTUP_LOG")"
  printf '%s\nStartup log: %s\n' "$message" "$VINAC_STARTUP_LOG" >&2
  if [ "${VINAC_NO_BROWSER:-${AGENTLINK_NO_BROWSER:-}}" != '1' ]; then
    choice="$(/usr/bin/osascript - "$message" "$VINAC_STARTUP_LOG" <<'APPLESCRIPT'
on run args
  set answer to display alert "VINAC Link could not start" message (item 1 of args) buttons {"OK", "Show startup log"} default button "OK"
  if button returned of answer is "Show startup log" then return "show"
end run
APPLESCRIPT
)"
    if [ "$choice" = 'show' ]; then /usr/bin/open -a TextEdit "$VINAC_STARTUP_LOG"; fi
  fi
  return "$status"
}
