#!/bin/bash
# VINAC Link: start the service and open its page (macOS; double-click).
cd "$(dirname "$0")" || exit 1
for d in "node/bin" "node/$(uname -m | sed s/x86_64/x64/)/bin"; do [ -x "$PWD/$d/node" ] && PATH="$PWD/$d:$PATH"; done
if ! command -v node >/dev/null 2>&1; then
  for p in /opt/homebrew/bin /usr/local/bin; do [ -x "$p/node" ] && PATH="$p:$PATH"; done
fi
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Install the LTS version from https://nodejs.org (or: brew install node),"
  echo "then double-click this file again."
  read -r -p "Press Return to close." _; exit 1
fi
if ! node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 22 ? 0 : 1)"; then
  echo "Your Node.js is too old. VINAC Link needs Node.js 22 or newer: https://nodejs.org"
  read -r -p "Press Return to close." _; exit 1
fi
if node connector/bin/vinac.mjs start; then
  echo
  echo "If macOS asks whether node may accept incoming connections, choose Allow."
  echo "Next: pair with your other computer on the page that just opened (see START-HERE.html)."
  echo "You can close this window; VINAC Link keeps running in the background."
else
  echo "VINAC Link could not start. Double-click 'Check VINAC Link.command' and send the result to whoever gave you this."
fi
read -r -p "Press Return to close." _
