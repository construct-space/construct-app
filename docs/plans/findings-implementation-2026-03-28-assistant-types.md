# Implementation Findings — Assistant Types

Reviewed: 2026-03-28 (final pass)

Checks run:
- `bun test frontend/assistant/ frontend/spaces/architect/assistant/` — 34 tests pass
- `bun run typecheck` — clean
- `cd operator && go build ./... && go test ./...` — 23 suites pass

## Resolved

1. ~~Architect and Brainstorm surfaces don't pass `assistantType`~~ — **Fixed.** ArchitectPage passes `assistantType: 'architect'` + `outputSchema: 'architect.v1'`, BrainstormPage passes `assistantType: 'brainstorm'`, and AssistantPanel now explicitly passes `agentId: 'general'` + `assistantType: 'general'`.

2. ~~Per-type normalization blocked by `tryParseAssistantEnvelope` only accepting `assistant.v1`~~ — **Fixed.** The per-type path in `useAgentSession.ts` now passes raw text directly to `normalize(assistantType, raw)`, bypassing the envelope parser entirely. Each per-type normalizer handles its own parsing (e.g. architect normalizer has its own Zod schema).

3. ~~Custom block `@answer` not forwarded~~ — **Fixed.** `ResponseBlocks.vue` custom component branch binds `@answer` and `@action`, forwarding through the shared `question-answer` emit channel. `ArchitectQuestionsBlock.vue` emits `answer` with selection state.

4. ~~Custom block payloads dropped on save/load~~ — **Fixed.** `chatsession/store.go` Block struct has `Data json.RawMessage` field.

5. ~~SpaceLoader doesn't call `loadSpaceAssistantTypes`~~ — **Fixed.** `SpaceLoader.ts` imports and calls it after manifest parse.

6. ~~Custom block renderer lookup missing~~ — **Fixed.** `ResponseBlocks.vue` calls `resolveBlockRenderer()` for namespaced block types.

7. ~~`assistant_type`/`output_schema` not on frontend dispatch path~~ — **Fixed.** `client.ts` and `useAgentSession.ts` accept and forward both fields.

## Remaining

1. `[P1]` Backend structured-output support is still not end-to-end.

   The request plumbing exists now: `provider.Request` has `OutputSchema`, the runner has a builtin schema registry, and `runner.go` attaches `provReq.OutputSchema` when a builtin schema is requested. But none of the real provider connectors consume `req.OutputSchema` yet, so there is still no provider-native schema enforcement. There is also a gating issue on the main architect path: the runner only attaches schemas when `len(toolDefs) == 0`, but the builtin Architect agent has tools (`get_project_context`, `write_file`, `read_file`, `bash`, `list_dir`), so native structured output will not engage for its normal tool-enabled runs.

2. `[P3]` Question ID preservation is still inconsistent outside Architect.

   `AgentView` now correctly emits `string | string[]`, and ArchitectPage preserves the `questionId` by sending `[questionId]: answer`. But BrainstormPage and OraclePanel still flatten answers to plain text and discard `questionId`. That means the general “all consumers include question ID” claim is not true yet.
