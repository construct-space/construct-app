# Capability Slots, Runner Flows, and Local-First Routing

**Status:** DRAFT — design sketch, no code yet.

## The case

Today the operator has one runner flow that assumes a frontier-tier model:
128k context, reliable tool calling, multi-turn planning, structured-output
retries, the full 22-tool builtin set, and a system prompt assembled from
coder.md + project context + CLAUDE.md + memory + skills. Every request — a
shop owner asking "show today's invoices" or a developer asking Coder to
refactor a service — gets the same treatment.

The user picks **one** model in settings. Whatever they leave it on is what
every panel uses. So in practice:

- A power user leaves it on Opus, asks AssistantPanel "what time is it" 50× a
  day, and burns $20/month on questions a 4B model could answer in 80ms for
  free.
- A small business installs Construct for inventory + invoicing + calendar
  spaces, doesn't realize they're routing every "add a customer" through Opus,
  and gets a bill they can't justify.
- A video editor has a great M-series Mac running ComfyUI locally — but the
  app insists on routing image-gen through OpenAI because that's the only
  image provider it knows about.

The fix isn't a smarter default. The fix is: **the user decides which model
serves which kind of work, and the runner respects that**.

### Why local-first

For a huge fraction of real Construct workloads, a 4B–8B local model is not
just adequate — it's *strictly better* than a frontier model:

- **$0 marginal cost.** Forever. No subscription, no surprise bill.
- **Privacy.** Customer names, invoice totals, calendar entries never leave
  the machine.
- **Latency.** No 200–500ms round-trip; tool calls feel instant.
- **Offline.** Wifi dies, the app still works.
- **No rate limits, no vendor deprecations.**
- The hardware is already in the room — an M-series MacBook with 16GB+ RAM
  runs qwen3-4b-instruct or llama-3.2-3b-tool flawlessly.

Spaces are *narrow* by design (5–10 actions per space, scoped intent). That's
exactly the shape a small tool-capable model handles perfectly: `user →
choose one of N actions → format the result`. No multi-step planning needed.

Construct can be the only serious AI workspace that runs **$0/month, fully
local, on hardware you already own** — because spaces are scoped enough that
local models cover the workload. Frontier models become the *escalation*,
not the default.

## Three personas, one architecture

The system has to accommodate radically different setups without
special-casing any of them:

| Persona | small | medium | large | vision | image-gen | voice |
|---|---|---|---|---|---|---|
| Flower shop (M2 MacBook) | lmstudio:qwen3-4b | lmstudio:qwen3-14b | anthropic:haiku-4-5 | — | — | — |
| Indie video editor (M3 Max) | lmstudio:qwen3-4b | lmstudio:llama-3.3-70b | openai:gpt-5 | lmstudio:qwen2-vl-7b | local:comfyui-sdxl | local:whisper-large-v3 |
| Frontier-only dev (no local) | anthropic:haiku-4-5 | anthropic:sonnet-4-6 | anthropic:opus-4-7 | anthropic:opus-4-7 | openai:dalle-3 | openai:whisper-1 |
| Casual user (defaults) | anthropic:haiku-4-5 | anthropic:sonnet-4-6 | anthropic:opus-4-7 | anthropic:opus-4-7 | openai:dalle-3 | openai:whisper-1 |

Same architecture for all of them. The user fills in the slots from the
models their enabled providers actually expose. Empty slot = the capability
isn't available to that user. The runner never assumes a slot is filled.

## Capability slots

A **slot** is a named role: `small`, `medium`, `large`, `vision`,
`image-gen`, `video-gen`, `voice-tts`, `voice-stt`, `embedding`. Each slot
has:

- A **flow** it runs through (chat / narrow / agent / one-shot).
- A **capability filter** required of any candidate model (e.g. `vision`
  needs `vision` capability, `image-gen` needs `image.generate`).
- A **user-bound model** chosen in settings from candidates that pass the
  filter.

