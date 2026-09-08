---
title: Integration Test Framework
date: 2026-03-31
status: approved
---

# Integration Test Framework

Smoke tests that verify the critical paths work end-to-end: operator boots, agents respond, skills inject, tools execute, sessions persist. Runs against a real operator subprocess over TCP — no Tauri dependency, no mocks.

## Architecture

Single Go test binary in `operator/internal/integration/` that:
1. Compiles and spawns the operator as a subprocess on a random port
2. Connects via TCP using the real transport protocol (JSON-per-line)
3. Sends requests, collects responses and stream events
4. Tears down after each test file via `TestMain`

## Test Client

`tcpClient` struct in `integration_test.go`:
- `Dial(port int) error` — connect to operator TCP
- `Send(req transport.Request) (transport.Response, error)` — request/response
- `Stream(req transport.Request) ([]StreamEvent, error)` — collect stream events until done
- `Close()` — disconnect

Reuses `transport.Request` and `transport.Response` types directly.

## Operator Lifecycle

`TestMain` handles operator lifecycle per test file:
- Build operator binary via `go build`
- Start on random port (`--port 0` or pick an unused port)
- Wait for health check (poll `/health` or TCP connect)
- Run tests against shared instance
- Kill on exit via `t.Cleanup`

Tests needing isolation use unique session IDs, not separate operator instances.

## Test Suite

### agents_test.go

| Test | Request | Assertion |
|------|---------|-----------|
| TestOperatorBoot | `health` | success response, operator is alive |
| TestAgentsList | `agents.list` | 6 agents present (general, architect, brainstorm, coder, project, space), each has `source` and `canSpawn` |
| TestSpaceAgentDiscovery | `agents.list` with CONSTRUCT_SPACES_PATH set | space agents appear alongside builtins |

### skills_test.go

| Test | Request | Assertion |
|------|---------|-----------|
| TestSkillsList | `skills.list` | namespaced skills present (architect:writing-plans, coder:frontend, etc.), `source`/`agents`/`tools` populated |
| TestSkillMatch | `agents.dispatch_stream` to coder with "build a construct space" | `skill.match` event fires, contains `coder:construct-spaces` |

### dispatch_test.go

| Test | Request | Assertion |
|------|---------|-----------|
| TestAgentResponse | `agents.dispatch_stream` to brainstorm with "hello" | text stream events arrive, done event with content |
| TestToolExecution | `agents.dispatch_stream` to coder with "list files in /tmp" | `tool.call` event for list_dir or bash, `tool.result` event with content |

### session_test.go

| Test | Request | Assertion |
|------|---------|-----------|
| TestSessionPersistence | two `agents.dispatch_stream` calls with same `session_id` | second call response references prior context |

### stream_test.go

| Test | Request | Assertion |
|------|---------|-----------|
| TestStreamCancel | `agents.dispatch_stream` then immediate `stream.cancel` | stream stops, no hang, clean shutdown |

### provider_test.go

| Test | Request | Assertion |
|------|---------|-----------|
| TestProviderFallback | `agents.dispatch_stream` with bad primary provider configured | fallback provider activates, response still succeeds |

## File Layout

```
operator/internal/integration/
  integration_test.go    -- TestMain, operator lifecycle, tcpClient
  agents_test.go         -- TestAgentsList, TestSpaceAgentDiscovery
  skills_test.go         -- TestSkillsList, TestSkillMatch
  dispatch_test.go       -- TestAgentResponse, TestToolExecution
  session_test.go        -- TestSessionPersistence
  stream_test.go         -- TestStreamCancel
  provider_test.go       -- TestProviderFallback
```

## Running

```bash
# From operator/
go test ./internal/integration/ -v -timeout 120s

# Or via bun script (to be added to package.json)
bun run test:integration
```

## Constraints

- No Tauri dependency — operator runs standalone
- No real AI provider calls in CI — use mock provider or skip dispatch tests without API keys
- Tests must complete in under 60 seconds total
- Random port per run to avoid conflicts in parallel CI
