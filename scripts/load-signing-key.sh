#!/usr/bin/env bash
# Source this file to export Tauri updater signing env vars.
# Uses the same key as construct-releases: ~/.tauri/construct.key
# If CI/env already provides the key (GitHub Actions secrets), do nothing.
if [ -n "${TAURI_SIGNING_PRIVATE_KEY:-}" ]; then
  return 0 2>/dev/null || exit 0
fi
KEY_PATH="${TAURI_SIGNING_KEY_PATH:-$HOME/.tauri/construct.key}"
if [ ! -f "$KEY_PATH" ]; then
  echo "Note: no signing key at $KEY_PATH and TAURI_SIGNING_PRIVATE_KEY not set — continuing without updater signing." >&2
  return 0 2>/dev/null || exit 0
fi
export TAURI_SIGNING_PRIVATE_KEY="$(cat "$KEY_PATH")"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}"