Slots are decoupled from providers. The slot says "this is the small one".
The user binds whichever model fits — Haiku, qwen3-4b, GPT-5-nano, anything
on the registered providers list that the user has enabled.

### Initial slot set

| Slot         | Flow     | Capability filter           | Typical model                |
|--------------|----------|-----------------------------|------------------------------|
| `small`      | narrow   | `tools`                     | qwen3-4b, Haiku 4.5          |
| `medium`     | agent    | `tools` + `structured`      | Sonnet 4.6, GPT-5-mini       |
| `large`      | agent    | `tools` + `structured`, large ctx | Opus 4.7, GPT-5         |
| `vision`     | narrow or agent (depends on caller) | `vision` | Opus 4.7, qwen2-vl-7b |
| `image-gen`  | one-shot | `image.generate`            | DALL-E 3, local SDXL         |
| `video-gen`  | one-shot | `video.generate`            | Sora, local AnimateDiff      |
| `voice-tts`  | one-shot | `voice.synthesize`          | ElevenLabs, local Piper      |
| `voice-stt`  | one-shot | `voice.transcribe`          | Whisper API, local whisper.cpp |
| `embedding`  | one-shot | `embedding`                 | text-embedding-3-small, nomic |

Slots are **not** hardcoded — they're declared in
`operator/internal/runtime/slots.go` and discoverable so the settings page
renders them dynamically. New slots (`audio-music`, `agent-coder`, etc.) get
added by registering a name + flow + filter; settings UI updates
automatically.

## Three runner flows

Slots map to flows, not the other way around. The flows themselves:

| Flow      | Loop                              | Tools                       | Use case                          |
|-----------|-----------------------------------|-----------------------------|-----------------------------------|
| `chat`    | single-shot                       | none                        | AssistantPanel Q&A, completions   |
| `narrow`  | 2 turns max: `user→tool?→reply`   | space actions only          | Space assistants on small models  |
| `agent`   | multi-turn + structured retry     | builtins + space actions    | Coder, Architect, hard work       |
| `one-shot`| single request/response, no loop  | none (returns artifact)     | Image gen, voice, embeddings      |

`chat` and `narrow` are new. `agent` is today's runner lifted verbatim.
`one-shot` is the trivial passthrough for image/voice/embedding endpoints
that don't involve conversation — caller sends a prompt, gets back a URL or
a blob.

### Why narrow exists separately

A 4B model that misfires on turn 1 doesn't recover on turn 3 — it spirals
and burns context. The narrow flow is built around that reality:

- Hard cap at 2 turns: `user → maybe one tool call → reply`.
- Only the space's actions injected (typically 5–10), no builtins, no
  StructuredOutput synthetic tool, no plan/coordinate.
- No retry-and-reflect on parse failures. If the model emits malformed JSON
  for a tool call, surface the error — don't loop.
- Smaller system prompt: floor + space action list, target ≤ 25% of
  context. Skip CLAUDE.md, skip project context, skip skills.

That's the flow that makes qwen3-4b *actually useful*, not just "loaded".

## Per-model metadata

Add to `provider.ModelMeta`:

```go
type ModelMeta struct {
    ID            string
    Label         string
    Capabilities  []string
    ContextTokens int    // new — per-model, NOT per-provider
}
```

`ContextTokens` is per-model because one LM Studio install hosts a 4k chat
model and a 128k coding model side by side. Provider-level `128000` (current
default in `openai_compat.go:209`) is wrong for every local provider and
sometimes wrong for cloud providers too.

Sources, in order:
1. Per-model entry in the registered model map (canonical).
2. Provider's `/v1/models` endpoint when it exposes context_length (some LM
   Studio builds do).
3. Heuristic from model id (`*-4b*` → 32k, `*-1b*` → 4k, conservative).
4. Fallback: 4k. Forces user to set it explicitly for unknown models rather
   than silently overrunning.

