#!/usr/bin/env bash
# Wraps the Tauri dev binary in a .app bundle so macOS TCC permissions work.
# Used as: cargo tauri dev --runner scripts/dev-runner.sh
set -e

BINARY="$1"
shift

APP_DIR="$BINARY.app"
CONTENTS="$APP_DIR/Contents"
MACOS="$CONTENTS/MacOS"
BINARY_NAME=$(basename "$BINARY")

# Create .app bundle structure
mkdir -p "$MACOS"

# Copy binary
cp "$BINARY" "$MACOS/$BINARY_NAME"

# Copy Info.plist from desktop/ (next to tauri.conf.json)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLIST="$SCRIPT_DIR/../desktop/Info.plist"
if [ -f "$PLIST" ]; then
  cp "$PLIST" "$CONTENTS/Info.plist"
  # Inject CFBundleExecutable so macOS knows which binary to run
  /usr/libexec/PlistBuddy -c "Delete :CFBundleExecutable" "$CONTENTS/Info.plist" 2>/dev/null || true
  /usr/libexec/PlistBuddy -c "Add :CFBundleExecutable string $BINARY_NAME" "$CONTENTS/Info.plist"
fi

# Run the .app bundle
exec open -W "$APP_DIR" --args "$@"
