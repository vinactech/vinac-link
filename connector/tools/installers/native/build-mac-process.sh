#!/bin/bash
# Compile locally on macOS before signing. Does not install or start a service.
set -eu
here="$(cd "$(dirname "$0")" && pwd)"
scratch="$(/usr/bin/mktemp -d "${TMPDIR:-/tmp}/vinac-native.XXXXXX")"
trap '/bin/rm -rf "$scratch"' EXIT
for arch in arm64 x86_64; do
  /usr/bin/xcrun clang -arch "$arch" -mmacosx-version-min=13.5 -O2 -Wall -Wextra -Werror \
    "$here/mac-process.c" -framework Security -framework CoreFoundation -o "$scratch/$arch"
done
/usr/bin/xcrun lipo -create "$scratch/arm64" "$scratch/x86_64" -output "$here/../mac-process"
/bin/chmod 755 "$here/../mac-process"
echo 'Compiled universal mac-process. Sign it with Developer ID before signing the app.'
