#!/usr/bin/env bash
# Sync .version → package.json, tauri.conf.json, Cargo.toml
# Usage: ./scripts/sync-version.sh [version]
# If no version given, reads from .version file.
set -euo pipefail

cd "$(dirname "$0")/.."

if [ -n "${1:-}" ]; then
  VERSION="$1"
  echo "$VERSION" > .version
else
  VERSION="$(cat .version | tr -d '[:space:]')"
fi

if [ -z "$VERSION" ]; then
  echo "ERROR: No version found. Pass as argument or create .version file."
  exit 1
fi

echo "Syncing version: $VERSION"

# package.json
sed -i '' "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" package.json
echo "  ✓ package.json"

# tauri.conf.json
sed -i '' "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" src-tauri/tauri.conf.json
echo "  ✓ src-tauri/tauri.conf.json"

# Cargo.toml (only the package version, not dependency versions)
sed -i '' "3s/version = \"[^\"]*\"/version = \"$VERSION\"/" src-tauri/Cargo.toml
echo "  ✓ src-tauri/Cargo.toml"

echo "Done — all files at v$VERSION"
