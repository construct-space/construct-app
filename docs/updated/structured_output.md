# Structured Output — Claude Code vs Construct Operator

## How Claude Code does it

Two approaches working together:

### 1. Native API-level (`output_config.format`)
- Sends `output_config: { format: { type: "json_schema", json_schema: {...} } }` to the Anthropic API
- API does constrained decoding — guarantees schema-valid JSON at the token level
- Used in side queries: session title generation, memory relevance scoring, prompt suggestions
- Requires `structured-outputs` beta header
- File: `src/services/api/claude.ts` (line 1577+)

### 2. Tool-based (`SyntheticOutputTool`)
- A fake tool called `StructuredOutput` that the model calls to return JSON
- Input schema = the user's desired JSON schema
- Ajv validates the model's tool call input against the schema
- If validation fails → throws error → model retries with the error message
- Schema compilation cached via WeakMap (80 calls from ~110ms to ~4ms)
- Only enabled in non-interactive sessions (SDK/CLI, not REPL)
- File: `src/tools/SyntheticOutputTool/SyntheticOutputTool.ts`

### Why both?
- Native `output_config` is for internal queries (titles, scores) where the model's final text must be JSON
- `SyntheticOutputTool` is for SDK callers who pass a `schema` parameter — the model calls the tool with valid JSON as the final action
- Different use cases: "make the model output JSON" vs "make the model return data through a typed tool"

### Claude Code's flow:
```
SDK caller passes schema → createSyntheticOutputTool(schema)
  → Ajv validates schema itself → compile validator
  → Add tool to tool pool
  → Model calls StructuredOutput({...data...})
  → Ajv validates input against schema
  → If invalid: throw error → model retries
  → If valid: return { structured_output: data }
  → QueryEngine extracts structured_output from tool result
  → Returns to SDK caller as typed data
```

Key details:
- `MAX_STRUCTURED_OUTPUT_RETRIES = 5` (counted per query)
- Schema validation is Ajv (full JSON Schema, not just `json.Valid`)
- Tool is read-only, concurrency-safe, always allowed by permissions
- Only available in non-interactive sessions
- Result includes both `data` (status string) and `structured_output` (actual typed data)

---

## How Construct Operator does it

### 1. Provider-level schema passing
- `provider.Request.OutputSchema` carries schema config to connectors
- Anthropic connector: sends as `output_config.format.json_schema`
- OpenAI connector: sends as `response_format.json_schema`
- Gemini connector: sends as `generation_config.response_schema`
- All three providers supported from day one
- File: `provider/provider.go` (OutputSchemaConfig), connectors `anthropic.go`, `openai_compat.go`, `google_gemini_cli.go`

### 2. Runner-level validation + retry
- `validateStructuredOutput()` checks response is valid JSON for strict schemas
- Strips markdown code fences (```json...```) before validation
- Retries up to 5x with a nudge message
- Only validates when `OutputSchema.Strict == true`
- File: `runner/structured_output.go`

### 3. Builtin schema registry
- `builtinOutputSchema(key)` maps schema names to JSON Schema configs
- Currently: `architect.v1` — the architect agent's question/plan/progress envelope
- Strict mode: validated on every response
- File: `runner/output_schema.go`

### Construct's flow:
```
RunRequest.OutputSchema = "architect.v1"
  → builtinOutputSchema("architect.v1") → OutputSchemaConfig{Strict: true, Schema: ...}
  → Provider checks SupportsStructuredOutput capability
  → If supported: attach to API request
  → Model responds with JSON
  → validateStructuredOutput() checks json.Valid()
  → If invalid: retry with nudge (up to 5x)
  → If valid: return response
```

---

