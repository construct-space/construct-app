# Findings — V1 Readiness Roadmap

Reviewed: 2026-03-31

Method:
- Source review only
- No runtime verification or test suite run for this document

## Current Snapshot

- App version is `0.7.0` in `construct-app/package.json` and operator version is `0.7.0` in `construct-app/operator/main.go`.
- The release guide defines `1.0` as the gold release and treats pre-gold work as feature + bugfix iteration on `main`.
- The current built-in spaces in code are `brainstorm`, `coder`, `architect`, and `project`.
- The current product/docs story still describes an older space model and older built-in surface area.

## Findings

### 1. Internal spaces are the main V1 stabilization problem

The app does not currently present one stable "spaces" contract.

What the code says:
- `frontend/space_loader/coreSpaces.ts` defines four compile-time core spaces: `brainstorm`, `coder`, `architect`, `project`.
- `frontend/router/routes.ts` hardcodes native routes for `projects`, `brainstorm`, `architect`, and `coder`.
- `frontend/space_loader/SpaceLoader.ts` separately loads disk-installed spaces through the runtime loader.

What the docs say:
- `README.md` says built-in spaces are Code, Design, AI, Chat, Git, Terminal, Tasks, Docs, Notes, Calendar.
- `docs/architecture/spaces.md` documents a fully modular space model with a different built-in list and a different file layout.
- `frontend/router/routes.ts` comment says there are "NO hardcoded space routes", which is not true anymore.

Why this matters:
- We cannot freeze a V1 extension/platform surface when the codebase still mixes two models:
  - host-native spaces wired directly into the app shell
  - dynamic spaces loaded from disk/manifests
- That ambiguity will keep creating bugs in routing, navigation, marketplace behavior, and developer expectations.

Recommendation:
- Make "host-native space" vs "dynamic installed space" an explicit product/runtime distinction.
- Update docs to match the real model before shipping more space-facing features.
- Treat this as the first V1 blocker, not a cleanup task.

### 2. The Architect structured-output path exists, but the contract is still unstable

The plumbing for `architect.v1` is present, but the runtime behavior still depends on compatibility fallbacks and contradictory instructions.

What is already in place:
- `frontend/spaces/architect/pages/ArchitectPage.vue` sends `assistantType: "architect"` and `outputSchema: "architect.v1"`.
- `frontend/spaces/architect/assistant/schema.ts` defines a strict `architect.v1` envelope.
- `operator/internal/runner/output_schema.go` registers the `architect.v1` JSON schema.
- Provider connectors already consume `req.OutputSchema`:
  - `operator/internal/provider/connectors/anthropic.go`
  - `operator/internal/provider/connectors/openai_compat.go`
  - `operator/internal/provider/connectors/google_gemini_cli.go`

What is still unstable:
- `frontend/spaces/architect/agent/config.md` instructs the model to output plain-text questions or ad-hoc JSON like `{ "text": "...", "options": [...] }`, not the canonical `architect.v1` envelope.
- `frontend/spaces/architect/pages/ArchitectPage.vue` still has a header comment that says "No questions step, no plan JSON", while the page actually requests structured interview questions and renders question blocks.
- `frontend/spaces/architect/assistant/normalizer.ts` contains a large fallback matrix for legacy shapes:
  - plain text
  - markdown-wrapped JSON
  - `choices` vs `options`
  - inferred question type
  - legacy `name/stack/features` plan objects
  - review payloads with `issues`
- The interview behavior itself is inconsistent across models:
  - sometimes Architect asks one question at a time
  - sometimes it emits a batch of questions up front
  - that breaks the actual product requirement, because later questions should change based on earlier answers
- The documentation output is too template-shaped today:
  - different project types should not produce the same document set
  - a landing page, a game, and a CRM should not be forced through one identical docs bundle

Why this matters:
- V1 should not rely on heuristic normalization to decide whether the Architect output is valid.
- The right model behavior is unclear because the prompt contract, page behavior, and schema contract are not saying the same thing.
- Architect is supposed to be adaptive, not a static form generator.
- If the agent asks all questions at once, it starts assuming branches it should wait to discover from the user.
- If doc generation is not scope-sensitive, the output feels generic and overproduced for simple projects while still under-specifying complex ones.

Recommendation:
- Make `architect.v1` the only documented output contract for Architect UI flows.
- Keep legacy normalization only as a temporary compatibility layer, not as the primary design.
- Add explicit provider-path tests for tool-enabled Architect runs with schema output enabled.
- Enforce one-question-at-a-time adaptive interviewing as a product rule, not a prompt suggestion.
- Make the doc set conditional on project type, scope, and complexity instead of always trying to generate the same package.

### 3. Core space manifests are not yet a frozen contract

The manifests for core spaces are inconsistent and currently rely on fallback behavior in `useSpaces()`.

