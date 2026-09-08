# Structured Output

## Common Ground Across Gemini, OpenAI, and Claude

The current structured-output guides from Gemini, OpenAI, and Claude all converge on the same core ideas:

| Theme | Common point |
| --- | --- |
| Contract | Structured output is driven by a JSON Schema-like contract that constrains the model into valid, machine-readable JSON. |
| Main benefit | The goal is reliable typed output for downstream code, not just "JSON-looking" text. |
| SDK ergonomics | All three push you toward SDK-native schema helpers instead of hand-authoring raw JSON everywhere. Pydantic and Zod show up across providers. |
| Tool workflows | Structured final responses and tool/function calling are related but separate concerns. All three support using structured output in workflows that also involve tools. |
| Streaming | Structured output can be streamed instead of waiting for the full response body. |
| Schema limits | None of the providers treat this as "full unrestricted JSON Schema". Each documents supported subsets, unsupported features, or complexity limits. |
| App-side validation | Schema adherence reduces formatting errors, but you still need to handle refusals, truncation, and semantic mistakes in application code. |
| Schema design matters | Clear fields, explicit required keys, shallow nesting, and stable ordering improve reliability across all three. |

## What That Means In Practice

### 1. JSON Schema is the shared contract layer

- Gemini says responses can adhere to a provided JSON Schema and uses `response_mime_type: "application/json"` with `response_json_schema`.
- OpenAI says Structured Outputs ensure responses adhere to your supplied JSON Schema.
- Claude uses `output_config.format` with `type: "json_schema"` and a schema object.

This is the clearest common denominator: each provider is converging on schema-constrained decoding rather than prompt-only JSON formatting.

### 2. Typed SDK helpers are the preferred authoring path

- Gemini documents Pydantic and Zod.
- OpenAI documents Pydantic and Zod.
- Claude documents SDK helpers including `.parse()`, plus Pydantic and Zod integrations.

The common pattern is to define the shape once in code, let the SDK derive or adapt the schema, and parse the response back into typed objects.

### 3. Structured output is not the same thing as tool calling

- OpenAI explicitly separates structured response formatting from function calling.
- Claude explicitly separates JSON outputs from strict tool use, while allowing both in one request.
- Gemini shows structured outputs working together with built-in tools and function calling.

Shared takeaway: "return a typed final answer" and "call tools with valid arguments" are adjacent problems, but they are not the same API surface.

### 4. Streaming is part of the happy path

- Gemini shows `generateContentStream()` with structured output.
- OpenAI has a dedicated streaming section for Structured Outputs.
- Claude lists structured outputs as compatible with streaming.

So the cross-provider expectation is that structured output should work in interactive UIs, not only batch-style request/response flows.

### 5. All three require schema discipline

- Gemini supports only a subset of JSON Schema and may reject large or deeply nested schemas.
- OpenAI supports much of JSON Schema, but adds restrictions such as root-object requirements, required fields, and supported-schema constraints.
- Claude supports standard JSON Schema with limitations and also documents grammar compilation and schema complexity limits.

The shared design implication is simple: keep schemas explicit, shallow, and boring.

### 6. "Valid against schema" does not mean "correct"

- OpenAI explicitly warns that structured outputs can still contain mistakes and that unrelated user input can lead to hallucinated-but-schema-valid answers.
- Claude documents refusal and `max_tokens` cases where output may not match schema.
- Gemini examples still parse and validate returned JSON in application code, and the docs note unsupported features and schema complexity limits.

Common takeaway: structured output removes a large class of formatting failures, but it does not remove product-level validation.

### 7. Schema order influences output order

- Gemini says outputs are produced in the same order as keys in the schema.
- OpenAI says outputs are produced in the same order as the keys in the schema.
- Claude says property ordering follows schema order, with required fields emitted before optional ones.

That means key order is part of the UX contract if humans or downstream diffs will read the JSON.

## Important Caveats

- The overlap is real, but the APIs are not interchangeable.
- OpenAI and Claude are more explicit than Gemini about refusals and invalid-output edge cases.
- Claude is the most explicit about grammar compilation, caching, and schema-complexity costs.
- Gemini is the most direct about pairing structured output with built-in tools on the same request.

## Sources

- Gemini: <https://ai.google.dev/gemini-api/docs/structured-output?example=recipe#go_2>
- OpenAI: <https://developers.openai.com/api/docs/guides/structured-outputs>
- Claude: <https://platform.claude.com/docs/en/build-with-claude/structured-outputs>
