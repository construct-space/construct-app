# Operator Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the shipped operator runtime into smaller, testable units without changing request/stream contracts, tool names, agent IDs, state file formats, or desktop bridge behavior.

**Architecture:** Keep behavior stable by extracting orchestration out of `cmd/operator/main.go` into same-package modules first, then split oversized internal packages by responsibility while preserving their public APIs. Every structural move is gated by characterization tests so the refactor stays observationally equivalent to today’s runtime.

**Tech Stack:** Go, local TCP transport, JSON file-backed state, Tauri desktop bridge, table-driven Go tests

**Current State:**
- `operator/cmd/operator/main.go` is 3062 lines and currently owns startup, dependency wiring, per-client context, provider boot, tool/space/plugin/MCP loading, stream routing, and sync request routing.
- `operator/internal/runner/runner.go` is 1993 lines and mixes run-loop orchestration, system-prompt assembly, provider fallback, tool execution, spawn behavior, plaintext tool parsing, and logging.
- `operator/internal/state/store.go` is 1191 lines and combines nine persisted data domains plus JSON load/save helpers in one file.
- `operator/internal/tool` and `operator/internal/space/space.go` still bundle multiple responsibilities into large files with limited test seams.
- `operator/internal/provider` is large in total, but it is already split across multiple focused files with decent tests; it is not a first-wave refactor target.
- `operator/internal/router/router.go` is currently unused by the shipped runtime.
- `operator/internal/transport/http.go` and `operator/internal/transport/ws.go` are implemented and tested, but the shipped binary only starts TCP today.
- Baseline verification is not green yet: `go test ./...` currently fails in `operator/cmd/operator` because of a stale coder prompt assertion and in `operator/internal/transport` because stream panic recovery is not implemented.
- The worktree is already dirty outside the operator, so this refactor must avoid unrelated frontend files and keep changes package-local wherever possible.

**Refactor Rules:**
- Do not change request names, payload keys, response shapes, event names, tool IDs, agent IDs, environment-variable names, or on-disk JSON filenames in the refactor itself.
- Keep phase 1 extractions inside the existing package names (`package main`, `package runner`, `package state`, etc.) to avoid unnecessary import churn.
- Add or repair tests before moving logic, not after.
- Extract by responsibility, not by arbitrary line count.
- Treat dormant code (`internal/router`, HTTP, WS) as cleanup candidates only after live runtime parity is locked down.

**Target File Structure:**
- Modify: `operator/cmd/operator/main.go`
  Purpose: shrink to flags, startup, runtime construction, and server launch only.
- Create: `operator/cmd/operator/runtime.go`
  Purpose: own the assembled runtime state (`runner`, stores, registries, bridge, MCP client, client context maps, pending OAuth flows, agent list).
- Create: `operator/cmd/operator/runtime_helpers.go`
  Purpose: pure helper functions for agent lookup, client keying, project lookup, and runner-context shaping.
- Create: `operator/cmd/operator/bootstrap_providers.go`
  Purpose: provider and OAuth runtime assembly.
- Create: `operator/cmd/operator/bootstrap_tools_spaces.go`
  Purpose: tool registry, space loading, hooks, skills, plugins, and bridge-backed registrations.
- Create: `operator/cmd/operator/bootstrap_mcp.go`
  Purpose: MCP config load/enable/register/list/persist behavior.
- Create: `operator/cmd/operator/stream_handlers.go`
  Purpose: all `_stream` request handling and shared streaming helpers.
- Create: `operator/cmd/operator/request_router.go`
  Purpose: ordered sync request dispatch that preserves prefix and fallback behavior.
- Create: `operator/cmd/operator/request_handlers_system.go`
  Purpose: `system.*`, `providers.*`, `agents.list`, `tools.list`, `stream.cancel`.
- Create: `operator/cmd/operator/request_handlers_ai_agents.go`
  Purpose: `agents.dispatch`, `ai.chat`, and related request-to-runner bridging.
- Create: `operator/cmd/operator/request_handlers_oauth.go`
  Purpose: `oauth.*` and `auth.*` endpoints.
- Create: `operator/cmd/operator/request_handlers_context.go`
  Purpose: `context.*` endpoints and per-client state mutations.
- Create: `operator/cmd/operator/request_handlers_state.go`
  Purpose: `storage.*`, `kv.*`, `settings.*`, `project_settings.*`, `pinned.*`, `designs.*`.
