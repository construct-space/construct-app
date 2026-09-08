#!/bin/bash
# Build the Go brain sidecar for the current platform.
# Places binary in desktop/bin/ for Tauri sidecar bundling.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BRAIN_DIR="$PROJECT_ROOT/brain"
BIN_DIR="$PROJECT_ROOT/desktop/bin"

OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

case "$ARCH" in
    x86_64)         GOARCH="amd64"; TAURI_ARCH="x86_64" ;;
    arm64|aarch64)  GOARCH="arm64"; TAURI_ARCH="aarch64" ;;
    *)              echo "Unsupported architecture: $ARCH"; exit 1 ;;
esac

case "$OS" in
    darwin)              GOOS="darwin";  TAURI_OS="apple-darwin";       EXT="" ;;
    linux)               GOOS="linux";   TAURI_OS="unknown-linux-gnu";  EXT="" ;;
    mingw*|msys*|cygwin*) GOOS="windows"; TAURI_OS="pc-windows-msvc";   EXT=".exe" ;;
    *)                   echo "Unsupported OS: $OS"; exit 1 ;;
esac

BINARY_NAME="construct-brain-${TAURI_ARCH}-${TAURI_OS}${EXT}"

echo "Building brain sidecar ($GOOS/$GOARCH)..."

mkdir -p "$BIN_DIR"

cd "$BRAIN_DIR"
GOOS=$GOOS GOARCH=$GOARCH go build -o "$BIN_DIR/$BINARY_NAME" .

echo "Brain built: desktop/bin/$BINARY_NAME"