## Comparison

  ┌─────────────────────────┬────────────────────────────────────┬────────────────────────────────────┐
  │ Aspect                  │ Claude Code                        │ Construct Operator                 │
  ├─────────────────────────┼────────────────────────────────────┼────────────────────────────────────┤
  │ Schema source           │ SDK caller passes schema at        │ Builtin registry (architect.v1)    │
  │                         │ runtime via agent({schema})        │ or from RunRequest                 │
  ├─────────────────────────┼────────────────────────────────────┼────────────────────────────────────┤
  │ API-level enforcement   │ output_config.format (Anthropic)   │ OutputSchema on 3 providers        │
  │                         │ Anthropic only                     │ (Anthropic, OpenAI, Gemini)        │
  ├─────────────────────────┼────────────────────────────────────┼────────────────────────────────────┤
  │ Tool-based approach     │ SyntheticOutputTool — model calls  │ Not implemented — we validate      │
  │                         │ a fake tool, Ajv validates input   │ the response text, not tool input  │
  ├─────────────────────────┼────────────────────────────────────┼────────────────────────────────────┤
  │ Schema validation       │ Ajv (full JSON Schema validator)   │ json.Valid() (syntax only)         │
  ├─────────────────────────┼────────────────────────────────────┼────────────────────────────────────┤
  │ Retry on invalid        │ Yes, up to 5x                     │ Yes, up to 5x                     │
  ├─────────────────────────┼────────────────────────────────────┼────────────────────────────────────┤
  │ Multi-provider          │ Anthropic only                     │ Anthropic + OpenAI + Gemini        │
  ├─────────────────────────┼────────────────────────────────────┼────────────────────────────────────┤
  │ Dynamic schemas         │ Yes — any JSON Schema at runtime   │ No — builtin registry only         │
  ├─────────────────────────┼────────────────────────────────────┼────────────────────────────────────┤
  │ Schema caching          │ WeakMap identity cache (4ms)       │ None (schemas are static)          │
  ├─────────────────────────┼────────────────────────────────────┼────────────────────────────────────┤
  │ Code fence handling     │ Not needed (tool input is JSON)    │ Strips ```json fences from text    │
  ├─────────────────────────┼────────────────────────────────────┼────────────────────────────────────┤
  │ Streaming compatible    │ Yes (SDK streams tool events)      │ Yes (streaming + validation)       │
  └─────────────────────────┴────────────────────────────────────┴────────────────────────────────────┘

---

## What we're missing

### 1. SyntheticOutputTool (tool-based approach)
**Problem:** We validate the model's text response as JSON. Claude Code makes the model call a typed tool with the schema as its input — this is more reliable because the API enforces tool input schemas at the token level.
**Solution:** Create a `StructuredOutput` tool (read-only, always allowed) whose input schema is the caller's desired schema. Model calls it, we validate with a proper JSON Schema validator.

### 2. Full JSON Schema validation (not just syntax)
**Problem:** `json.Valid()` only checks syntax — valid JSON but wrong structure passes. Claude Code uses Ajv which validates against the actual schema (required fields, types, enum values).
**Solution:** Add a Go JSON Schema validator (e.g. `github.com/santhosh-tekuri/jsonschema`) to validate response content against the schema.

### 3. Dynamic schema support
**Problem:** We only support schemas from the builtin registry. Claude Code accepts any JSON Schema at runtime from SDK callers.
**Solution:** Accept schema in `RunRequest` directly (not just by name). Already have the plumbing — `OutputSchemaConfig.Schema` is `json.RawMessage`.

### What we do better
- Multi-provider: we send structured output to Anthropic, OpenAI, AND Gemini. Claude Code only sends to Anthropic.
- Code fence stripping: our `stripCodeFences()` handles models that wrap JSON in markdown — Claude Code doesn't need this because they use tool input instead of text.

---

## Problem → Solution Log

### Provider-level schema passing — DONE
**Problem:** Need to send JSON Schema to different LLM providers.
**Solution:** `OutputSchemaConfig` in provider.Request, each connector maps to provider-specific format.
**Files:** `provider/provider.go`, `connectors/anthropic.go`, `connectors/openai_compat.go`, `connectors/google_gemini_cli.go`

### Response validation + retry — DONE
**Problem:** Model might return invalid JSON even with schema enforcement.
**Solution:** `validateStructuredOutput()` checks json.Valid() for strict schemas, retries up to 5x with nudge.
**Files:** `runner/structured_output.go`

### Builtin schema registry — DONE
**Problem:** Need a way to map schema names to configs.
**Solution:** `builtinOutputSchema()` — currently architect.v1, extensible.
**Files:** `runner/output_schema.go`

### SyntheticOutputTool — DONE
**Problem:** Text-based validation is less reliable than tool-based.
**Solution:** `CreateSyntheticOutputTool(schema)` — model calls StructuredOutput tool, we validate with full JSON Schema. `InjectSyntheticOutputTool()` adds to tool pool. `ExtractStructuredOutput()` extracts from tool call.
**Files:** `runner/synthetic_output_tool.go`
**Tests:** 7 (create, valid/invalid input, invalid schema, inject, extract, cache)

### Full JSON Schema validation — DONE
**Problem:** `json.Valid()` only checked syntax — wrong structure passed.
**Solution:** `github.com/santhosh-tekuri/jsonschema/v6`. `compileSchema()` compiles + caches. Validates required fields, types, enums — not just syntax.
**Files:** `runner/structured_output.go`
**Tests:** 6 (no schema, valid, invalid JSON, missing required, wrong type, code fences)

### Dynamic schema from callers — DONE
**Problem:** Only builtin schemas supported.
**Solution:** `RunRequest.DynamicSchema` accepts raw JSON Schema. `Run()` injects SyntheticOutputTool dynamically.
**Files:** `runner/runner.go`