- Create: `operator/cmd/operator/request_handlers_tools.go`
  Purpose: `tool.*` and `tools.call`.
- Create: `operator/cmd/operator/request_handlers_mcp.go`
  Purpose: `mcp.*`.
- Create: `operator/cmd/operator/request_handlers_skills_hooks.go`
  Purpose: `skills.*` and `hooks.*`.
- Create: `operator/cmd/operator/request_handlers_sessions.go`
  Purpose: `sessions.*` and `ai.conversations.*`.
- Create: `operator/cmd/operator/runtime_test.go`
  Purpose: characterization tests for live operator helper behavior.
- Create: `operator/cmd/operator/request_handlers_test.go`
  Purpose: handler-level parity tests without booting the entire binary.
- Modify: `operator/internal/transport/tcp.go`
  Purpose: shared panic recovery and stable cancel semantics for active streams.
- Create: `operator/internal/transport/recover.go`
  Purpose: centralize panic-to-error conversion for request and stream handlers.
- Modify: `operator/internal/runner/runner.go`
  Purpose: keep exported types and `Run()` entrypoint, remove helper bulk into focused files.
- Create: `operator/internal/runner/system_prompt.go`
  Purpose: project and UI context injection plus instruction-file assembly.
- Create: `operator/internal/runner/tool_execution.go`
  Purpose: tool execution and hook orchestration.
- Create: `operator/internal/runner/tool_retry.go`
  Purpose: retry/nudge/stuck-loop logic.
- Create: `operator/internal/runner/plaintext_tools.go`
  Purpose: plaintext and inline-JSON tool-call parsing.
- Create: `operator/internal/runner/spawn.go`
  Purpose: `spawn_agent` handling and allowlist logic.
- Create: `operator/internal/runner/provider_resolution.go`
  Purpose: provider/model lookup and auth fallback behavior.
- Create: `operator/internal/runner/logging.go`
  Purpose: project/session/tool logging helpers.
- Modify: `operator/internal/state/store.go`
  Purpose: retain `Store` struct, constructor, and shared types only.
- Create: `operator/internal/state/storage.go`
  Purpose: `Storage*` APIs.
- Create: `operator/internal/state/kv.go`
  Purpose: `KV*` APIs.
- Create: `operator/internal/state/settings.go`
  Purpose: settings and project-settings APIs.
- Create: `operator/internal/state/pinned.go`
  Purpose: pinned-item APIs.
- Create: `operator/internal/state/designs.go`
  Purpose: design persistence APIs.
- Create: `operator/internal/state/runtime_states.go`
  Purpose: skill/hook/MCP runtime-state APIs.
- Create: `operator/internal/state/persistence.go`
  Purpose: JSON load/save internals and file-name constants.
- Create: `operator/internal/state/helpers.go`
  Purpose: cloning, keying, time, and sorting helpers.
- Modify: `operator/internal/tool/builtin.go`
  Purpose: leave registration entrypoint only.
- Create: `operator/internal/tool/file_tools.go`
  Purpose: read/write/edit tool constructors.
- Create: `operator/internal/tool/search_tools.go`
  Purpose: glob/grep/list-dir tool constructors.
- Create: `operator/internal/tool/shell_tools.go`
  Purpose: bash tool, shell safety helpers, and command heuristics.
- Create: `operator/internal/tool/path_guard.go`
  Purpose: path normalization and projects-root guards.
- Modify: `operator/internal/space/space.go`
  Purpose: leave high-level entrypoints only.
- Create: `operator/internal/space/loader.go`
  Purpose: `LoadAll`, directory scanning, and result assembly.
- Create: `operator/internal/space/parser.go`
  Purpose: manifest/frontmatter/agent/tool parsing.
- Create: `operator/internal/space/executors.go`
  Purpose: bridge and shell executor implementations.
- Create: `operator/internal/space/space_test.go`
  Purpose: first real tests for space loading and parsing behavior.
- Modify: `operator/docs/architecture.md`
- Modify: `operator/docs/how-it-works.md`

---

### Task 1: Stabilize the Baseline Before Refactoring

**Files:**
- Modify: `operator/cmd/operator/agent_coder_test.go`
- Modify: `operator/internal/transport/tcp.go`
- Modify: `operator/internal/transport/tcp_test.go`
- Create: `operator/internal/transport/recover.go`

The refactor should not start from a red baseline. Fix the pre-existing failures first so later regressions are attributable to the refactor, not old debt.

