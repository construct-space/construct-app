# Construct

Desktop app built with Vue 3 + Tauri 2.

## Release Process

Releases are handled via a **separate repo**: `../construct-releases/`

```bash
cd ../construct-releases
./release.sh <version> [branch]
# Example: ./release.sh 0.3.0
# Example: ./release.sh 0.3.0 feature-branch
```

This triggers a GitHub Actions workflow on `construct-space/releases` that:
- Builds Tauri binaries for macOS (aarch64 + x86_64), Windows, and Linux
- Code-signs macOS builds
- Creates a GitHub release with assets
- Publishes updater JSON for in-app updates

Do NOT manually bump version in `package.json` or `tauri.conf.json` — the CI workflow handles versioning.

## Dev

```bash
cargo tauri dev     # Start dev (builds operator, then launches Tauri)
bun run dev         # Frontend only
```

## Key Paths

- `src-tauri/` — Rust/Tauri backend
- `src/` — Vue 3 frontend
- `src/pages/` — Page components (routed)
- `src/composables/` — Shared logic
- `src/stores/` — Pinia stores
- `src/spaces/` — Dynamic space loader
- `src/operator/` — Operator client, useAssistant, types
- Operator binary: `src-tauri/bin/construct-operator-aarch64-apple-darwin`
