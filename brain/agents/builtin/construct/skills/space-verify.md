---
id: space-verify
name: Verification Ladder
description: How to prove a Space actually works — build, check, install, runner, snapshot, adversarial probes
trigger: "verify,validate,check,test,space_check,space_build,space_install,space_runner,space_snapshot"
category: construct
---

# Verification Ladder

"Build succeeded" is not done. "Checks passed" is not done. "Runner opened" is not done. **Verified behavior** is done.

## Baseline (every non-trivial change)

1. `space_validate` — manifest parses and matches schema.
2. `space_check` — vue-tsc + eslint pass.
3. `space_build` — IIFE bundle builds.
4. `space_install` — installs to Space Runner.
5. `space_runner` — Runner opens and loads the Space.

If any step fails, fix the specific error and re-run **only** the failed step plus downstream. Do not re-run the whole ladder on every small edit.

## Runtime Verification (at least one)

- `space_snapshot` — capture rendered state, confirm expected content/structure.
- `space_list_actions` → `space_run_action` — exercise a semantic action.
- Pre-registered per-Space action tools — use when the Space declares them.

Prefer semantic actions over browser DOM. Browser is the last resort.

## Data Verification (if Graph is involved)

- Model push/migrate succeeded.
- Empty state renders gracefully (no records).
- Create → list → update → delete round trip works.
- Relation loads via `include` return correct nested data.

## Adversarial Probes (required)

Before reporting done, try at least one realistic failure path:

- **Empty state** — no data, does the UI degrade well?
- **Invalid input** — does validation fire?
- **Repeated action** — idempotent?
- **Missing fields** — graceful?
- **Route mismatch** — correct page loads?

## When Something Fails

1. Read the exact error. Do not guess.
2. Identify the file the error names.
3. Fix the smallest relevant code.
4. Re-run only the failed tool.

If the same error recurs after two attempts on the same file, stop and call `ask_user` with the specific error. Do not keep looping.

## Reporting Done

State in one sentence:
- What was built or changed.
- Which verification steps passed (baseline + runtime + adversarial).
- Any caveats (e.g., "snapshot shows empty state correctly; seeded data path not yet tested").

Never claim done if any verification step was skipped. If you must skip a step (e.g., no Runner available in the environment), say so explicitly.
