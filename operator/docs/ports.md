# Construct Port Allocation

Base range: **60100–60109** (localhost only)

| Port | Service | Direction | Status |
|------|---------|-----------|--------|
| **60100** | Operator TCP | Tauri → Operator | Active |
| **60101** | Desktop Bridge HTTP | Operator → Tauri | Phase 1 |
| **60102** | Operator HTTP/SSE | External clients | Reserved |
| **60103–60109** | Reserved | MCP servers, plugins | Reserved |

## Outside the range

| Port | Service | Notes |
|------|---------|-------|
| **14293** | OAuth callback redirect URI | Not a listener — registered with OAuth providers |
| **3050** | Vite dev server | Dev only (`vite.config.ts`) |

## Rules

- All services bind `127.0.0.1` only — never `0.0.0.0`
- If a port is occupied, the service fails with a clear error (no silent fallback to random ports)
- Constants live in one place per codebase:
  - Go: `internal/config/ports.go`
  - Rust: `src-tauri/src/lib.rs` constants block
  - TypeScript: `src/operator/client.ts`
