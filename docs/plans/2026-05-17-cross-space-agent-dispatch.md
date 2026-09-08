# Cross-Space Agent Dispatch — `useContextService` / `askAgent`

**Status:** TODO — design needed before implementation.

## Background

space-chat wants to ask other spaces' agents questions:

> "Summarize today's helpdesk tickets" → routed to the **helpdesk** agent, which can read helpdesk's graph and reply.
> "What's on my calendar this week?" → **calendar** agent, with its scope.

The original space-chat `actions.ts` probed for a host-injected `useContextService().dispatchToAgent(spaceId, question)` and fell back to `useOperator.send('agent.dispatch', …)`. Neither was ever wired on the host. On 1.1.0 those imports were removed; the action now falls straight through to its error path.

Today brain only knows about **one** agent — the one bound to the currently-active space. It has no concept of "run agent B in space B's scope on behalf of caller in space A."

## The real question

"How do agents talk to other agents?" — not "what does `dispatchToAgent` return."

This is the *agents are services* pivot. To answer it you need:

1. **Identity propagation** — when space-chat asks helpdesk's agent something, whose identity does the call run under? The caller's (chat's user) — so helpdesk's row-level access still applies. Brain currently reads identity from request headers; cross-space dispatch needs to keep them intact.

2. **Scope switching** — `X-Space-ID` is set per request. A cross-space call from chat to helpdesk needs to flip to `X-Space-ID: helpdesk` for the duration of *that agent's* tool calls (so graph queries hit helpdesk's per-tenant schema). Then back to chat for the result.

3. **Agent registry on brain** — brain needs to know all installed agents per org, their tools/skills, and how to invoke each. Today this is implicit (`agents/builtin/<id>/prompt.md`). Spaces' own agents (`agent/config.md`) need to be first-class citizens in the same registry.

4. **Cost & rate-limit semantics** — does the dispatched call charge the caller, the callee's org, or split? If callee blows its rate limit, does the caller see the failure or a degraded result? This matters once dispatch is metered.

5. **Result shape** — agents return streaming events (tool calls, text deltas, final). What does the caller see? A single text reply? The full stream? Tool-call provenance ("helpdesk's agent ran 3 queries to answer this")?

6. **Loop prevention** — agent A asks B asks C asks A. Who notices and aborts?

7. **Consent UX** — first time chat dispatches to helpdesk, does the user approve? Per call? Per space-pair? Forever?

## API sketch (open)

```ts
const dispatch = useAgentDispatch()
const result = await dispatch({
  targetSpaceId: 'helpdesk',
  task: 'How many open tickets do we have?',
  // caller identity flows automatically (host trusts request)
  budget?: { maxToolCalls: 5, maxSeconds: 30 },
  stream?: (event) => …,
})
// { text, toolCalls: [...], usage: {...}, cost: {...} }
```

## Not the same as `crossSpaceList`/`crossSpaceCount`

Those are direct graph reads with no agent involvement — fast, deterministic, no LLM cost. They're the right call for "list helpdesk tickets where status=open." They're the *wrong* call for "summarize helpdesk's open tickets" — that needs the helpdesk agent's prompt + tools + skills.

The dispatch API doesn't replace direct graph reads; it complements them.

## What needs deciding

- **Who's the unit of dispatch** — the agent (one Anthropic call) or a session (multi-turn)? Leaning agent-call for v1; sessions are a follow-up.
- **Sync vs async** — do callers await the full result, or get a handle they poll? Sync feels right for short tasks; async is needed for "rendered the report, emailed it to me."
- **Streaming back to the caller** — full stream, summary, or just final? Probably configurable per call.
- **Brain agent registry** — building this as a graph table vs config files vs both. Per-org overrides ("my org's helpdesk agent uses a stricter prompt") need a place to live.

## Related

- [`useSpaceTool`](./2026-05-17-space-binary-api.md) — when an agent dispatches to one that needs a native tool, both APIs are in the call path.
- [`Host AI modalities`](./2026-05-17-host-ai-modalities.md) — the dispatched agent may use STT/image-gen too; same provider plane applies.
- Brain registry rework — current `agents/builtin/` is host-shipped; dispatch implies promoting space-supplied agents to the same tier.