- [ ] **Step 1: Reproduce the current failures**

Run: `cd /Users/flakerim/Construct/construct-app/operator && go test ./...`

Expected: failures in `cmd/operator` and `internal/transport`, matching the current baseline.

- [ ] **Step 2: Repair the stale coder-agent expectation**

Read:
- `operator/cmd/operator/agent_coder.go`
- `operator/cmd/operator/agent_coder_test.go`

Update the test to assert the actual stable space-workflow guidance that the shipped prompt intends to guarantee. Do not change the prompt unless the test is proving a real requirement that was accidentally removed.

- [ ] **Step 3: Add panic recovery to TCP request and stream handling**

Implement a shared helper in `operator/internal/transport/recover.go` so both `OnRequest` and `OnStream` panics are converted into terminal error responses instead of crashing the goroutine.

- [ ] **Step 4: Keep stream-cancel semantics intact**

While touching `tcp.go`, verify that panic recovery does not bypass:
- active stream registration
- active stream cleanup
- `CancelStream()` behavior

- [ ] **Step 5: Re-run the touched package tests**

Run:
- `go test ./cmd/operator`
- `go test ./internal/transport`

Expected: PASS.

- [ ] **Step 6: Re-run the full operator test suite**

Run: `go test ./...`

Expected: PASS across `operator/...`.

---

### Task 2: Extract Pure Runtime Helpers From `main.go`

**Files:**
- Modify: `operator/cmd/operator/main.go`
- Create: `operator/cmd/operator/runtime_helpers.go`
- Create: `operator/cmd/operator/runtime_test.go`

Pull pure logic out of `main()` first. This creates test seams without changing wiring or package boundaries.

- [ ] **Step 1: Extract pure helper functions**

Move these out of local closures into package-level helpers:
- `clientKey`
- runner-context shaping from `clientContextState`
- agent lookup (`findAgent` / `resolveAgent` helper)
- small map/string helpers that do not need closure capture

- [ ] **Step 2: Leave side-effectful boot logic in `main()`**

Do not yet move:
- store creation
- provider registration
- MCP connection
- transport startup

This task is only about pure helper extraction.

- [ ] **Step 3: Add table-driven tests for the new helpers**

Cover:
- empty and non-empty `client_id`
- `space:<id>` agent lookup and fallback behavior
- runner context emission for mode/component/selection combinations
- nil/empty context cases

- [ ] **Step 4: Replace local closure call sites**

Update `main.go` to use the extracted helpers while keeping behavior identical.

- [ ] **Step 5: Verify helper extraction did not change runtime behavior**

Run:
- `go test ./cmd/operator`
- `go test ./...`

Expected: PASS.

---

### Task 3: Introduce an `operatorRuntime` Struct and Shrink `main()`

**Files:**
- Modify: `operator/cmd/operator/main.go`
- Create: `operator/cmd/operator/runtime.go`

`main()` should stop owning all mutable runtime state. Create a struct that holds assembled dependencies and per-client maps, but keep it in `package main` for now.

- [ ] **Step 1: Define the runtime container**

Create an `operatorRuntime` struct that owns:
- `runner`
- stores
- bridge client
- tool/hook/skill/plugin registries
- MCP client
- agent list and fallback agent
- per-client project/context maps and mutexes
- pending OAuth state
- startup `workDir`

- [ ] **Step 2: Move stateful closures onto the struct**

Convert stateful closures from `main.go` into methods on `operatorRuntime`, especially:
- project lookup
- client-context lookup
- runner-context lookup
- agent resolution

- [ ] **Step 3: Keep `main()` as assembly only**

After this task, `main()` should mostly:
1. parse flags
2. initialize app dirs
3. build `operatorRuntime`
4. build transport
5. register handlers
6. start serving

- [ ] **Step 4: Add focused runtime tests**

Test the new struct methods directly without needing to boot the full TCP server.

- [ ] **Step 5: Verify no request behavior changed**

Run:
- `go test ./cmd/operator`
- `go test ./...`

Expected: PASS.

---

### Task 4: Extract Provider, Tool, Space, Plugin, and MCP Bootstrap

**Files:**
- Modify: `operator/cmd/operator/main.go`
- Modify: `operator/cmd/operator/oauth_runtime.go`
- Create: `operator/cmd/operator/bootstrap_providers.go`
- Create: `operator/cmd/operator/bootstrap_tools_spaces.go`
- Create: `operator/cmd/operator/bootstrap_mcp.go`
- Create: `operator/cmd/operator/bootstrap_test.go`

