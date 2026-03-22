# Branching & Releases

## Branches

| Branch | Purpose | Deploys to |
|--------|---------|------------|
| `main` | Stable release | Production |
| `beta` | Pre-release testing | Beta channel |
| `dev` | Active development | Dev builds |
| `feat/*` | Feature work | Nothing (local/PR only) |
| `fix/*` | Bug fixes | Nothing (local/PR only) |

## Flow

```
feat/agent-blocks ──PR──► dev ──PR──► beta ──PR──► main
                          │            │            │
                          │            ▼            ▼
                          │         Beta release  Stable release
                          ▼
                       Dev testing
```

## Day-to-day Work

1. Branch from `dev`:
   ```bash
   git checkout dev
   git pull
   git checkout -b feat/my-feature
   ```

2. Work, commit, push:
   ```bash
   git add .
   git commit -m "feat: add thing"
   git push -u origin feat/my-feature
   ```

3. PR into `dev` — review, merge, delete feature branch

4. When `dev` is stable enough for testing:
   - PR `dev` → `beta`
   - Merge triggers beta release via `releases/release.sh`

5. When `beta` is validated:
   - PR `beta` → `main`
   - Merge triggers stable release

## Releases

Releases are managed from the `construct-space/releases` repo.

```bash
cd ~/Construct/releases

# Beta release (from beta branch)
./release.sh 0.7.0-beta.1

# Stable release (from main)
./release.sh 0.7.0
```

The release script:
1. Bumps version in operator + construct-app
2. Commits and pushes
3. Triggers CI which builds operator from source + Construct app
4. Creates GitHub release with platform binaries

## Version Format

- Stable: `0.7.0`, `0.8.0`, `1.0.0`
- Beta: `0.7.0-beta.1`, `0.7.0-beta.2`
- Git tags on `construct-space/releases` are the source of truth

## Rules

- Never push directly to `main` or `beta`
- Feature branches are short-lived — merge or delete within days
- `dev` can be messy — that's what it's for
- `beta` should be testable — no known broken features
- `main` should be shippable — every commit is a potential release
