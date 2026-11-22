#!/bin/bash
# VINAC Link: stop the background service (macOS).
D="$(cd "$(dirname "$0")" && pwd)" || exit 1
. "$D/mac-runtime.sh" || exit 1
VINAC_RESOURCES="$D"
if vinac_runtime "$D"; then "$VINAC_NODE" "$D/connector/bin/vinac.mjs" stop "$@"; else printf '%s\n' "$VINAC_RUNTIME_ERROR" >&2; fi
read -r -p "Press Return to close." _
