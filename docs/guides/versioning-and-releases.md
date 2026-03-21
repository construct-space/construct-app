# Versioning & Releases

## Version Source of Truth

**Git tags** on the `construct-space/releases` repo are the single source of truth.

The release script reads the latest tag and bumps from there. No `.version` file. `package.json`, `tauri.conf.json`, `Cargo.toml`, and `main.go` are outputs — updated automatically by the release script.

## Semver

```
MAJOR.MINOR.PATCH
  │     │     └── bug fixes, small improvements (auto-bumped)
  │     └──────── new features, breaking space API changes
  └────────────── major milestones (1.0 = gold release)
```

## Current Phase: Pre-Gold

Everything goes to `main`. Simple patch bumps.

```bash
cd releases/
./release.sh           # auto-bump: 0.6.0 → 0.6.1
./release.sh 0.7.0     # manual: minor bump for new features
```

The script:
1. Bumps operator (`cmd/operator/main.go`)
2. Bumps construct (`package.json`, `tauri.conf.json`, `Cargo.toml`)
3. Commits + pushes both repos
4. Triggers CI → builds macOS/Windows/Linux → creates GitHub release

## Post-Gold: Release Channels

After v1.0 (gold release), we switch to branching + channels:

```
main ──────────────────────────── stable (users)
  │
  └── beta ────────────────────── beta (testers)
        │
        └── dev ───────────────── dev (developers)
              │
              ├── feat/...
              └── fix/...
```

### Channels

| Channel | Branch | Tag Format | Who | Updater |
|---------|--------|------------|-----|---------|
| **stable** | `main` | `v1.0.0` | Users | `/update/stable` |
| **beta** | `beta` | `v1.1.0-beta.1` | Testers | `/update/beta` |
| **dev** | `dev` | `v1.1.0-dev.42` | Developers | `/update/dev` |

### Release Flow (Post-Gold)

```
feat/my-feature → PR → dev
                         │
                    dev → PR → beta (release candidate)
                                │
                           beta → PR → main (stable release)
                                        │
                                   tag v1.x.x → CI → GitHub Release
```

### Channel Commands (Post-Gold)

```bash
./release.sh              # stable: auto-bump patch from latest stable tag
./release.sh 1.2.0        # stable: manual minor/major bump
./release.sh 1.2.0-beta.1 beta   # beta channel
./release.sh 1.2.0-dev.1 dev     # dev channel
```

### Tauri Updater

Each channel has its own `latest.json` endpoint:
- `https://releases.construct.space/update/stable/latest.json`
- `https://releases.construct.space/update/beta/latest.json`
- `https://releases.construct.space/update/dev/latest.json`

Users choose their channel in Settings → Updates.

## What Gets Versioned

| File | Location | Updated by |
|------|----------|------------|
| `const Version` | `construct-operator/cmd/operator/main.go` | `release.sh` |
| `"version"` | `construct/package.json` | `release.sh` |
| `"version"` | `construct/src-tauri/tauri.conf.json` | `release.sh` |
| `version =` | `construct/src-tauri/Cargo.toml` | `release.sh` |

**Operator version = Construct version.** Always. Both bumped together. Operator is bundled with the app — no separate update mechanism.

## Rules

1. **Never manually edit version numbers** — always use `release.sh`
2. **Never skip versions** — if latest is 0.6.0, next is 0.6.1 (patch) or 0.7.0 (minor)
3. **Git tags are immutable** — once released, a version is forever
4. **Operator and Construct share the same version** — one release, one version
