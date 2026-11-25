#!/bin/bash
# VINAC Link: connect an AI agent app (macOS). Connects Claude Code if you say yes (no `claude`
# command needed; its settings are backed up first); for other apps it prints what to paste.
cd "$(dirname "$0")" || exit 1
. "$PWD/mac-runtime.sh" || exit 1
vinac_runtime "$PWD" || { printf '%s\n' "$VINAC_RUNTIME_ERROR"; read -r -p "Press Return to close." _; exit 1; }
"$VINAC_NODE" connector/bin/vinac.mjs setup
echo
if [ -d "$HOME/.claude" ] || [ -f "$HOME/.claude.json" ]; then
  read -r -p "Connect Claude Code to VINAC Link now? [y/N] " yn
  if [ "$yn" = "y" ] || [ "$yn" = "Y" ]; then
    "$VINAC_NODE" connector/bin/vinac.mjs connect claude
    echo
    echo "Start a new Claude Code session and ask: \"is VINAC Link working?\""
  fi
else
  echo "(Claude Code was not found on this computer, so nothing was added. Use the steps above for your app.)"
fi
read -r -p "Press Return to close." _