The runner uses `ContextTokens` to budget the system prompt: target ≤25%
for `agent`, ≤25% for `narrow`, ≤10% for `chat`. Drop sections in order
(skills → memory → CLAUDE.md → project context) until the budget fits. Base
agent persona is the non-negotiable floor (~400 tokens).

There's **no `Tier` field on the model**. Tier is whatever slot the user
binds the model to. A model isn't "small" — it's "what the user put in the
small slot". This avoids the trap of arguing about whether qwen3-4b is
"small" or "medium": the user decides.

## Endpoints

The operator exposes one request type per slot:

```
run.small        run.vision       run.embedding
run.medium       run.image-gen
run.large        run.video-gen
                 run.voice-tts
                 run.voice-stt
```

Each handler:

1. Look up the user's binding for that slot. If unset → return
   `ErrSlotUnbound` with the candidate model list so the frontend can show
   "configure this in settings".
2. Verify the bound model is still available (provider enabled, model
   loaded). If not → `ErrSlotUnavailable`.
3. Resolve the slot's flow + capability filter.
4. Dispatch to the flow with the bound model, the caller's payload, and the
   slot context.
5. Stream the result back via the existing `stream.event` mechanism (same
   socket, same correlation id).

Same call shape from the frontend's perspective regardless of slot:

```ts
const stream = await operator.sendStream('run.small', {
  message: 'list today\'s deliveries',
  space_id: 'flower-shop-inventory',
})

const result = await operator.send('run.image-gen', {
  prompt: 'hero image for landing page, watercolor flowers',
  size: '1024x1024',
})
```

The frontend never names a model. It names a slot. The operator binds slot
to model from settings.

### Why "all endpoints" and not "one endpoint with a slot field"

Considered: `operator.send('run', { slot: 'small', ... })`. Rejected
because:

- Different slots need radically different payloads (chat message vs image
  prompt vs audio blob). Sharing a field name forces ugly union types or
  loose validation.
- Per-endpoint timeouts: `run.image-gen` may legitimately run 60s,
  `run.small` should bail at 10s. Easier to gate by request-type prefix
  (operator already does this — `desktop/src/operator.rs:328`).
- Logs and telemetry are clearer when the action is in the name.
- Tauri's IPC bridge keys timeout policy off `request_type`. One-endpoint
  forces all slots to share the worst-case timeout.

## Settings shape

A single settings section, dynamic over the slot registry:

