#!/bin/sh
# VINAC Link: start the service and open its page (Linux). Run: sh start-linux.sh
cd "$(dirname "$0")" || exit 1
for d in "node/bin" "node/$(uname -m | sed s/x86_64/x64/)/bin"; do [ -x "$PWD/$d/node" ] && PATH="$PWD/$d:$PATH"; done
command -v node >/dev/null 2>&1 || { echo "Install Node.js 22 or newer first (https://nodejs.org or your package manager)."; exit 1; }
node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 22 ? 0 : 1)" || { echo "VINAC Link needs Node.js 22 or newer."; exit 1; }
command -v secret-tool >/dev/null 2>&1 || echo "Note: VINAC Link keeps keys in the system keyring through secret-tool (package libsecret-tools on Debian/Ubuntu)."
node connector/bin/vinac.mjs start
