# Contributing to Construct

## Branch Strategy

```
main        ← production releases only (protected)
beta        ← pre-release testing
dev         ← integration branch, all PRs merge here
feat/*      ← feature branches (off dev)
fix/*       ← bugfix branches (off dev)
chore/*     ← maintenance branches (off dev)
```

**Never push directly to `main`, `beta`, or `dev`.** All changes go through feature branches + pull requests.

## Workflow

### 1. Start a feature

```bash
git checkout dev
git pull origin dev
git checkout -b feat/my-feature
```

### 2. Work and commit

```bash
# Make changes...
git add <files>
git commit -m "feat(scope): description"
```

### 3. Push and create PR

```bash
git push -u origin feat/my-feature
gh pr create --base dev --title "feat: my feature" --body "..."
```

### 4. Review and merge

- PR must be reviewed before merging into `dev`
- Squash merge preferred for clean history
- Delete branch after merge

### 5. Release flow

```
dev → beta (PR: "Release candidate X.Y.Z")
beta → main (PR: "Release X.Y.Z")
main: tag vX.Y.Z → release.sh triggers CI
```

## Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(agent): add block-based session model
fix(operator): sanitize tool names for Anthropic API
chore(deps): update Vue to 3.6 beta.8
docs(sdk): add SDK usage sections to component pages
refactor(sidebar): extract 3D rotation logic
test(session): add round-trip persistence tests
```

**Scopes:** agent, operator, sidebar, toolbar, space, sdk, design, vibe, architect, auth, settings

## Code Standards

- **TypeScript** — strict mode, no `any` unless unavoidable
- **Vue** — `<script setup lang="ts">`, composables over mixins
- **Go** — `go vet`, `go test ./...` before committing
- **Tests** — required for new features, run before PR
- **Lint** — `bun run lint` must pass

## Repos

| Repo | Purpose | Stack |
|------|---------|-------|
| construct | Desktop app | Vue 3 + Tauri 2 |
| construct-operator | AI backend | Go |
| construct-sdk | Space SDK | TypeScript |
| design-system | Design docs | Vue 3 + Vite |
| releases | CI/CD | GitHub Actions |

All repos follow the same branch strategy.
