#!/bin/bash
# VINAC Link: check that everything works (changes nothing). Send the result as feedback.
cd "$(dirname "$0")" || exit 1
for d in "node/bin" "node/$(uname -m | sed s/x86_64/x64/)/bin"; do [ -x "$PWD/$d/node" ] && PATH="$PWD/$d:$PATH"; done
for p in /opt/homebrew/bin /usr/local/bin; do [ -x "$p/node" ] && PATH="$p:$PATH"; done
node connector/bin/vinac.mjs doctor
echo
read -r -p "Press Return to close." _
