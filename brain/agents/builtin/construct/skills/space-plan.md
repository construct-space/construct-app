---
id: space-plan
name: Planning Space Work
description: How to classify, plan, and structure work before touching files. Inline planning, task tracking, when to ask.
trigger: "plan,classify,break down,tasks,roadmap,what should i do,where do i start"
category: construct
---

# Planning

You plan before you edit. You don't plan forever.

## Classify First

Every request falls into one of these types. Pick one before anything else:

1. **New Space** — build from scratch
2. **Existing Space feature** — add functionality
3. **Existing Space bugfix** — fix broken behavior
4. **UX polish** — improve look, feel, flow
5. **Data model / Graph change** — add or modify persistent data
6. **Agent / tools wiring** — give the Space AI capabilities
7. **Lifecycle** — packaging, install, preview, publish

Each has a different optimal path. Don't guess — classify first, even if silently.

## Plan Shape by Type

### New Space
A plan names:
- Space identity (id, name, scope)
- Pages and navigation
- Data model (Graph for records? `useLocalStorage` for KV prefs? `useStorage` for file blobs? transient `ref`?)
- Key user flows (2-4)
- Verification targets

### Feature in existing Space
- Which files change (pages / components / composables / models / actions / manifest)
- Whether manifest needs updates
- Whether Graph schema changes
- What to verify

### Bugfix
- Reproduction steps
- Suspected category (manifest/routing, component logic, composable/state, Graph, action wiring, runtime)
- Hypothesis
- Verification path

### UX polish
- Current state screenshot / snapshot
- Specific change
- Which component(s) touched
- How to verify visually

### Data model change
- Model delta (add/remove/rename fields, relations, access)
- Migration plan (push → migrate → migrate --apply if destructive)
- Data touched in existing records
- CRUD re-verification

### Agent wiring
- Which tools the Space agent needs
- Which skills attach
- Hooks (if any)
- Test prompts the agent should handle correctly

### Lifecycle
- Current state (dev, installed, published)
- Target state
- Steps in order
- Rollback path if relevant

## When to Create Tasks

Use the task system when:
- The work has 3+ discrete, verifiable steps
- Multiple files touched with a specific order
- You'll want to resume across a long session

Don't create tasks for:
- One-line fixes
- A single file edit
- Trivial manifest tweaks

Mark tasks `in_progress` before starting, `completed` only when fully done (verified).

## When to Ask vs. Proceed

**Proceed when:**
- The request is specific and scoped
- Missing info can be inferred from `docs/`, manifest, or the existing Space
- Reasonable defaults exist (you can state the assumption and move)

**Ask when:**
- Scope ambiguity that changes the output shape (e.g., "one Space or two?")
- Destructive decisions (delete model, rename space ID)
- Choice between materially different user flows
- Missing info that can't be inferred and would produce wasted work

One question at a time. Use `ask_user`. Do not write long prose describing what you might need.

## Plan Length

- Trivial work: no plan, just a one-line intent statement, then execute.
- Medium work: 3-6 bullets.
- Large work: tasks + a short document if the user is building a whole new Space (put it in `docs/` so it persists).

Never write a plan longer than the work itself.

## After Planning

Transition cleanly: state the plan in one short turn, then start executing. Don't narrate each step as you go — do the work, then summarize.
