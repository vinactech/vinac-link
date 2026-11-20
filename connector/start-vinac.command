#!/bin/bash
# Double-click on a Mac to start VINAC Link and open its page.
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Get it from https://nodejs.org (version 22 or newer)."
  read -r -p "Press Return to close."; exit 1
fi
node bin/vinac.mjs daemon --open
