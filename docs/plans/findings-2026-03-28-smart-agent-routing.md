# Findings for 2026-03-28-smart-agent-routing

This review is based on the current updated plan. Most of the earlier issues are fixed. The remaining flaws are below.

## 1. High: The shared-composable parity problem is still not fully fixed because sync fallback still drops `projectPath`

The plan now explicitly says `useAgentSession` is shared and must preserve existing `projectPath` and `sessionId` semantics ([plan](/Users/flakerim/Construct/construct-app/docs/plans/2026-03-28-smart-agent-routing.md#L16), [plan](/Users/flakerim/Construct/construct-app/docs/plans/2026-03-28-smart-agent-routing.md#L303)). It also correctly keeps `projectPath` in the streaming path ([plan](/Users/flakerim/Construct/construct-app/docs/plans/2026-03-28-smart-agent-routing.md#L384)). But the new sync `dispatch()` signature only adds `activeContext` and `sessionId` ([plan](/Users/flakerim/Construct/construct-app/docs/plans/2026-03-28-smart-agent-routing.md#L405)), and the sync backend handler step still only says to add `ActiveContext` ([plan](/Users/flakerim/Construct/construct-app/docs/plans/2026-03-28-smart-agent-routing.md#L227)).

That still regresses callers that rely on explicit `projectPath` when streaming falls back to sync. `ArchitectPage.vue` currently passes `projectPath` into `session.send(...)` ([ArchitectPage.vue](/Users/flakerim/Construct/construct-app/frontend/spaces/architect/pages/ArchitectPage.vue#L92)), and Architect exists both under project routes and as a global `/app/architect` route outside `ProjectLayout` ([routes.ts](/Users/flakerim/Construct/construct-app/frontend/router/routes.ts#L155)). In the current code, the sync operator handler also has no `project_path` override field at all ([main.go](/Users/flakerim/Construct/construct-app/operator/main.go#L1071)).

If the plan’s claim is “existing callers must continue to work unchanged”, it still needs to add `projectPath` parity to the sync client API and the sync backend dispatch handler.

## 2. Medium: The standalone-window update still won’t clear stale context when the main window navigates to a non-context route

Task 5 Step 2 now preserves lifecycle details, but it still relies on the `space-changed` Tauri event to update the standalone window ([plan](/Users/flakerim/Construct/construct-app/docs/plans/2026-03-28-smart-agent-routing.md#L347)). The problem is that the router only emits that event when the detected context is truthy ([router/index.ts](/Users/flakerim/Construct/construct-app/frontend/router/index.ts#L25)). When the main window moves from something like `/app/projects/123` or `/app/design` to `/app`, `/app/settings`, or another route with no active context, no event is emitted, so the standalone assistant keeps the previous `activeContext`.

That means the standalone assistant can continue routing with stale priority context after the user leaves the relevant route. The plan should either change the router to emit a context-changed event on every navigation, including `null`, or explicitly add a clearing mechanism.

## 3. Medium: Task 4’s code snippet uses an undefined identifier and will not compile if copied literally

The Task 4 allowlist snippet compares against `agentID` ([plan](/Users/flakerim/Construct/construct-app/docs/plans/2026-03-28-smart-agent-routing.md#L261)), but the current `handleSpawnAgent` implementation reads the requested child ID from `args.AgentID` ([runner.go](/Users/flakerim/Construct/construct-app/operator/internal/runner/runner.go#L1598)). There is no `agentID` variable in that function today.

That is a small issue, but this is an implementation plan with copyable code blocks. As written, the snippet would fail to compile. It should use the real variable name from the function context.

## 4. Low: Test coverage is still incomplete for the behavior being changed

The plan adds backend tests for `findAgent` and `prepareGeneralAgent`, but it still has no tests for:
- the new `activeContext` forwarding through `useAgentSession`
- the sync fallback preserving shared-callers behavior
- the standalone route/context behavior
- the new spawn allowlist prefix-matching logic

There is already a frontend test harness for `useAgentSession` with mocked operator calls ([useAgentSession.test.ts](/Users/flakerim/Construct/construct-app/frontend/operator/useAgentSession.test.ts#L44)). Since Task 5 changes a shared frontend request path and Task 4 changes permission semantics, the plan should add targeted tests there as well instead of relying only on backend helper tests.