```
┌─ AI Slots ─────────────────────────────────────────────┐
│                                                         │
│  Small (quick questions, tool calls)                    │
│    ⓘ Used by AssistantPanel and space assistants        │
│    [ qwen3-4b-instruct  (LM Studio)            ▼ ]      │
│                                                         │
│  Medium (chat, single-file edits, normal work)          │
│    [ claude-haiku-4-5  (Anthropic)             ▼ ]      │
│                                                         │
│  Large (hard reasoning, Coder, Architect)               │
│    [ claude-opus-4-7  (Anthropic)              ▼ ]      │
│                                                         │
│  Vision (screenshots, OCR)                              │
│    [ Not configured                            ▼ ]      │
│                                                         │
│  Image generation                                        │
│    [ dall-e-3  (OpenAI)                        ▼ ]      │
│                                                         │
│  Video generation                                        │
│    [ Not configured                            ▼ ]      │
│                                                         │
│  Voice (text-to-speech)                                 │
│    [ ElevenLabs Multilingual v2                ▼ ]      │
│                                                         │
│  Voice (transcribe)                                     │
│    [ whisper-large-v3  (LM Studio)             ▼ ]      │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

Each dropdown lists every model on an enabled provider that passes the
slot's capability filter, grouped by provider, with the provider's icon and
a `(local, free)` badge where applicable. Unbound slots are valid — that
capability is simply not available.

Backing store: one row per slot in the existing settings system.

```
slot:small      → "lmstudio:qwen3-4b-instruct"
slot:medium     → "anthropic:claude-haiku-4-5"
slot:large      → "anthropic:claude-opus-4-7"
slot:vision     → ""
slot:image-gen  → "openai:dall-e-3"
...
```

No new schema, just keys.

## Routing: how a user message finds the right agent

**The space declarations are the router.** No model call needed in the
common case. Installed spaces announce what they handle; AssistantPanel
matches against those declarations deterministically. The flower shop
never burns a model call to decide where "add tulips to today's order"
should go.

### Resolution order

1. **Explicit `@agent` mention** — `@weather is it raining` invokes the
   weather agent directly. No matching, no ambiguity, no cost. The `@`
   menu shows installed agents (Slack-style).
2. **Keyword / pattern match** against installed-space `intents`
   declarations. First match wins; ties resolved by the rules below.
3. **Unmatched → suggestion** (no model call). AssistantPanel scans
   installed-space `description` fields for the best text-similarity
   match and replies inline: *"That sounds like a job for `@builder` —
   want me to send you there?"* with a clickable chip. The user confirms
   (cheap), or rephrases. No silent escalation, no surprise Opus bill.
4. **User opts to escalate** — clicking "Send to @builder", or typing
   `@builder make me a landing page`, or hitting an explicit
   *Builder* button in the panel header. That dispatches to whatever
   slot the builder space declares (`run.large` in this case).
5. **Default fallback** (when nothing matches and the user just keeps
   typing) — AssistantPanel's configured default agent. A flower shop
   might set this to "say I don't know", a developer might set it to
   `@coder`. Configurable per user.

The model-based Conductor from earlier drafts is **deleted**. Keyword
matching plus a description-similarity suggestion covers every case the
Conductor was meant to cover, at zero marginal cost and with fully
deterministic behavior the user can debug.

### Space manifest: `agent.intents`

```json
{
  "id": "weather",
  "name": "Weather",
  "description": "Current conditions and forecasts for any city.",
  "agent": {
    "minSlot": "small",
    "preferredSlot": "small",
    "intents": {
      "keywords": ["weather", "forecast", "temperature", "rain", "snow"],
      "patterns": [
        "^(what'?s|how'?s) the weather",
        "will it (rain|snow|be sunny)"
      ],
      "examples": [
        "what's the weather in Paris",
        "will it rain tomorrow"
      ]
    }
  }
}
```

- `keywords` — substring matches against the lowercased input. Cheapest,
  evaluated first.
- `patterns` — anchored regexes. Evaluated only if no keyword hit, so the
  perf cost is rare and bounded.
- `examples` — human-readable seeds for the description-similarity
  fallback (step 3 above) *and* documentation for the `@` menu. Not
  evaluated as live matchers in v1 — they're shown in the agent's help
  card. (v2 could precompute embeddings for fuzzy match; skip for v1.)

### Tiebreaking when two spaces match

Order of preference:
1. **Most specific match wins** — a regex pattern hit beats a keyword hit;
   a longer keyword hit beats a shorter one.
2. **User pin** — settings let the user pin a default for a keyword
   (`"calendar" → @work-calendar`).
3. **Most-recently-used** — last agent the user invoked for a similar
   query.
4. **Picker chip** — if still ambiguous, AssistantPanel shows a one-tap
   picker rather than guessing. *"Did you mean @weather or @forecast?"*

No matching ever runs a model. The picker is faster and cheaper than
classification, and the user is in the loop for the rare cases that
actually need it.

### Space manifest: full agent block

```json
{
  "agent": {
    "minSlot": "small",
    "preferredSlot": "small",
    "intents": { /* see above */ }
  }
}
```

- `minSlot` — the smallest slot the agent can run on. Even if the user
  has Opus configured, a `minSlot: small` space routes to `run.small`.
  The flower shop's invoice agent never sees an Opus bill, full stop.
- `preferredSlot` — what the agent runs on when available; falls back
  upward only if the preferred slot is unbound. Must be ≥ `minSlot`.
- `intents` — the routing declaration above.

Validator (in `space.manifest.json` schema):
- `minSlot` ∈ {`small`, `medium`, `large`}.
- `preferredSlot` ≥ `minSlot` in the ladder.
- Capability slots (vision, image-gen, etc.) are not space-bound — they
  are invoked ad-hoc as tools by the orchestrator flow.

## Capability tools (the chaining story)

When `agentFlow` runs on a model that doesn't have a capability the user
needs mid-turn, it calls a *tool* the operator binds to the capability
slot. From Opus's perspective:

```
tool: generate_image
  description: "Generate an image. Returns a URL."
  params: { prompt: string, size?: string, style?: string }
