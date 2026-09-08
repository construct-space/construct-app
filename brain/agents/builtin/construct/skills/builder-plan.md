---
id: builder-plan
name: Planning Software Work
description: Classify the request, draft a fitting plan, decide when to ask vs. proceed
trigger: "plan,classify,break down,tasks,roadmap,what should i do,where do i start"
category: construct
---

# Planning

You plan before you edit. You don't plan forever.

## Classify First

Every request is one of these. Name it (silently) before anything else:

1. **Greenfield** — new project, no code yet.
2. **Feature** — add something to an existing codebase.
3. **Bugfix** — fix broken behavior.
4. **Refactor** — restructure without changing behavior.
5. **UX / UI polish** — visual or interaction improvements.
6. **Wiring / integration** — connect two things that already exist (API, library, auth, deploy).
7. **Exploration** — user wants to understand something, not change it.

Different classes have different optimal paths. Feature work usually means: read one or two files, edit one or two files. Refactor means: map usage first, then edit broadly. Exploration means: don't edit anything until asked.

## Plan Shape by Class

### Greenfield
Name: framework, language, package manager, what's visible first. Scaffold via the official tool if one exists. Don't hand-build project structure that a scaffolder would produce correctly.

### Feature
Name: files that change, whether tests change, whether the public API changes. If the change touches more than 3 files, create tasks.

### Bugfix
Name: reproduction steps, suspected location, hypothesis. Fix the smallest thing that resolves the repro. Add a regression test if the project has tests.

### Refactor
Name: current shape, target shape, call-sites to update. Do it in passes: first make the new shape work alongside the old, then migrate callers, then delete the old. Never both at once across many files.

### UX polish
Name: the specific change (spacing, colors, copy, motion). Touch the minimum set of components. Don't rewrite styling systems.

### Wiring
Name: the two ends (e.g., "auth store ↔ accounts API"), the contract (what shape crosses the boundary), where it lives. Follow the project's existing pattern for similar wiring.

### Exploration
Don't plan a change. For broad exploration, audit, feasibility, migration, conversion, or architecture assessment, spawn `builder-explorer` with specific discovery questions and synthesize its findings. No edits unless the user asks after the explanation.

## When to Create Tasks

Use the task system when:
- The work has 3+ discrete, verifiable steps.
- Multiple files touched in a specific order.
- You'll want to resume across a long session.

Don't create tasks for:
- One-line fixes.
- A single-file edit.
- A question the user just asked.

Mark `in_progress` before starting a step, `completed` only when verified.

## When to Ask vs. Proceed

**Proceed when:**
- Request is specific and scoped.
- Missing info is inferable from the repo (lockfile, config, existing patterns).
- Reasonable defaults exist and you can state the assumption.

**Ask when:**
- Scope ambiguity that changes the output shape (one page vs. full site, one model vs. whole feature).
- Destructive decisions (rename a public symbol, drop a table, delete a module).
- Choice between materially different user flows.
- Missing info that, if guessed wrong, produces wasted work.

One question at a time via `ask_user`. Blocking. Don't write long prose guessing.

## Plan Length

- Trivial: one-line intent, then execute.
- Medium: 3–6 bullets.
- Large: tasks + a `docs/plan.md` the user can review before CODE mode.

Never write a plan longer than the work itself.

## After Planning

State the plan in one short turn, then execute. Don't narrate each step as you go. Do the work, then summarize.
