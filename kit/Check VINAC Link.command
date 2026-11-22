#!/bin/bash
# VINAC Link: check that everything works (changes nothing). Send the result as feedback.
D="$(cd "$(dirname "$0")" && pwd)" || exit 1
. "$D/mac-runtime.sh" || exit 1
VINAC_RESOURCES="$D"
if vinac_runtime "$D"; then
  echo "Runtime: $VINAC_NODE"
  "$VINAC_NODE" -p '"Node.js " + process.version + " · " + process.arch + " · " + process.platform'
  "$VINAC_NODE" "$D/connector/bin/vinac.mjs" doctor "$@"
else
  printf '%s\n' "$VINAC_RUNTIME_ERROR" >&2
fi
echo "Startup logs, if a launch failed: $HOME/Library/Logs/VINAC Link"
read -r -p "Press Return to close." _
