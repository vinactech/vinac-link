#!/bin/bash
# VINAC Link: connect an AI agent app (macOS). Adds the Claude Code plugin if you say yes;
# for other apps it prints what to paste.
cd "$(dirname "$0")" || exit 1
. "$PWD/mac-runtime.sh" || exit 1
vinac_runtime "$PWD" || { printf '%s\n' "$VINAC_RUNTIME_ERROR"; read -r -p "Press Return to close." _; exit 1; }
# Where the Claude Code CLI usually lives (it isn't on a double-clicked script's PATH).
for p in /opt/homebrew/bin /usr/local/bin "$HOME/.local/bin" "$HOME/.claude/local"; do [ -d "$p" ] && PATH="$PATH:$p"; done
"$VINAC_NODE" connector/bin/vinac.mjs setup
echo
if command -v claude >/dev/null 2>&1; then
  read -r -p "Add VINAC Link to Claude Code now? [y/N] " yn
  if [ "$yn" = "y" ] || [ "$yn" = "Y" ]; then
    claude plugin marketplace add "$(pwd)" && claude plugin install vinac-link@vinac
    echo
    echo "Done. Start a new Claude Code session and ask: \"is VINAC Link working?\""
  fi
else
  echo "(Claude Code was not found on this computer, so nothing was added. Use the steps above for your app.)"
fi
read -r -p "Press Return to close." _