The largest block in `main.go` today is bootstrapping. Extract it next, but keep it in `package main` and preserve the exact runtime order.

- [ ] **Step 1: Extract provider bootstrap**

Move provider-registration logic out of `main.go`, including:
- env-backed providers
- state-backed providers
- OAuth runtime providers
- active-provider tracking

Keep `oauth_runtime.go` as the descriptor/translation layer and use it from the new bootstrap helper.

- [ ] **Step 2: Extract tool, space, hook, skill, and plugin bootstrap**

Move registry construction and space loading into a dedicated helper that returns the assembled registries plus the discovered space IDs and agents.

- [ ] **Step 3: Extract MCP bootstrap and utility methods**

Move:
- config loading
- enabled-state restoration
- background connect
- user-config persistence
- live tool re-registration
- server listing

into dedicated runtime helpers.

- [ ] **Step 4: Preserve startup order exactly**

Keep these ordering rules unchanged:
- appdir before stores
- stores before saved settings restoration
- providers before runner creation
- tools/hooks/skills/plugins before runner creation
- MCP server tool registration after base registry creation

- [ ] **Step 5: Add tests for extracted bootstrap helpers**

Focus on pure or mostly pure seams:
- provider bootstrap from settings/env inputs
- MCP listing shape
- user MCP config persistence filtering

- [ ] **Step 6: Verify with full suite**

Run: `go test ./...`

Expected: PASS.

---

### Task 5: Extract Streaming Request Handling

**Files:**
- Modify: `operator/cmd/operator/main.go`
- Create: `operator/cmd/operator/stream_handlers.go`
- Create: `operator/cmd/operator/stream_handlers_test.go`

The stream switch in `srv.OnStream` is a distinct subsystem and should be extracted before the much larger sync request switch.

- [ ] **Step 1: Create dedicated stream-handler methods**

Extract handlers for:
- `agents.dispatch_stream`
- `ai.chat_stream`
- unknown stream fallback

Keep shared pieces like emitter setup and terminal `done`/`error` chunks centralized.

- [ ] **Step 2: Preserve current request-to-runner translation**

Do not change:
- task fallback from last user message
- model/session forwarding
- project/context forwarding
- response chunk shapes

- [ ] **Step 3: Add stream-handler parity tests**

Cover:
- successful stream path emits `done`
- missing task returns terminal error
- unknown stream type returns terminal error
- request ID is preserved in emitted chunks

- [ ] **Step 4: Register the extracted handlers from `main()`**

`main.go` should delegate to one runtime method instead of inlining the stream switch.

- [ ] **Step 5: Verify targeted packages**

Run:
- `go test ./cmd/operator`
- `go test ./internal/transport`
- `go test ./...`

Expected: PASS.

---

### Task 6: Replace the Giant Sync `switch` With Ordered Domain Handlers

**Files:**
- Modify: `operator/cmd/operator/main.go`
- Create: `operator/cmd/operator/request_router.go`
- Create: `operator/cmd/operator/request_handlers_system.go`
- Create: `operator/cmd/operator/request_handlers_ai_agents.go`
- Create: `operator/cmd/operator/request_handlers_oauth.go`
- Create: `operator/cmd/operator/request_handlers_context.go`
- Create: `operator/cmd/operator/request_handlers_state.go`
- Create: `operator/cmd/operator/request_handlers_tools.go`
- Create: `operator/cmd/operator/request_handlers_mcp.go`
- Create: `operator/cmd/operator/request_handlers_skills_hooks.go`
- Create: `operator/cmd/operator/request_handlers_sessions.go`
- Create: `operator/cmd/operator/request_handlers_test.go`

This is the highest-value structural change. Do it only after the runtime object and stream handlers exist.

- [ ] **Step 1: Build an ordered request router**

Do not use a plain `map[string]handler` for everything. Some routes rely on ordering and prefix matching:
- exact `req.Type == "..."`
- `strings.HasPrefix(req.Type, "tool.")`
- `strings.HasPrefix(req.Type, "ai.conversations.")`

Use an ordered slice of matchers or explicit domain dispatch methods so behavior stays the same.

- [ ] **Step 2: Extract low-risk domains first**

Move these first:
- `system.*`
- `providers.*`
- `tools.list`
- `agents.list`
- `stream.cancel`

