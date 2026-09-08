---
id: space-cli
name: Construct CLI — install, auth, publish, maintenance
description: The @construct-space/cli tool — how to install it, log in to Construct, run build/dev/check/clean, and publish spaces to the registry
trigger: "construct login,construct logout,construct whoami,construct publish,construct install,construct update,construct clean,cli install,cli login,not logged in,auth token,publish space,install cli,bun install -g,construct cli,--private,private publish,org-private,org private,internal space,internal-only,publish privately,publish for org"
category: construct
---

# Construct CLI

The `construct` CLI (`@construct-space/cli`, source: `packages/construct-cli/`)
is the user-facing tool for scaffolding, building, and publishing Spaces.
The operator calls a subset of commands via `space_*` tools; the rest
(auth, publish, update) the user runs directly in their shell.

## Install / update

```bash
bun install -g @construct-space/cli       # first install
bun add -g @construct-space/cli@latest    # upgrade
construct --version                        # verify
construct update                           # self-upgrade the installed CLI
```

If `construct` isn't on PATH after install, `~/.bun/bin` isn't in
`$PATH`. Add `export PATH="$HOME/.bun/bin:$PATH"` to the shell profile.

## Auth

```bash
construct login         # picks a desktop profile, or paste a token
construct login --token $TOKEN   # CI / headless
construct logout
construct whoami        # prints current user + portal
```

`login` auto-detects profiles signed into the Construct desktop app
(reads `auth.json` from the app data dir) and offers them as choices.
Falls back to paste-a-token from
`https://my.construct.space/settings/tokens`. Credentials are stored
in the CLI's own config, not the desktop app's.

Most commands below require auth.

## Space lifecycle

All run inside a space directory (cwd must contain `space.manifest.json`).

```bash
construct scaffold [name]   # aliases: new, create — create space-<name>/ (prompts if name omitted)
construct dev               # watch + regenerate entry.ts + vite dev server
construct build             # generate entry.ts, bundle to dist/ (IIFE)
construct build --entry-only  # regenerate src/entry.ts without running vite
construct check             # vue-tsc + eslint
construct validate          # verify space.manifest.json
construct clean             # remove dist/ and .vite/
construct clean --all       # also remove node_modules + bun.lock
construct install           # alias: run — copy dist/ into Construct's
                            # spaces dir for local use (dev install)
construct publish                 # publish to public registry (requires login)
construct publish --bump patch    # bump version before publishing
construct publish -y              # skip confirmation prompts
construct publish --private       # publish for owning org only (requires org publisher key)
```

**Operator mapping:** the operator invokes `space_create`, `space_build`,
`space_install`, `space_check`, `space_validate`, `space_clean` for these
— do NOT shell out to `construct` from the agent when a `space_*` tool
exists. Use the tools so the operator can log, permission-gate, and
stream results.

When the user asks to **publish**, delegate: tell them to run
`construct publish` in their terminal (it needs interactive auth +
confirmation) rather than driving it via bash. Offer to validate +
build first via `space_validate` + `space_build`.

## Audience: public vs org-private

Two distribution channels — pick before publishing:

| Want | Run | Required auth |
|---|---|---|
| Public catalog (everyone sees + can install) | `construct publish` | personal or org publisher key |
| Org-only catalog (only members of the owning org see it) | `construct publish --private` | org publisher key |

Org-private flow:
1. `--private` only works when the active publisher is an **org** publisher key. Personal publishers are public-only — the CLI bails locally with a clear error before uploading.
2. Oracle staff still review every submission. `--private` controls catalog *reach*, not whether the space goes through review.
3. Once approved, marketplace listings filter rows by the caller's org: anonymous and other-org callers don't see the space; members of the owning org see it alongside public spaces.
4. Re-publishing without `--private` flips the space back to public on the next approval. Visibility is set per-publish, not sticky.

When to suggest `--private`:
- Internal company tooling never meant for outside the org.
- Spaces that read org-private graph data (`scopes: ['org']` models) — public users couldn't use them anyway.
- Pre-release / beta spaces the org wants to dogfood before going public.

**Do not confuse with `manifest.scopes`.** `scopes: Array<'app' | 'org'>` (in space.manifest.json) is *where the Space appears in the host UI* + *how its data is tenanted*. `--private` is *who sees the published bundle in the catalog*. They're orthogonal — a `scopes: ['app']` space can be published `--private`, and a `scopes: ['org']` space can be published publicly. See `skill:space-scope`.

## Graph subcommands

See the `graph` skill for semantics. CLI surface:

```bash
construct graph init                         # scaffold src/models/ + wire deps
construct graph generate <Model> <fields>    # alias: g — create a model file
construct graph push                         # register models with the service
construct graph fork <new-space-id>          # fork sticky schema ownership
construct graph migrate                      # preview schema diff
construct graph migrate --apply              # apply destructive changes
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| `construct: command not found` | `bun install -g @construct-space/cli`; check `~/.bun/bin` in PATH |
| `Not logged in` on publish | `construct login` first; confirm with `construct whoami` |
| `No space.manifest.json found` | Wrong cwd — must be inside a `space-*` directory |
| `--private requires an org publisher key` | Active credential is personal. Enrol an org from the desktop app (Org Settings → Developer), then re-run. |
| Build fails with missing deps | First build auto-runs `bun install` (lazy — see scaffold skill); re-run `space_build` |
| `construct update` refuses | Version already current — use `bun add -g @construct-space/cli@latest` to force |

## When to surface the CLI to the user

- User wants to **publish** their Space → they must run `construct publish`
  themselves (needs TTY for auth/prompts).
- User sees `command not found` in any TUI → suggest the install one-liner.
- User asks "am I logged in?" → `construct whoami`.
- User wants to reset / start fresh → `construct clean --all` then
  `space_build` (which reinstalls lazily).
