---
id: builder-stack
name: Reading the Stack
description: Detect framework, package manager, and conventions before writing code
trigger: "stack,framework,package manager,tooling,dependencies,setup,bun,npm,pnpm,yarn,vite,next,react,vue,svelte"
category: construct
---

# Read the Stack First

Before you write code in a repo you haven't written in, spend two minutes learning the stack. Writing against the wrong framework or installing a fifth package manager is the single most wasted set of tokens.

## Two-Minute Scan

Read, in order:

1. `CONSTRUCT.md` — agent-maintained operational map. If missing in a non-trivial existing project, read root imports, spawn `builder-explorer` for a project map, then create it before implementation work in CODE mode.
2. `CLAUDE.md` / `AGENTS.md` — read-only portability imports, if present.
3. `.construct/rules/*.md` — human policy, when relevant.
4. `README.md` — intent, how to run.
5. Manifest: `package.json` / `pyproject.toml` / `go.mod` / `Cargo.toml` — framework, deps, scripts.
6. Lockfile name — `bun.lock` / `package-lock.json` / `pnpm-lock.yaml` / `yarn.lock` / `uv.lock`. **This dictates the package manager.** Never switch.
7. Top-level directory listing — `src/`, `app/`, `pages/`, `components/`, etc. Tells you conventions before any code.
8. A config file if one stands out — `vite.config.*`, `next.config.*`, `tailwind.config.*`, `tsconfig.json`.

That's it. Don't open 20 files. If `CONSTRUCT.md` is missing or the request is broad exploration/feasibility, spawn `builder-explorer` after context imports instead of continuing the scan in the parent.

## Creating CONSTRUCT.md

Use `builder-explorer` to gather:

- top-level directories and what owns them
- framework/runtime, package manager, and commands
- important entry points and routes
- data/storage/auth boundaries
- conventions and gotchas with file:line evidence

Then write a short `CONSTRUCT.md` with pointers, not source dumps. In PLAN mode, only plan this write; CODE mode performs it.

## Match What's There

- Use the lockfile's package manager. `bun.lock` → bun. No exceptions.
- Use the project's styling system. Tailwind → Tailwind. CSS modules → CSS modules. Don't introduce a second one.
- Use the project's state library. If they're on Pinia/Redux/Zustand, stay there.
- Use the project's router. Don't install `react-router` into a Next.js app.
- Use the project's test runner. Vitest → Vitest. Jest → Jest.
- Use the project's lint/format config. Don't reformat a file with different rules than the repo uses.

If something is missing (no test runner at all, no linter), ask the user if they want one added — don't silently add it.

## When the Stack Is Unusual

Some repos carry the author's strong opinions (custom build, unusual framework version, hand-rolled tooling). Read one or two representative files before writing. Match the style. The goal isn't to showcase your preferences — it's to leave the repo coherent.

## Framework-Specific Sanity

- **Next.js** — app router vs. pages router matters. `app/` = server components by default. Don't mix unless the project does.
- **Vue** — SFC style (`<script setup lang="ts">` is standard; don't regress to Options API).
- **React** — functional + hooks. Class components only if the file you're editing is already classes.
- **Svelte** — runes vs. pre-runes; check `svelte.config.js`.
- **Go** — match the module path in `go.mod`; don't mint a new one.
- **Python** — match the version pinned in `pyproject.toml` / `.python-version`.

When unsure, one `grep` or one `read_file` tells you more than a confident guess.

## Signal You Got It Wrong

If you're about to write `npm install` in a project with `bun.lock`, stop. If you're about to add `tailwindcss` to a project using `styled-components`, stop. These mistakes feel small and compound fast — the user will either reject your change or live with an inconsistent codebase forever.