- [ ] **Step 3: Extract runner-backed request domains**

Move:
- `agents.dispatch`
- sync fallback for `agents.dispatch_stream`
- `ai.chat`
- sync fallback for `ai.chat_stream`

Keep their request/response payloads unchanged.

- [ ] **Step 4: Extract mutation-heavy domains one group at a time**

Move in this order:
1. `context.*`
2. `storage.*`, `kv.*`, `settings.*`, `project_settings.*`, `pinned.*`, `designs.*`
3. `mcp.*`
4. `skills.*`, `hooks.*`
5. `sessions.*`, `ai.conversations.*`
6. `oauth.*`, `auth.*`
7. `tool.*`, `tools.call`

- [ ] **Step 5: Add domain-level parity tests**

At minimum, cover:
- `system.ping`
- `stream.cancel`
- `context.set_project` + `context.get`
- one `storage.*` round trip
- one `mcp.*` list/enable path
- `tool.*` request routing
- `sessions.list` and one `ai.conversations.*` route

- [ ] **Step 6: Reduce `main.go` to transport wiring**

After this task, `main.go` should not contain a multi-hundred-line request switch anymore.

- [ ] **Step 7: Run the full suite**

Run: `go test ./...`

Expected: PASS.

---

### Task 7: Split `internal/state` by Data Domain Without Changing Its API

**Files:**
- Modify: `operator/internal/state/store.go`
- Create: `operator/internal/state/storage.go`
- Create: `operator/internal/state/kv.go`
- Create: `operator/internal/state/settings.go`
- Create: `operator/internal/state/pinned.go`
- Create: `operator/internal/state/designs.go`
- Create: `operator/internal/state/runtime_states.go`
- Create: `operator/internal/state/persistence.go`
- Create: `operator/internal/state/helpers.go`
- Create: `operator/internal/state/compat_test.go`

`internal/state` is too large, but it already has one public type. Preserve that shape and split file responsibilities underneath it.

- [ ] **Step 1: Leave `Store` and public types in `store.go`**

Keep:
- `Store`
- public record/input types
- `NewStore`

in `store.go`, and move the domain methods out.

- [ ] **Step 2: Move each domain into its own file**

Separate:
- `Storage*`
- `KV*`
- `Setting*` / `ProjectSettings*`
- `Pinned*`
- `Design*`
- runtime-state methods for skills/hooks/MCP

- [ ] **Step 3: Centralize persistence internals**

Move:
- file-name constants
- `loadAll`
- `loadJSON`
- `saveJSON`
- per-file load/save helpers

into `persistence.go`.

- [ ] **Step 4: Add compatibility tests**

Create tests that verify:
- JSON tags are unchanged
- file names are unchanged
- store reload behavior matches pre-refactor expectations

- [ ] **Step 5: Run state-focused and full tests**

Run:
- `go test ./internal/state`
- `go test ./...`

Expected: PASS.

---

### Task 8: Split `internal/runner` by Responsibility, Not by Export Surface

**Files:**
- Modify: `operator/internal/runner/runner.go`
- Create: `operator/internal/runner/system_prompt.go`
- Create: `operator/internal/runner/tool_execution.go`
- Create: `operator/internal/runner/tool_retry.go`
- Create: `operator/internal/runner/plaintext_tools.go`
- Create: `operator/internal/runner/spawn.go`
- Create: `operator/internal/runner/provider_resolution.go`
- Create: `operator/internal/runner/logging.go`
- Create: `operator/internal/runner/plaintext_tools_test.go`
- Create: `operator/internal/runner/system_prompt_test.go`
- Create: `operator/internal/runner/spawn_test.go`

`internal/runner` is the second-biggest single file and a major risk surface. Split it only after `cmd/operator` is already decomposed.

- [ ] **Step 1: Keep the public entrypoints stable**

Do not change:
- `Runner`
- `Option`
- `RunRequest`
- `Run()`
- existing provider/tool/session integration points

- [ ] **Step 2: Move system-prompt logic out first**

Extract:
- project context injection
- client UI context injection
- skill prompt assembly
- instruction-file loading helpers if they live here

into `system_prompt.go`.

- [ ] **Step 3: Move tool parsing and retry logic**

Extract:
- plaintext tool directive parsing
- inline JSON tool parsing
- stuck-loop detection
- retry/nudge helpers

into dedicated files with focused tests.