Examples:
- `frontend/spaces/brainstorm/manifest.json` includes scope, navigation, pages, and widgets.
- `frontend/spaces/coder/manifest.json` includes only `id`, `name`, `description`, `icon`, `version`.
- `frontend/spaces/architect/manifest.json` and `frontend/spaces/project/manifest.json` also omit navigation/pages/scope and depend on defaults from `frontend/composables/useSpaces.ts`.
- `frontend/space_loader/builtin.ts` says the builtin IDs are `['architect', 'projects']`, which is already stale relative to the core registry and the actual `project` space ID.

Why this matters:
- The effective manifest contract is currently "whatever works after defaults", not a stable schema.
- That is risky for internal spaces now and for third-party spaces later.

Recommendation:
- Decide whether core spaces must satisfy the same manifest contract as dynamic spaces.
- If yes, make all core manifests complete and validate them.
- If no, define a separate host-native contract and stop pretending the manifest model is universal.

### 4. Planning/docs drift is already causing false conclusions

There is existing documentation that no longer matches the code and would mislead release planning.

Examples:
- `docs/plans/findings-implementation-2026-03-28-assistant-types.md` says provider connectors do not consume `OutputSchema`, but the current provider code does.
- `docs/architecture/spaces.md` documents an older space inventory and file layout.
- `README.md` describes a broader built-in surface than the current compile-time registry.

Why this matters:
- Planning against stale docs creates fake blockers and hides real ones.
- V1 work needs one current source of truth for the internal platform surface.

Recommendation:
- Add a docs sync pass to the stabilization track, not after it.
- Treat stale architecture docs as product debt because they directly affect agent behavior, planning, and contributor correctness.

### 5. External space bootstrap is promising, but not yet release-grade

The external space workflow exists, but it is not yet strong enough to be a stable public contract.

What is already in place:
- The CLI already supports `construct scaffold`, `construct new`, and `construct create` as aliases for creating a space project.
- The scaffold creates a basic space repo with manifest, page, agent directory, widgets, and Vite config.
- The host runtime exposes a fixed module map for shared dependencies like Vue, Pinia, `@construct-space/ui`, and `@construct-space/sdk`.
- The dev/install flow already copies built spaces into the app spaces directory.

What is still weak:
- The scaffold template is still minimal:
  - the generated `package.json` includes `@construct-space/ui`, but not an explicit `@construct-space/sdk` dependency
  - Graph is optional and not wired into the default scaffold
  - the default space is not obviously "full-featured by default"
- The host runtime currently exposes a fixed allowlist of externalized modules from `frontend/lib/spaceHost.ts`.
- The external-space build template externalizes only a narrow module set in `vite.config.ts`.
- There is no single validation layer that says:
  - which imports are host-provided
  - which packages must be bundled locally
  - which combinations are supported for third-party spaces

Why this matters:
- A public external-space platform cannot rely on trial-and-error after `construct new`.
- For `0.8`, the expected experience should be:
  - scaffold the space
  - install dependencies
  - run `construct dev`
  - load in host without manual package surgery
  - agent, graph, UI, and SDK paths either work out of the box or fail with precise validation

Recommendation:
- Treat external space stability as a separate milestone after internal-space stabilization.
- Freeze a formal host package/runtime contract for third-party spaces.
- Add validation for unsupported imports and missing host-provided packages at build/dev time, not after runtime failure.

## Proposed Roadmap To V1

### Phase 1: Finish 0.7.x as a stabilization track

#### 0.7.1 — Spaces Contract Freeze

Goals:
- Define the official internal-space model for V1
- Remove stale identifiers and comments
- Make routing/loading/docs tell the same story

Must ship:
- Document the split between host-native spaces and dynamic installed spaces
- Align `README.md`, `docs/architecture/spaces.md`, and router comments with the real implementation
- Fix stale IDs and defaults such as `projects` vs `project`
- Normalize core space manifests or explicitly exempt them with a separate contract

#### 0.7.2 — Architect Contract Freeze

Goals:
- Make Architect deterministic enough for V1
- Reduce output-format bugs to schema-level failures, not parsing guesses

Must ship:
- Rewrite Architect prompt instructions so UI flows target `architect.v1`
- Remove contradictory comments and legacy guidance from the Architect surface
- Keep fallback normalization only for backward compatibility
- Enforce adaptive interview flow:
  - exactly one active question at a time
  - next question must depend on prior user answers
  - no "ask everything up front" behavior
- Prevent model behavior that assumes future branches too early
  - example: if the stack choice is `Flutter` vs `Tauri`, the next questions must change accordingly
  - Architect must wait for the answer before choosing the next branch
- Make document generation adaptive to project type and complexity
  - landing page: fewer, tighter docs
  - game: different docs and planning structure
  - CRM: broader requirements, data, workflow, and system docs
  - simple projects should not get bloated document bundles just because a template exists
