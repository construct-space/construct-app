# v1 Readiness Checklist

Release gate for Construct v1. All items must pass before shipping.

## Reliability (0.7.3)

- [x] Session save failures surfaced (not silently swallowed)
- [x] Per-tool execution timeout (context.WithTimeout, configurable per tool)
- [x] Blocking hook failures actually block tool execution
- [x] SSE parse failures logged (all providers: anthropic, anthropic-oauth, openai-compat)
- [x] Skill regex problems warn at registration time
- [x] Provider fallback works on any turn (not just turn 0)
- [x] operator.send() has timeout wrapper + error event bus
- [x] Provider load/auth failures visible in LLM settings UI

## Smoke Tests

- [x] App-space routing verified (home, spaces, marketplace, settings)
- [x] Project-space routing verified (projects, project detail, project-scoped spaces)
- [x] Sidebar/pinned space behavior (core spaces at app level, dynamic catch-all)
- [x] Architect -> Coder handoff flow (both at app and project level)

## Go Test Coverage

- [x] Session save error propagation (chatsession/store_test.go)
- [x] Tool execution timeout behavior (tool/tool_test.go)
- [x] Hook blocking behavior (hook/hook_test.go)
- [x] SSE parse error handling (connectors/openai_compat_test.go)
- [x] Skill regex validation (skill/skill_test.go)
- [x] Provider fallback on non-zero turns (runner/runner_test.go)

## Frontend Test Coverage

- [x] operator.send() timeout behavior (operator/client.test.ts)
- [x] Error event emission and unsubscribe (operator/client.test.ts)

## Silent Error Audit

Patterns found and fixed in 0.7.3:

1. **runner.go**: 6 instances of `r.sessions.Save(sess)` with return value ignored -> now logged
2. **chatsession/store.go**: `List()` silently skipped unreadable/unparseable files -> now logged
3. **tool_exec.go**: Pre-hook errors silently ignored (`err == nil` guard) -> now blocks execution
4. **tool_exec.go**: Post-hook errors silently ignored -> now logged to stderr
5. **openai_compat.go**: SSE JSON parse errors silently skipped -> now logged
6. **anthropic.go**: SSE JSON parse errors silently skipped -> now logged
7. **anthropic_oauth.go**: SSE JSON parse errors silently skipped -> now logged
8. **runner.go**: Provider fallback only on turn 0 -> extended to all turns
9. **LLMSettings.vue**: `onMounted` catch block was `// silent` -> now shows error toast + banner
10. **client.ts**: `send()` had no timeout -> now has 30s default timeout with error events
