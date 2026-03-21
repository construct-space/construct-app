#!/usr/bin/env bash
# Local dev release — builds signed app for current platform.
# For CI releases (all platforms), use ../releases/release.sh
#
# Usage:
#   bun run release              # build with current version
#   bun run release 0.7.0        # build with specific version
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

VERSION="${1:-$(grep '"version"' "$PROJECT_ROOT/package.json" | head -1 | sed 's/.*"\([0-9.]*\)".*/\1/')}"

echo "Building Construct v${VERSION} (local release)"
echo ""

# 1. Build operator
echo "==> Building operator..."
bash "$SCRIPT_DIR/build-operator.sh"

# 2. Build Tauri app
echo ""
echo "==> Building desktop app..."
cd "$PROJECT_ROOT"
cargo tauri build

# 3. Show output
BUNDLE_DIR="$PROJECT_ROOT/desktop/target/release/bundle"
echo ""
echo "Done! Artifacts:"
find "$BUNDLE_DIR" -type f \( -name "*.dmg" -o -name "*.app.tar.gz" -o -name "*.msi" -o -name "*.AppImage" -o -name "*.deb" \) 2>/dev/null | while read f; do
  echo "  $(basename "$f") ($(du -h "$f" | cut -f1))"
done
