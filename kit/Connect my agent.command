#!/bin/bash
# VINAC Link: connect an AI agent app (macOS). Adds the Claude Code plugin if you say yes;
# for other apps it prints what to paste.
cd "$(dirname "$0")" || exit 1
for d in "node/bin" "node/$(uname -m | sed s/x86_64/x64/)/bin"; do [ -x "$PWD/$d/node" ] && PATH="$PWD/$d:$PATH"; done
for p in /opt/homebrew/bin /usr/local/bin "$HOME/.local/bin" "$HOME/.claude/local"; do [ -d "$p" ] && PATH="$p:$PATH"; done
node connector/bin/vinac.mjs setup
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
