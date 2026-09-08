# Brain deep review — deferred findings (2026-07-08)

A six-reviewer deep review of brain surfaced ~36 findings. The
high-value/low-risk set shipped in the same-day commit ("Brain deep
review: fix …"); this file tracks what was **deliberately deferred**,
ranked. Each item cites the file so the next session can pick it up
without re-deriving.

## High value, needs design care

1. **Google/Gemini tool round-trip is broken twice** —
   `provider/google.go`. (a) `parseGoogleSSE` synthesizes ToolUseID
   `g_tool_%d` but `convertGoogleMessages` sends that id as
   `functionResponse.name`, which must equal the functionCall *name*;
   (b) `opened`/`toolBufs` maps are keyed by chunk-local part index, so
   later-chunk functionCalls collide with text accumulators and
   multi-call turns drop calls. Fix: emit ToolUseID as the function
   name (+`#n` suffix, stripped on the response side) and use a
   stream-global monotonic block index. Needs a fixture test with a
   recorded Gemini tool stream.
2. **Per-stream frontend emitters** — `bridge/frontend.go` holds ONE
   global emitter; two concurrent prompts still route `tool_request`s
   to the last-bound stream (the release-clobber half was fixed). Fix:
   map emitters by stream id, thread the id through ctx into
   `Frontend.Call`.
3. **TCP transport: per-connection ctx + parallel dispatch** —
   `sidecar/sidecar.go` runs handlers inline in the scan loop: a
   streaming prompt blocks `cancel` ops on the same connection, client
   disconnect doesn't cancel the agent loop (token spend continues),
   and `conn.Write` has no deadline (stalled client wedges the
   handler). Panic recovery + scanner-error reporting shipped; the
   dispatch/ctx work needs its own PR with the desktop client tested
   against it.
4. **Shared provider-resolution helper** — the composite peel +
   credential fallback lives in `handlePrompt` (choke point) with a
   minimal peel copy now in `ai.complete`. Extract
   `resolveProviderModel(provider, model, deps)` used by prompt,
   ai.complete, and buildSummarizer; then add the table-driven tests
   the cross-cutting reviewer sketched (this block has caused four
   documented regressions).
5. **Automation circuit breaker** — `automation.go` refires a
   permanently-failing rule forever. Errors now reach `markRun` and
   the conductor report; still missing: consecutive-failure counter →
   auto-pause with "needs re-login" status + one desktop notification,
   auto-resume on credential change. Needs Conductor-side status
   support.
6. **Fallback substitution honesty** — when the picked provider has no
   credentials, the prompt silently reroutes. Add
   `FallbackFrom`/`FallbackReason` to `provider.Routing` and emit via
   the existing OnRouting chip so the UI shows "anthropic → construct
   (no credentials)". Frontend chip rendering needed too.

## Medium

7. **OrgKeyStore/toolDeps capture the auth token as a string at boot**
   (`main.go`) — sign-in after boot never delivers org-enforced keys.
   Fix: token-resolver funcs (`func() string`), matching the DirFn
   pattern.
8. **identity.Loader race** — `Load()` reads path fields without the
   mutex; an in-flight Load can overwrite `current` with the OLD
   profile's identity after Rebind (cross-profile credential bleed).
   Generation counter under `l.mu`. (Mitigated in practice by
   profile.switch now calling Load() immediately.)
9. **Session bleed on profile switch** — an in-flight prompt appends
   the rest of profile A's conversation into profile B's sessions dir.
   Capture the session file path at prompt start (Store.Session(id)
   handle).
10. **LiveTokenSource concurrent refresh storm** — `oauth/live.go`
    releases the mutex before `inner.Token()`, so two concurrent
    prompts can both refresh and burn single-use rotated refresh
    tokens. Serialize or check the warm cache before rebuild.
11. **TaskStore.SetSession global** — `tool/tasks.go` races concurrent
    prompts; resolve the session from ctx (WithSession already exists).
12. **`/v1/request` should 400 on streaming ops** (`sidecar/http.go`) —
    last-chunk capture shipped, but a `prompt` via /v1/request still
    runs the whole agent server-side for one chunk.
13. **wire payload decode sweep** — many handlers `_ = json.Unmarshal`;
    add a `decodePayload(req, &pl, emit) bool` helper and sweep.
14. **Telemetry: record OnError + correlation ids** — failed turns
    leave no telemetry today; thread wire req.ID through streamHandler,
    DebugLogger, and telemetry events.
15. **conductor lease/report hardening** — lease bumped to 300s (>3min
    timeout); still fire-and-forget reports (retry w/ backoff + firing
    id for dedupe) and duplicate-fire window via cloud fallback.
16. **automations.* wire CRUD vs Conductor divergence** — local store
    rules are zombies in conductor mode; proxy CRUD to Conductor or
    stub with an error.

## Small / polish

17. **live-models probe for remote providers** (`wire_live_models.go`)
    — catalog base URL + resolveKey + `fetchOpenAIModels` with auth
    header ≈ 40 lines; kills the permanently-empty live lists on
    remote provider cards.
18. **provider_url precedence** — `providers.go` checks Settings→KV,
    `wire_live_models.go` checks KV only; collapse into one helper.
19. **Debug logger: full-content logging should become opt-in** —
    pruning shipped (7 days); flipping the default needs a decision
    (it's the only "chat returned nothing" diagnostic today — see #14
    first).
20. **session.AsMessages load-time pairing repair** — compaction and
    the agent loop now keep histories paired; a load-time sanitize
    would also heal sessions bricked by older builds.
21. **LSP readLoop treats server→client requests as responses**
    (`lsp/client.go`) — reply null to id+method messages instead of
    consulting the pending map.
