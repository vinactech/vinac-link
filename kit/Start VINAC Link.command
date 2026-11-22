#!/bin/bash
# VINAC Link: start the service and open its page (macOS; double-click).
D="$(cd "$(dirname "$0")" && pwd)" || exit 1
. "$D/mac-runtime.sh" || exit 1
VINAC_RESOURCES="$D"
vinac_start "$@"
status=$?
if [ "$status" -eq 0 ]; then
  echo
  echo "If macOS asks whether VINAC Link may find devices on your local network, choose Allow."
  echo "Next: open Pair a device on the page that just opened (see START-HERE.html)."
  echo "VINAC Link is running. You can close this window; it keeps running in the background."
fi
read -r -p "Press Return to close." _
exit "$status"