- Add tests for:
  - question state
  - progress state
  - plan state
  - provider paths with tools enabled
  - one-question interview progression
  - branch changes after key answers
  - variable document-set selection by project type

#### 0.7.3 — Bug Burn + Release Gates

Goals:
- Close remaining P1/P2 bugs without adding new platform surface
- Establish a real V1 gate

Must ship:
- Bug review across `brainstorm`, `architect`, `coder`, and `project`
- Smoke coverage for:
  - app-space routing
  - project-space routing
  - sidebar/pinned space behavior
  - Architect interview to docs flow
  - Architect to Coder handoff
- A short release checklist for V1 readiness

### Phase 2: 0.8.0 — External Space Stability

Goals:
- Make external spaces viable as a supported platform, not just an internal demo path
- Ensure `construct new <space>` produces a space that runs cleanly in host with minimal manual fixing

Must ship:
- Upgrade the scaffold so a fresh space includes the expected happy-path setup for:
  - UI
  - SDK
  - agent loading
  - graph integration hooks
  - widget structure
- Define the official host package/runtime contract:
  - which packages are host-provided
  - which packages must be bundled
  - which package IDs are supported for externalization
- Add host-side and CLI-side validation for unsupported imports/module IDs
- Verify the full external-space loop:
  - `construct new`
  - `bun install`
  - `construct dev`
  - host load
  - agent registration
  - graph access
  - UI/SDK runtime access
- Make runtime failures actionable:
  - clear errors for unsupported packages
  - clear compatibility errors for host API mismatches
  - clear validation errors for broken manifests or missing agent assets

Nice to ship:
- A first-party "full space" scaffold preset
- A single doctor/check command for external spaces

### Phase 3: 0.8.1 — UI + Operator Streaming Coordination

Goals:
- Make streamed operator output feel correct in the UI before the final structured payload is complete
- Prevent partial streaming text from rendering broken or misleading UI states

Problem to solve:
- Operator streams content token-by-token, but some frontend surfaces only make sense after the full structured payload is available.
- If the UI tries to render partial content too early, structured elements can appear wrong or sluggish during the stream.
- Examples:
  - structured Architect question/answer blocks
  - future UI-driven response components that may map to buttons, actions, forms, or richer blocks
  - any response shape where partial text is not a valid intermediate render state

Must ship:
- Define which assistant/block types are safe to stream directly and which must buffer until final parse
- Standardize the placeholder/skeleton behavior for structured response types while the stream is in flight
- Keep streaming status visible so the user knows the UI is still being prepared
- Only swap from placeholder to real interactive UI once the final structured payload is complete and normalized
- Ensure partial tokens never render as broken UI primitives or malformed interactive components

Recommended implementation direction:
- For structured UI flows, buffer stream text while showing a clear placeholder state
- Continue streaming progress/status events independently from the buffered final content
- Render the final UI blocks only after normalization succeeds
- If normalization fails, fall back cleanly to plain text instead of partial broken UI

Why this matters:
- It improves perceived quality even when the operator is already behaving correctly
- It reduces "UI is laggy/broken while streaming" issues that are really contract/render-timing problems
- It is especially important for Architect, where question-answer blocks should appear intentional, not assembled from partial tokens

### Phase 4: Only add one or two features that strengthen V1

If we ship features before `1.0`, they should reinforce the platform instead of widening scope.

Recommended feature candidates:
- Deterministic Architect → Coder handoff
  - Make docs, next actions, and project opening a clean guided flow instead of an inferred one.
- Space contract validator / "Space Doctor"
  - Validate manifests, required fields, widget sizes, assistant config, and route expectations for internal and installed spaces.

Avoid before `1.0`:
- Large new surface areas
- New space categories without a frozen internal contract
- Feature work that depends on the old docs/space model staying ambiguous

### Phase 5: 1.0.0 Release Criteria

Do not call `1.0` until all of the following are true:

- Internal spaces have one documented contract
- Host-native vs dynamic space behavior is explicit
- Architect uses one canonical structured-output contract for UI workflows
- Architect interviews adapt one question at a time instead of emitting static questionnaires
- Architect generates the right amount and type of documentation for the actual project, not a generic fixed bundle
- External spaces have a supported scaffold + host package/runtime contract
- Structured UI flows handle streaming intentionally, without rendering broken intermediate states
- Current docs match current code
- No open P1 bugs remain in `brainstorm`, `architect`, `coder`, or `project`
- Release gates are defined and repeatable

## Bottom Line

The shortest path to V1 is not "add more spaces" or "add more AI surface". It is:

1. Stabilize the internal space model
2. Freeze the Architect output contract
3. Make Architect adaptive in both questioning and document output
4. Make external spaces predictable after `construct new`
5. Make structured UI streaming render intentionally with placeholders
6. Burn down bugs against that frozen surface
7. Add at most one or two strengthening features
8. Ship `1.0` only after docs and runtime finally agree