```

The operator routes that tool call to whatever model the user has in
`slot:image-gen`. Opus doesn't know it just talked to DALL-E (or local
ComfyUI). It just got a URL back and continues planning the landing page.
Same pattern for `transcribe_audio`, `synthesize_speech`, `embed_text`,
`generate_video`.

This is the **service-mesh** part of the design: capabilities are uniform
tool dispatches; the operator binds tool → provider at execution time
based on the user's slot settings. Add a new provider, fill in the slot,
and every existing agent flow gains that capability for free.

## Interaction trace logging (foundation, ship early)

Every interaction with the runner is captured to a local trace store. This
is the dataset that enables every downstream optimization: prompt tuning,
slot accuracy measurement, capability routing audits, and — most
importantly — fine-tuning a Construct-specialized local model later (see
§Construct Flash).

### What gets logged

Per turn:

```jsonl
{
  "ts": "2026-05-12T14:22:08Z",
  "session_id": "sess_...",
  "turn_id": "turn_...",
  "endpoint": "run.small",
  "slot_resolution": {
    "via": "intent_keyword",
    "matched_space": "weather",
    "matched_token": "weather"
  },
  "model": "lmstudio:qwen3-4b-instruct",
  "user_message": "what's the weather in Pristina",
  "system_prompt_hash": "sha256:...",
  "system_prompt_tokens": 412,
  "context_tokens_total": 487,
  "tools_offered": ["weather_now", "forecast_week"],
  "model_output": {
    "tool_call": { "name": "weather_now", "args": { "city": "Pristina" } },
    "text": "It's 23°C and sunny in Pristina."
  },
  "tool_result": { "ok": true, "data": { "temp_c": 23, "cond": "sunny" } },
  "latency_ms": { "first_token": 84, "total": 612 },
  "outcome": "success",
  "user_feedback": null
}
```

The `system_prompt_hash` is the hash of the assembled prompt, not the
prompt itself, so prompts can be re-derived from versioned source rather
than stored verbatim (saves disk + dodges accidental secrets in prompts).
Optional `system_prompt_dump: true` flag stores the actual prompt for the
session if the user opts in for debugging.

### Where it's stored

- **Local-first.** All traces written to `appdir/traces/<YYYY-MM-DD>.jsonl`.
  Append-only, rotated daily.
- **Never auto-uploaded.** Trace export is an explicit user action — *Settings
  → Privacy → Export Traces*. Opt-in only, every time.
- **Redaction by default.** Patterns matching email, phone, credit card,
  SSH key, API key are redacted at write time. The user's actual content
  is the dataset's value; redaction protects everything around it.
- **Retention default 30 days.** User can set 0 (don't log), 7, 30, 90,
  forever.

### Settings UX

```
┌─ Privacy ──────────────────────────────────────────────┐
│                                                         │
│  Interaction logging                                    │
│    Logs are stored locally and never uploaded.          │
│    They power debugging, accuracy metrics, and —        │
│    if you opt in later — training a Construct-tuned     │
│    local model.                                         │
│                                                         │
│    Retention:  [ 30 days  ▼ ]                           │
│                                                         │
│    Redaction:  [×] emails, phones, keys                 │
│                [ ] full content (extreme — turns off    │
│                     all logging)                        │
│                                                         │
│    [ View log directory ]   [ Export traces ]            │
│    [ Delete all traces ]                                │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Why ship this early