- [ ] **Step 4: Move spawn-agent handling and provider resolution**

Extract:
- `handleSpawnAgent`
- allowlist helpers
- provider resolution and fallback logic

so those behaviors are independently testable.

- [ ] **Step 5: Move logging helpers last**

Move project/session/tool logging to `logging.go`. This is low risk and should happen after the behavioral helpers are already tested.

- [ ] **Step 6: Add parity tests for the extracted logic**

Cover:
- system prompt includes expected project/context material
- plaintext tool directives become the right tool calls
- spawn allowlist logic
- provider fallback behavior

- [ ] **Step 7: Verify**

Run:
- `go test ./internal/runner`
- `go test ./...`

Expected: PASS.

---

### Task 9: Split `internal/tool` and Add First-Class `internal/space` Tests

**Files:**
- Modify: `operator/internal/tool/builtin.go`
- Create: `operator/internal/tool/file_tools.go`
- Create: `operator/internal/tool/search_tools.go`
- Create: `operator/internal/tool/shell_tools.go`
- Create: `operator/internal/tool/path_guard.go`
- Modify: `operator/internal/space/space.go`
- Create: `operator/internal/space/loader.go`
- Create: `operator/internal/space/parser.go`
- Create: `operator/internal/space/executors.go`
- Create: `operator/internal/space/space_test.go`

The tool and space packages are core runtime surfaces, but they need a lighter touch than `cmd/operator` and `runner`.

- [ ] **Step 1: Split builtin tools by concern**

Keep `RegisterBuiltins()` in `builtin.go`, but move the actual constructors and helper functions into focused files.

- [ ] **Step 2: Isolate path-guard logic**

Put path normalization and projects-root enforcement in `path_guard.go` so those rules are independently testable.

- [ ] **Step 3: Split `internal/space` into load/parse/execute concerns**

Separate:
- directory walking and result assembly
- frontmatter/manifest parsing
- bridge and shell executor implementations

- [ ] **Step 4: Add the first real `space` tests**

Cover:
- loading a valid space
- parsing an agent markdown file
- parsing a tool markdown file
- skipping or erroring correctly on malformed input

- [ ] **Step 5: Verify**

Run:
- `go test ./internal/tool`
- `go test ./internal/space`
- `go test ./...`

Expected: PASS.

---

### Task 10: Review Dormant Runtime Pieces and Finish Documentation

**Files:**
- Modify: `operator/docs/architecture.md`
- Modify: `operator/docs/how-it-works.md`
- Optionally modify later in a separate cleanup PR: `operator/internal/router/router.go`, `operator/internal/transport/http.go`, `operator/internal/transport/ws.go`

After the live runtime is refactored and green, make the repo structure legible.

- [ ] **Step 1: Update runtime documentation**

Refresh:
- startup flow
- runtime object shape
- request routing layout
- stream handling layout
- package/file map

- [ ] **Step 2: Document dormant code explicitly**

Call out that:
- TCP is still the only live transport in the shipped binary
- HTTP and WS remain dormant implementation
- `internal/router` is still not part of live request dispatch

- [ ] **Step 3: Decide cleanup scope**

Do one of these, but not mixed into the main refactor if risk is unclear:
1. keep dormant code and document it clearly
2. remove dormant code in a separate cleanup change after confirming no planned adoption

- [ ] **Step 4: Run final verification**

Run:
- `go test ./...`
- `go vet ./...`

Expected: PASS.

- [ ] **Step 5: Manual smoke test the shipped binary path**

Run:
- `go run ./cmd/operator --dev`

Then verify at least:
- `system.ping`
- `agents.list`
- one `context.*` request

using the existing local TCP request path or a small test helper.

---

## Acceptance Criteria

- `operator/cmd/operator/main.go` is reduced to startup and wiring, not request-domain implementation.
- Sync and stream request handling are split into focused files with parity tests.
- `internal/state` and `internal/runner` are decomposed without API or file-format changes.
- `internal/space` has real tests for the first time.
- The full operator test suite is green at every major checkpoint.
- Docs reflect the new structure and clearly label dormant runtime pieces.

## Non-Goals for This Refactor

- Enabling HTTP or WebSocket transport in the shipped binary
- Replacing the current TCP protocol
- Changing provider behavior or model catalogs
- Rewriting the runner loop logic for new features
- Migrating the live runtime to `internal/router`
- Renaming tools, agents, request types, or persisted JSON files
