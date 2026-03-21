# Getting Started

## Prerequisites

- **Node.js** 20+ (via nvm or brew)
- **Bun** — `curl -fsSL https://bun.sh/install | bash`
- **Rust** — `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
- **Go** 1.23+ — `brew install go`
- **Tauri CLI** — `cargo install tauri-cli`

## Clone

```bash
mkdir ~/Construct && cd ~/Construct
git clone git@github.com:construct-space/construct.git
git clone git@github.com:construct-space/construct-operator.git
```

## Install Dependencies

```bash
cd construct
bun install
```

## Run Development

```bash
# Full desktop app (builds operator + launches Tauri)
bun run tauri:dev

# Frontend only (no operator, no Tauri)
bun run dev
```

## Branch Workflow

Always work on feature branches off `dev`:

```bash
git checkout dev
git pull
git checkout -b feat/my-feature

# Work...
git add <files>
git commit -m "feat(scope): description"
git push -u origin feat/my-feature

# Create PR → dev
gh pr create --base dev
```

See [CONTRIBUTING.md](../../CONTRIBUTING.md) for full workflow.

## Project Structure

```
~/Construct/
  construct/             # Desktop app (Vue 3 + Tauri 2)
  construct-operator/    # AI backend (Go)
  construct-sdk/         # Space SDK (TypeScript)
  design-system/         # Design docs (Vue 3 + Vite)
  releases/              # CI/CD (GitHub Actions)
  space-code/            # Code space
  space-design/          # Design space
  space-ai/              # AI space
  space-chat/            # Chat space
  ...                    # Other spaces
```

## Key Commands

| Command | What |
|---------|------|
| `bun run tauri:dev` | Full desktop dev (operator + Tauri) |
| `bun run dev` | Frontend only (Vite on :60200) |
| `bun run build` | Typecheck + production build |
| `bun run typecheck` | vue-tsc --noEmit |
| `bun run lint` | ESLint |
| `bun run test` | Vitest |
| `bun run operator:build` | Build Go operator sidecar |

## Ports

| Port | Service |
|------|---------|
| 60100 | Operator (TCP, prod) |
| 60101 | Bridge listener (prod) |
| 60200 | Vite dev server |
| 60201 | Bridge listener (dev) |

## Release

```bash
cd ../releases
./release.sh          # auto-bump patch from latest
./release.sh 0.5.0    # explicit version
```

This bumps versions in both construct and construct-operator, commits, and triggers CI.
