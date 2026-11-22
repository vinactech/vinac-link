#!/bin/bash
# VINAC Link.app/Contents/MacOS/VINAC Link: starts the included runtime in the background and opens
# the page; on failure it keeps the error in a private startup log and offers "Show startup log".
R="$(cd "$(dirname "$0")/../Resources" && pwd)" || exit 1
. "$R/mac-runtime.sh" || exit 1
VINAC_RESOURCES="$R"
vinac_start "$@"
exit $?