If you decide later to fine-tune Construct Flash (or to A/B prompt
variants, or to measure slot-routing accuracy, or to debug a "why did it
escalate to Opus" bug), the dataset already exists. If you ship the
runner refactor without logging, you throw away the first N months of
real-world interaction data — which is exactly the data a frontier model
*can't* generate synthetically, because it's the patterns *your users*
have, not what GPT thinks they have.

Logging is cheap to add and reversible (`retention: 0` deletes
everything). Not logging is irreversible: the data simply doesn't exist
later.

## Construct Flash (deferred experiment)

**Status: experiment, not roadmap commitment.** Worth running with Tinker
credits; ship only if the measured accuracy gain justifies the maintenance
burden.

### The pitch

Fine-tune `Qwen/Qwen3-4B-Instruct-2507` on Construct-specific interaction
patterns to produce **Construct Flash** — a ~2GB local model that ships
with the app, runs free on any 16GB+ Mac, and is specifically trained on:

- The narrow-flow tool call format (space action invocations)
- `assistant.v1` and other Construct output schemas
- SDK patterns: `useGraph()`, `defineModel()`, space manifest fragments
- The Construct persona/voice baked in (eliminates ~400 tokens of base
  system prompt)

### Realistic win sizes

**Cannot bake in** (it's runtime state):
- Project context, CLAUDE.md, memory entries, loaded skills
- The active space's specific action list (varies per space)

So the system prompt doesn't go to zero. It shrinks from ~2000 → ~1600
tokens. That ~400-token savings is mostly already prompt-cached on
frontier providers, so the marginal win is small *for big models*.

**Where the gain is real:**

1. **Reliability on the narrow surface.** Vanilla qwen3-4b picks the
   right space action ~85% of the time in informal testing. A fine-tuned
   model trained on real Construct traces likely hits 95%+. That's the
   difference between "narrow flow is a fun demo" and "narrow flow is
   the default for spaces."
2. **Schema adherence.** Today's `'type' must be a string` LM Studio
   crash exists because llama.cpp's grammar rejects union types. A
   fine-tuned model emits valid Construct schemas *without* a GBNF
   constraint, eliminating the synthetic-tool fallback entirely.
3. **SDK fluency.** Frontier models have never seen
   `@construct-space/sdk` in pretraining. A small model fine-tuned on
   SDK examples + space manifest patterns can write better Construct
   code than Opus does cold, on a narrow surface.
4. **Product asset.** "Construct ships with its own model" is a real
   differentiator. Cursor, Continue.dev, Zed don't.
5. **Trust/branding.** Users trust a model named "Construct Flash" with
   their invoices more than `qwen3-4b-instruct-2507-q4_k_m.gguf`.

### Costs (price these honestly before committing)

- **Training data.** Need a few thousand high-quality `(user message →
  correct tool call → correct response)` examples. Bootstrap by replaying
  real interaction traces through Opus, validating against schema, using
  as the training set. A week+ of focused work, not a weekend.
- **Maintenance.** Every breaking change to SDK, manifest schema, or
  `assistant.v1` requires retraining. Quarterly retraining minimum if
  you iterate on space format.
- **Versioning surface.** Construct Flash v1.2 must match Construct app
  versions X.Y–X.Z. Mismatch → silent regressions. New compatibility
  matrix to maintain.
- **Distribution.** ~2GB at Q4. Bundle (ugly), download on first run
  (better UX, flaky on bad wifi), or require LM Studio (no Flash brand).
  Each option has tradeoffs.
- **Iteration budget.** Tinker credits aren't infinite. Budget for 5–10
  training cycles before a v1.0 ship.

### Experiment plan

1. Ship interaction trace logging (see previous section). Gather at least
   2 weeks of internal usage data across narrow flow scenarios.
2. Run one Tinker job: fine-tune `Qwen3-4B-Instruct-2507` on ~500
   handpicked synthetic examples (replay traces through Opus, validate).
3. Measure tool-selection accuracy vs vanilla qwen3-4b on a held-out
   evaluation set.
4. **Decision gate:** if accuracy jumps from ~85% → ~95%+, commit to a
   Construct Flash v1.0 as a v1.2 milestone. If the jump is marginal
   (<5pp), shelve and spend the engineering time on routing/intents
   instead.
5. If green-lit, build out: real training set (~3k examples), distribution
   pipeline (download-on-first-run with checksum verification), version
   matrix against Construct app versions, telemetry on Flash vs. vanilla
   accuracy.

### Why this is a v2 conversation, not v1

The slot architecture, narrow flow, and intent routing are valuable
*regardless* of whether Construct Flash exists. They make vanilla
qwen3-4b useful. Flash is the **after** that improves the floor —
nothing in v1 should depend on Flash shipping. If Flash never ships, the
flower shop still gets a working free local experience on stock qwen3-4b.

## Experimental isolation

The whole thing ships behind `experimental.slots` (default `false`).

While experimental:

- All new endpoints register under `experimental.run.*` (`experimental.run.small`,
  `experimental.run.image-gen`, etc.).
- Settings page hides the slot section unless the flag is on.
- Today's `agent.run` endpoint is untouched and remains the default for
  everything else.
- New runner code lives in `operator/internal/runner/experimental/` with
  its own tests. `runner_test.go` stays as-is to prove no regression.
- Existing `agentFlow` is the current `runner.go` body lifted verbatim
  into `experimental/agent_flow.go` once promoted. Until then, the
  experimental flag dispatches `run.large` to a copy of the same code.

Graduation criteria (move from `experimental.run.*` to `run.*`):

1. At least one persona end-to-end on local-only (no API keys configured).
2. `chat` + `narrow` + `agent` + `one-shot` flows each have a happy-path
   integration test passing.
3. Settings page can bind and unbind every declared slot.
4. Telemetry shows < 5% slot-resolution errors over a one-week internal use
   period.

When stable, drop the `experimental.` prefix in one commit. Frontend
updates the request-type strings in one place. No flag-flip logic needed
in the operator since the handler registrations remain — the prefix just
goes away.

## Migration order

0. **Interaction trace logging.** Ship first. Cheap, reversible, and the
   dataset it produces unlocks every downstream optimization (slot
   accuracy metrics, A/B testing, Construct Flash fine-tuning). Not
   logging from day one means losing months of real-world data that
   can't be reconstructed.
1. **`ContextTokens` on `ModelMeta`** + classifier for the existing
   registered models. Default unknown → 4096. *Pure additive metadata, no
   behavior change.*
2. **Context-budgeted prompt assembly** on the *existing* `agentFlow`.
   Drops sections in order until the system prompt fits ≤25% of ctx.
   Immediate win for any model with <128k context. *Refactor of one
   assembler, no API change.*
3. **Slot registry + settings storage** (no UI yet). Operator can read
   slot bindings from settings; defaults are empty. *Backend only.*
4. **Settings UI** — dynamic over the slot registry. Renders an empty
   layout when no slots are configured. *Pure frontend work.*
5. **`one-shot` flow + `run.embedding`, `run.image-gen`, `run.voice-stt`,
   `run.voice-tts` endpoints.** Trivial wrappers around provider
   capability methods. *Adds image/voice without touching the agent.*
6. **`chat` flow + `run.small` endpoint.** ~100 LoC, the smallest behavior
   change. AssistantPanel opts in. *First end-user-visible win.*
7. **`narrow` flow + space-assistant runtime opt-in.** The bigger build
   (~250 LoC). Spaces start declaring `minSlot` in their manifests. *The
   workhorse for local-first.*
8. **Intent-based routing in AssistantPanel.** Read `agent.intents` from
   installed spaces, build the keyword/pattern matcher, render the `@`
   menu, wire `ask_agent(spaceId, prompt)`. *Replaces panel-default
   routing with deterministic per-space dispatch.*
9. **Unmatched-input suggestion + picker chip.** Description-similarity
   match against installed-space descriptions; show a chip when ambiguous
   or unmatched. *Closes the routing UX loop without any model call.*
10. **Capability tools wired into `agentFlow`.** `generate_image`,
    `synthesize_speech`, etc. become available to Opus/Sonnet. *Service
    mesh activated.*
11. Promote `experimental.run.*` → `run.*` once graduation criteria pass.

Each step is independently shippable. Steps 1–2 alone fix the
"2000-token prompt on 4k ctx" problem on existing flows without any new
architecture.

## Wire protocol (no changes)

Already in place; documenting for the doc's completeness:

- Operator listens on `127.0.0.1:60100`, newline-delimited JSON over TCP.
- Frontend → `invoke('send_context_request', { requestType, payload })`
  via Tauri IPC bridge (`desktop/src/operator.rs:399`).
- One JSON line per request: `{id, type, client_id, payload}\n`.
- One JSON line per response, correlated by `id`.
- Streaming reuses the same socket via `stream.event` messages, demuxed
  into Tauri events (`stream-event-<id>`).
- Timeout policy by prefix (`operator.rs:328`): `ai.*` / `agents.*` /
  `oauth.*` → 5 min, everything else → 30 s. Long-running endpoints
  (`run.image-gen`, `run.video-gen`) should live under `agents.run.*` or
  the prefix list should be extended.

No new IPC surface. New request types only.

## Open questions

- **`vision` slot ambiguity.** Vision tasks come in two flavors: "answer a
  question about this screenshot" (narrow flow) and "review this UI mockup
  and tell me what's wrong" (agent flow). Two slots — `vision-narrow` and
  `vision-agent` — or one slot that inherits flow from the caller? Lean
  toward inheriting from caller, simpler to bind.
- **Hybrid sessions.** Start a Coder thread on `run.large`, follow-up
  trivial question that could run on `run.small`? Per-message routing
  inside one session is out of scope for v1. Could be revisited if usage
  shows lots of trivial follow-ups in agent sessions.
- **Intent conflicts across spaces.** Two spaces declare `calendar`. The
  v1 tiebreak order (specificity → user-pin → MRU → picker chip) covers
  it without a model call, but the picker UX needs to be quick enough
  that users don't resent it. Settling on the tap target shape is a
  design task, not an architectural one.
- **Pattern compilation cost.** Regex patterns from every installed
  space's manifest get compiled at AssistantPanel boot. Bound it to a
  reasonable cap (say 20 patterns per space, 200 total) and reject
  manifests over budget at install time. Cheaper than letting a bad
  manifest pin a CPU.
- **Slot capability validation.** What if the user binds a vision-capable
  model to `slot:small`? Probably fine — the slot's filter is a minimum,
  not a maximum. But should the UI warn about wasted capability? Defer.
- **Local model context inference.** LM Studio's `/v1/models` doesn't
  reliably expose context length. Ollama does via `ollama show`. We need
  one source of truth — probably maintain a manual map for popular
  open-weight families and fall back to 4k for unknown.
- **Cost telemetry.** Show users "this session: 12 local calls (free), 2
  Haiku ($0.001), 0 Opus, $0.001 total" so the savings are visible. Not
  strictly required, but it's the feature that makes the local-first
  story *land* with users who didn't realize what they were paying.

## Non-goals

- Auto-tiering of unknown models by capability probing.
- A "best model on the planet right now" auto-pick mode. The user binds.
- Per-token routing within one model response.
- Multi-modal training/fine-tuning support.
- Cross-machine model orchestration (your iPad sends to your Mac's
  qwen). Cool but unrelated.

## The pitch, one sentence

*Construct lets the user decide which model serves which kind of work,
defaults to local where it makes sense, and falls back to frontier APIs
only when needed — so a flower shop pays nothing and a developer pays
only for the hard parts.*
