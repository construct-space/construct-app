---
id: builder-migration
name: Migration and Feasibility
description: Assess or execute framework moves, rewrites, ports, conversions, modernization, Nuxt/Next/Rails/Laravel/Godot/etc. feasibility, or architecture migration plans
trigger: "migration,migrate,convert,port,rewrite,modernize,feasibility,assessment,nuxt,next,rails,laravel,godot,framework move"
category: construct
---

# Migration and Feasibility

Migration work starts with evidence. Do not estimate from vibes or by reading random files in the parent context.

## Discovery

For broad migration or feasibility requests, spawn `builder-explorer` first. Ask for a file:line map of:

- current framework/runtime and entry points
- routes/pages/screens
- data fetching and persistence
- auth/session state
- build/deploy assumptions
- framework-specific APIs that do not transfer cleanly
- tests and verification commands

If the target framework/engine has current-version concerns, research current docs/news before recommending. This matters for fast-moving targets like Godot, Nuxt, Next, mobile export, plugin ecosystems, or hosting constraints.

## Feasibility Report Shape

Return:

- Current architecture: short map, with file references.
- Target fit: what transfers cleanly, what must change.
- Blockers/risks: SSR/client-only APIs, routing, state, auth, assets, build/deploy, plugins.
- Options: incremental migration, parallel rewrite, thin adapter, or no-migration recommendation.
- Effort: small/medium/large with concrete reasons.
- First safe step: one reversible change or proof-of-concept.

## Execution Rules

- Do not start a migration during a feasibility request.
- Preserve behavior before changing frameworks. Add characterization tests or screenshots when possible.
- Migrate in slices: route/page, API boundary, state/data layer, then cleanup.
- Keep old and new paths side by side until the new path is verified.
- Do not delete the old implementation until the replacement is exercised.
