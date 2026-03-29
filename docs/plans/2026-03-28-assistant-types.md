# Assistant Types Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce a first-class `assistantType` layer so Construct can support different assistant behaviors like Architect interview/docs flow, Brainstorm chat, General routed assistant, and Coder execution — and let spaces define their own assistant types and renderers where needed. All types use the same operator backend request path.

**Architecture:** `assistantType` is a frontend-level workflow and output contract, not a backend agent ID. Each type defines entry agent, session policy, renderer mode, expected final schema, and context requirements. The frontend sends a single operator request path (`agents.dispatch_stream` / `agents.dispatch`) with optional metadata like `assistant_type`, `active_context`, `project_path`, `session_id`, and `output_schema`; the backend remains one system and chooses behavior from agent config plus metadata. When the selected model supports native structured output, the operator can request schema-constrained output; when it does not, the same contract falls back to prompt guidance plus frontend/backend normalization. General and Brainstorm use block/chat rendering, Architect uses an interview/docs workflow contract, and Coder keeps its execution timeline contract.

**Tech Stack:** Vue 3, TypeScript, Zod, Construct operator (Go), existing stream event protocol

---

## Design Rules

1. `assistantType` and `agentId` are different things.
   - `assistantType` = UX contract (how it renders, session policy, schema)
   - `agentId` = backend worker or router entrypoint

2. Not every agent needs an assistant type.
   - `project`, `todo`, `design`, and future `space:*` routes are context, not assistant types
   - General can still route to those agents through context-aware backend behavior
   - A space defines an assistant type only when it needs a distinct UX contract

3. Keep one backend request path.
   - No `architect.dispatch_stream`, `coder.dispatch_stream`, etc.
   - Keep `agents.dispatch_stream` and `agents.dispatch`

4. Make schema expectations explicit.
   - Free-form markdown is acceptable for chat types
   - Guided workflows like Architect should use typed structured output contracts instead of prompt-only “JSON please”
   - In v1, model-level structured-output schemas are builtin-only; space-defined types can add display-time normalizers but not backend-enforced schemas

5. Preserve specialized experiences where they matter.
   - Coder should keep its current tool-first execution timeline
   - Architect should keep question flow and docs handoff
   - General should stay lightweight and routed

6. The registry is dynamic, not static.
   - Builtins are registered at boot
   - Spaces can declare assistant types that are loaded alongside tools/skills/hooks
   - Same extensibility pattern used everywhere in the operator

7. Structured output is capability-gated, not universal.
   - OpenAI, Anthropic, and Gemini support native structured output only on some models, not all of them
   - The operator must check model capabilities before using native schema-constrained output
   - Every assistant contract needs a non-structured fallback path for unsupported models, refusals, and truncation

## Target Assistant Types

### 1. `general`

- Entry agent: `general`
- Purpose: main AssistantPanel, context-aware router
- Renderer: block chat
- Final schema: `assistant.v1`
- Session scope: global assistant session
- Context policy: uses active route/project as routing context

### 2. `brainstorm`

- Entry agent: `brainstorm`
- Purpose: open-ended ideation and planning
- Renderer: block chat
- Final schema: `assistant.v1`
- Session scope: persisted per assistant type
- Context policy: optional project context, no strict requirement

### 3. `architect`

- Entry agent: `architect`
- Purpose: guided interview, architecture docs generation, handoff to project/coder
- Renderer: block chat plus workflow actions
- Final schema: `architect.v1`
- Session scope: per project when project exists, otherwise standalone working session
- Context policy: project-aware, supports “new project” and “existing project” modes

### 4. `coder`

- Entry agent: `coder`
- Purpose: execution-heavy code work with tools and iterative session resume
- Renderer: execution timeline
- Final schema: optional `coder-summary.v1` for final summaries only
- Session scope: project-bound persistent runner session
- Context policy: project path strongly preferred

## Proposed Frontend Shape

### Architecture: Spaces Own Assistant Contracts

The assistant contract lives **inside the space**, not in a separate directory. `frontend/assistant/` is the registry and loader layer (like `frontend/space_loader/` is for spaces). Each space that needs a distinct UX contract adds an `assistant/` subdirectory with its config, normalizer, and optional custom block types.

**Ownership boundaries:**
- `frontend/operator/` — transport only (TCP client, stream events)
- `frontend/assistant/` — registry, loader, shared block types, normalizer dispatch
- `frontend/spaces/*/assistant/` — per-space assistant type contract (config, normalizer, schema, custom blocks)
- `frontend/spaces/*/components/` — per-space custom block renderers (Vue)
- `frontend/components/agent/` — shared block renderers (Vue)

### File Structure

```
frontend/
├── assistant/                         # Registry + loader (like space_loader/)
│   ├── types.ts                       # AssistantTypeConfig, NormalizerFn
│   ├── registry.ts                    # register/get/list + general builtin
│   ├── loader.ts                      # Load assistant configs from spaces
│   ├── blocks.ts                      # Shared block types (existing)
│   ├── schema.ts                      # Base envelope schema (existing)
│   ├── normalize.ts                   # Dispatch to per-type normalizer
│   └── index.ts
│
├── spaces/
│   ├── architect/
│   │   ├── assistant/                 # Assistant type contract
│   │   │   ├── config.ts             # { renderMode: 'blocks', finalSchema: 'architect.v1' }
│   │   │   ├── normalizer.ts         # architect.v1 → shared + custom blocks
│   │   │   ├── blocks.ts            # Custom block types (architect:questions, architect:plan)
│   │   │   ├── schema.ts            # Zod schema for architect.v1
│   │   │   └── index.ts
│   │   ├── components/
│   │   │   ├── QuestionsBlock.vue    # Renders architect:questions
│   │   │   └── PlanBlock.vue         # Renders architect:plan
│   │   ├── pages/
│   │   ├── agent/                     # Backend agent config (existing)
│   │   └── manifest.json
│   │
│   ├── coder/
│   │   ├── assistant/
│   │   │   ├── config.ts             # { renderMode: 'timeline', sessionScope: 'project' }
│   │   │   ├── normalizer.ts         # Tool output → timeline blocks
│   │   │   └── index.ts
│   │   ├── components/
│   │   ├── composables/
│   │   ├── pages/
│   │   └── agent/
│   │
│   ├── brainstorm/
│   │   ├── assistant/
│   │   │   ├── config.ts
│   │   │   ├── normalizer.ts
│   │   │   └── index.ts
│   │   └── pages/
│   │
│   ├── project/                       # No assistant/ — uses general type
│   └── ...
```

### Core Types

```ts
// assistant/types.ts

export type AssistantTypeId = string
export type BuiltinAssistantTypeId = 'general' | 'brainstorm' | 'architect' | 'coder'

export type NormalizerFn = (raw: unknown) => Block[]

// CustomBlock is the escape hatch for space-defined blocks.
// The `type` field uses a namespace convention: "spaceId:blockType".
// ResponseBlocks.vue resolves the renderer from the space's component registry.
export interface CustomBlock {
  type: `${string}:${string}`  // e.g. "architect:questions", "coder:diff-preview"
  data: Record<string, unknown>
}

// ResponseBlock is widened to include CustomBlock so Turn.response
// remains type-safe while accepting space-defined blocks.
// (blocks.ts must add CustomBlock to its ResponseBlock union)

export interface AssistantTypeConfig {
  id: AssistantTypeId
  label: string
  entryAgent: string
  renderMode: 'blocks' | 'timeline' | 'custom'
  customRenderer?: string
  finalSchema: string | null
  sessionScope: 'global' | 'assistant' | 'project'
  supportsAttachments: boolean
  requiresProjectPath: boolean
  usesPriorityRouting: boolean
  source: 'builtin' | `space:${string}`
  normalizer?: NormalizerFn           // per-type LLM output → blocks
}
```

### Dynamic Registry

```ts
// assistant/registry.ts

const registry = new Map<string, AssistantTypeConfig>()

export function registerAssistantType(config: AssistantTypeConfig) {
  registry.set(config.id, config)
}

export function getAssistantType(id: string): AssistantTypeConfig | undefined {
  return registry.get(id)
}

export function listAssistantTypes(): AssistantTypeConfig[] {
  return [...registry.values()]
}

export function unregisterAssistantTypesBySource(source: AssistantTypeConfig['source']) {
  for (const [id, config] of registry.entries()) {
    if (config.source === source) registry.delete(id)
  }
}

// General is the only builtin without a space — registered here
registerAssistantType({
  id: 'general',
  label: 'General',
  entryAgent: 'general',
  renderMode: 'blocks',
  finalSchema: 'assistant.v1',
  sessionScope: 'global',
  supportsAttachments: true,
  requiresProjectPath: false,
  usesPriorityRouting: true,
  source: 'builtin',
})
```

### Normalizer Dispatch

```ts
// assistant/normalize.ts

export function normalize(assistantType: string, raw: unknown): Block[] {
  const config = getAssistantType(assistantType)
  if (config?.normalizer) {
    return config.normalizer(raw)
  }
  return defaultNormalize(raw)  // existing shared logic
}
```

Each space's `assistant/index.ts` exports the normalizer alongside config. The loader registers both into the registry.

### Block Resolution (Hybrid Model)

Blocks use a **namespace convention**: shared blocks have plain type names (`text`, `code`, `tasklist`), custom blocks are namespaced (`architect:questions`, `architect:plan`).

```ts
// components/agent/ResponseBlocks.vue

function resolveBlockComponent(block: Block) {
  if (block.type.includes(':')) {
    // Namespaced: "architect:questions" → space "architect", component "QuestionsBlock"
    const [spaceId, blockType] = block.type.split(':')
    return getSpaceComponent(spaceId, `${capitalize(blockType)}Block`)
  }
  return sharedRenderers[block.type]  // shared component
}
```

**Rules:**
- Normalizers map to shared blocks where possible (`TextBlock`, `CodeBlock`, `TaskListBlock`)
- Custom blocks only when the shared set isn't expressive enough
- Custom block renderers live in the space's `components/` directory
- Session persistence round-trips through the fixed chat session fields (`content`, `tool`, `title`, `callId`, `message`). Custom blocks must serialize their `data` into the `content` field as JSON. On reload, the renderer re-parses `content` using the namespaced `type` to know which space component to load. See [persistence constraint](#custom-renderers) for details.

### Space-Defined Assistant Types

A space declares an assistant type by adding an `assistant/` subdirectory with at minimum a `config.ts`. The space loader (`assistant/loader.ts`) scans core spaces at boot and calls `registerAssistantType()` for each.

Marketplace/dynamic spaces declare the assistant type in their `manifest.json`:

```json
{
  "assistant": {
    "id": "devops",
    "label": "DevOps",
    "renderMode": "blocks",
    "sessionScope": "project",
    "requiresProjectPath": true
  }
}
```

Defaults: `id` = space ID, `entryAgent` = `space:<spaceId>`, `renderMode` = `blocks`, `sessionScope` = `assistant`, `source` = `space:<spaceId>`.

## Proposed Backend Metadata

This is the minimal backend-aware addition. The backend stays unified.

**Files:**
- Modify: `frontend/operator/client.ts`
- Modify: `frontend/operator/types.ts`
- Modify: `operator/internal/ai/module.go`
- Modify: `operator/internal/runner/runner.go`
- Modify: `operator/internal/session/session.go`

### Request Metadata

```ts
interface AssistantRequestContext {
  assistant_type?: string   // any registered type: builtin or space-defined
  active_context?: string
  project_path?: string
  session_id?: string
  output_schema?: string    // v1: builtin contract key only ('assistant.v1', 'architect.v1', 'coder-summary.v1')
}
```

### Why this matters

- Operator logs become understandable by workflow, not just agent
- Prompts can branch safely by workflow where needed
- Structured outputs become explicit instead of hidden in prompt prose
- Session restore can key on workflow + project instead of ad hoc component rules

### Provider / Model Compatibility

The assistant-type contract must work across OpenAI, Anthropic, Gemini, and future providers, but native structured output is model-specific. Construct already exposes per-model capabilities in provider metadata (`capabilities`, including `structured`) through `providers.list`.

The implementation rule is:

- `assistant_type` is always forwarded
- `output_schema` is a requested contract, not a guarantee
- the operator enables native structured output only when the selected model advertises `structured`
- if the model does not support it, the operator falls back to normal prompting and the frontend/backend normalizers still produce the same assistant blocks
- refusals, token truncation, and provider-specific failures must also fall back cleanly

This keeps the architecture provider-agnostic while still taking advantage of model-native schema enforcement when available.

## Architect Contract

This is the most important non-chat type because it is currently prompt-driven and fragile.

**Current reality:**
- [`frontend/spaces/architect/agent/config.md`](/Users/flakerim/Construct/construct-app/frontend/spaces/architect/agent/config.md) tells the model to emit raw JSON
- [`frontend/spaces/architect/pages/ArchitectPage.vue`](/Users/flakerim/Construct/construct-app/frontend/spaces/architect/pages/ArchitectPage.vue) now uses generic block sessions
- [`frontend/operator/useArchitect.ts`](/Users/flakerim/Construct/construct-app/frontend/operator/useArchitect.ts) is older parallel logic and should not remain a second architect client

### `architect.v1` should model workflow states directly

```ts
type ArchitectEnvelope =
  | {
      version: 'architect.v1'
      state: 'questions'
      questions: Array<{
        id: string
        question: string
        type: 'single' | 'multi'
        options: Array<{ value: string; label: string; description?: string; icon?: string }>
      }>
    }
  | {
      version: 'architect.v1'
      state: 'plan'
      title: string
      summary: string
      decisions: Array<{ label: string; value: string }>
      docs: Array<{ path: string; title: string }>
      next_actions: Array<{ id: string; label: string }>
    }
  | {
      version: 'architect.v1'
      state: 'progress'
      message: string
    }
```

### Architect rendering rule

- Render `questions` as interactive question blocks
- Render `plan` as a plan block + doc links + action buttons
- Render `progress` during doc generation / handoff
- Keep markdown fallback only as a resilience path, not the primary contract

## Space-Defined Assistant Types

### How It Works

The **frontend owns assistant type discovery**, not the operator. This matches how spaces are currently loaded: the frontend space loader reads manifests and executes bundles (`SpaceLoader.ts`), while the operator only handles agent/tools/hooks/skills. Adding a second discovery path through the operator would create drift between the two registries.

1. **Space declares it** — an `assistant` field in the space manifest (`manifest.json`), alongside existing `pages`, `components`, `agent` fields
2. **Frontend space loader reads it early** — `SpaceLoader.ts` already parses manifests before bundle execution; it now calls `registerAssistantType()` for any declared assistant config as soon as the manifest is read
3. **Backend carries metadata only** — the operator receives `assistant_type` in request payloads and passes it through to the runner/session, but does not discover or register assistant types itself

### Space Manifest Config

The assistant type is declared as an `assistant` field in the space's `manifest.json`, alongside existing `pages`, `components`, `agent` fields:

```json
{
  "id": "devops",
  "name": "DevOps Space",
  "pages": [...],
  "agent": { ... },
  "assistant": {
    "id": "devops",
    "label": "DevOps Assistant",
    "renderMode": "blocks",
    "sessionScope": "project",
    "requiresProjectPath": true
  }
}
```

Most fields have sensible defaults, so a minimal declaration works:

```json
{
  "assistant": {
    "label": "DevOps"
  }
}
```

Defaults: `id` = space ID, `entryAgent` = `space:<spaceId>`, `renderMode` = `blocks`, `sessionScope` = `assistant`, `source` = `space:<spaceId>`.

### Custom Renderers

A space that needs a non-standard UI can ship a Vue component and declare `renderMode: "custom"`:

```json
{
  "id": "kanban",
  "label": "Kanban Board",
  "renderMode": "custom",
  "customRenderer": "KanbanRenderer"
}
```

The frontend looks up the component by name in the space's registered components. The renderer receives the same stream events as blocks/timeline and decides how to display them.

**Persistence constraint:** Custom renderers must serialize their state into the existing chat session block model (`chatsession/store.go`). The saved format uses fixed fields (`content`, `tool`, `title`, `callId`, `message`). A custom renderer can display live data however it wants, but on save/load it must round-trip through the block subset. In practice this means:

- Custom renderers should store essential state in the `content` field (as JSON or markdown)
- On reload, the renderer re-parses `content` to reconstruct its custom view
- If a space needs richer persistence, the space can use the `storage.*` API to store auxiliary data keyed by session ID

Redesigning session persistence for arbitrary payloads is out of scope for v1.

### Contract Schemas

**v1 scope:** Structured-output schemas are limited to builtins only (`assistant.v1`, `architect.v1`, `coder-summary.v1`). The operator needs the schema definition at model-call time to use structured output APIs, and building a backend schema registry for arbitrary space-defined schemas is out of scope for v1.

Space-defined types use `finalSchema: null` and render from free-form markdown or stream events. A space can still add frontend-only Zod validators for response normalization, but these are display-time helpers, not model-call constraints:

```ts
// Frontend-only: parse model output into typed blocks for display
registerDisplayNormalizer('devops.v1', devopsNormalizer)
```

**Future:** If spaces need structured-output enforcement at the model level, the operator would need a schema registry where spaces ship machine-readable schemas (JSON Schema) that the runner can pass to provider APIs. That's a separate plan.

## Migration Strategy

### Task 1: Introduce `assistantType` Registry and Space Assistant Contracts

**Files:**
- Create: `frontend/assistant/types.ts`
- Create: `frontend/assistant/registry.ts`
- Modify: `frontend/assistant/blocks.ts` — add `CustomBlock` type and widen `ResponseBlock` union
- Create: `frontend/spaces/coder/assistant/config.ts`
- Create: `frontend/spaces/coder/assistant/index.ts`
- Create: `frontend/spaces/architect/assistant/config.ts`
- Create: `frontend/spaces/architect/assistant/index.ts`
- Create: `frontend/spaces/brainstorm/assistant/config.ts`
- Create: `frontend/spaces/brainstorm/assistant/index.ts`
- Modify: `frontend/assistant/index.ts`
- Test: `frontend/assistant/registry.test.ts`

The `blocks.ts` change is critical: add `CustomBlock` to the `ResponseBlock` union so `Turn.response` stays type-safe while accepting namespaced space-defined blocks:

```ts
// blocks.ts addition
export interface CustomBlock {
  type: `${string}:${string}`
  data: Record<string, unknown>
}

export type ResponseBlock =
  | TextBlock
  | ToolBlock
  // ... existing types ...
  | DiffBlock
  | CustomBlock  // <-- widened
```

- [ ] **Step 1: Write the failing registry test**

```ts
it('registers and retrieves builtin assistant types', () => {
  expect(getAssistantType('general')?.entryAgent).toBe('general')
  expect(getAssistantType('architect')?.renderMode).toBe('blocks')
  expect(getAssistantType('coder')?.renderMode).toBe('timeline')
})

it('registers space-defined types dynamically', () => {
  registerAssistantType({
    id: 'devops', label: 'DevOps', entryAgent: 'space:devops',
    renderMode: 'blocks', finalSchema: null, sessionScope: 'project',
    supportsAttachments: false, requiresProjectPath: true,
    usesPriorityRouting: false, source: 'space:devops',
  })
  expect(getAssistantType('devops')?.source).toBe('space:devops')
  expect(listAssistantTypes().length).toBeGreaterThan(4)
})

it('unregisters all types from a space source on reload or uninstall', () => {
  registerAssistantType({
    id: 'devops', label: 'DevOps', entryAgent: 'space:devops',
    renderMode: 'blocks', finalSchema: null, sessionScope: 'project',
    supportsAttachments: false, requiresProjectPath: true,
    usesPriorityRouting: false, source: 'space:devops',
  })
  unregisterAssistantTypesBySource('space:devops')
  expect(getAssistantType('devops')).toBeUndefined()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test frontend/assistant/registry.test.ts`
Expected: FAIL because registry does not exist yet

- [ ] **Step 3: Implement dynamic registry**

```ts
const registry = new Map<string, AssistantTypeConfig>()
export function registerAssistantType(config: AssistantTypeConfig) { ... }
export function getAssistantType(id: string) { ... }
export function listAssistantTypes() { ... }
export function unregisterAssistantTypesBySource(source: AssistantTypeConfig['source']) { ... }
// Register builtins at module load
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test frontend/assistant/registry.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

### Task 2: Route Existing Screens Through Assistant Types

**Files:**
- Modify: `frontend/components/ai/AssistantPanel.vue`
- Modify: `frontend/spaces/brainstorm/pages/BrainstormPage.vue`
- Modify: `frontend/spaces/architect/pages/ArchitectPage.vue`
- Modify: `frontend/spaces/coder/composables/useCoder.ts`
- Create: `frontend/assistant/runtime.ts`
- Test: `frontend/assistant/runtime.test.ts`

- [ ] **Step 1: Write the failing runtime resolution test**

```ts
it('maps surfaces to assistant types', () => {
  expect(resolveAssistantType({ surface: 'assistant-panel' })).toBe('general')
  expect(resolveAssistantType({ surface: 'architect-page' })).toBe('architect')
  expect(resolveAssistantType({ surface: 'coder-page' })).toBe('coder')
  expect(resolveAssistantType({ surface: 'brainstorm-page' })).toBe('brainstorm')
})
```

- [ ] **Step 2: Run test — expected FAIL**
- [ ] **Step 3: Implement runtime resolver + update pages to pass `assistantType`**
- [ ] **Step 4: Run tests — expected PASS**
- [ ] **Step 5: Commit**

### Task 3: Add Backend Request Metadata for Assistant Types

**Files:**
- Modify: `frontend/operator/client.ts`
- Modify: `frontend/operator/types.ts`
- Modify: `frontend/operator/useAgentSession.ts`
- Modify: `operator/internal/ai/module.go`
- Modify: `operator/internal/runner/runner.go`
- Test: `frontend/operator/client.test.ts`
- Test: `operator/internal/runner/runner_test.go`

- [ ] **Step 1: Write failing test** — verify `assistant_type` and `output_schema` are forwarded in dispatch payload
- [ ] **Step 2: Run test — expected FAIL**
- [ ] **Step 3: Add optional `assistantType` / `outputSchema` to frontend dispatch helpers**
- [ ] **Step 4: Parse metadata in operator dispatch handler, store in runner context, and gate native structured output by model capabilities**
- [ ] **Step 5: If the selected model lacks `structured`, ignore native schema mode and rely on prompt + normalizer fallback**
- [ ] **Step 6: Run tests — expected PASS**
- [ ] **Step 7: Commit**

### Task 4: Add Typed Architect Output Contract

**Files:**
- Create: `frontend/spaces/architect/assistant/schema.ts` — Zod schema for architect.v1
- Create: `frontend/spaces/architect/assistant/normalizer.ts` — architect.v1 → blocks
- Create: `frontend/spaces/architect/assistant/blocks.ts` — custom block types (architect:questions, architect:plan)
- Create: `frontend/spaces/architect/components/QuestionsBlock.vue`
- Create: `frontend/spaces/architect/components/PlanBlock.vue`
- Modify: `frontend/spaces/architect/assistant/config.ts` — set normalizer
- Modify: `frontend/assistant/normalize.ts` — dispatch to per-type normalizer
- Modify: `frontend/components/agent/ResponseBlocks.vue` — resolve namespaced blocks
- Modify: `frontend/spaces/architect/pages/ArchitectPage.vue`
- Modify: `frontend/spaces/architect/agent/config.md`
- Test: `frontend/spaces/architect/assistant/normalizer.test.ts`

- [ ] **Step 1: Write failing test** — verify `architect.v1` questions normalize into `architect:questions` blocks
- [ ] **Step 2: Run test — expected FAIL**
- [ ] **Step 3: Implement architect Zod schema + normalizer** — maps to shared blocks where possible, emits `architect:questions` and `architect:plan` custom blocks where needed
- [ ] **Step 4: Add custom block renderers** — `QuestionsBlock.vue` and `PlanBlock.vue` in `spaces/architect/components/`
- [ ] **Step 5: Register core-space components** — `coreSpaces.ts` currently does not expose components from builtin spaces. Add a `blockRenderers` map to the core space entry so `ResponseBlocks.vue` can resolve `architect:questions` → `QuestionsBlock`. Dynamic spaces already expose components via `SpaceLoader.ts` (line 248); core spaces need the same path.
- [ ] **Step 6: Wire `ResponseBlocks.vue`** — resolve namespaced blocks: check core-space block renderer registry first, then fall back to dynamic space component lookup
- [ ] **Step 7: Update architect prompt** — request `architect.v1` payloads explicitly when native structured output is available, with markdown/JSON fallback instructions otherwise
- [ ] **Step 8: Run tests — expected PASS**
- [ ] **Step 9: Commit**

### Task 5: Remove Legacy Parallel Assistant Paths

**Files:**
- Delete: `frontend/operator/useArchitect.ts`
- Modify: `frontend/types/assistant.ts`
- Modify: `frontend/types/architect.ts`
- Test: `bun run test && bun run typecheck`

- [ ] **Step 1: Identify live imports** — `rg -n "useArchitect|types/assistant|types/architect" frontend`
- [ ] **Step 2: Delete dead composable, move surviving types to `frontend/assistant/`**
- [ ] **Step 3: Run tests and typecheck — expected PASS**
- [ ] **Step 4: Commit**

### Task 6: Space-Defined Assistant Types

**Files:**
- Modify: `frontend/space_loader/SpaceLoader.ts` — read `assistant` field from space manifest
- Create: `frontend/assistant/loader.ts` — register space-defined types from loaded manifests
- Modify: `frontend/assistant/registry.ts` — call loader during space init
- Test: `frontend/assistant/loader.test.ts`

Note: The operator does NOT own assistant type discovery. The frontend space loader (`SpaceLoader.ts`) already reads `manifest.json` before bundle execution. It should register the optional `assistant` field immediately after manifest parse so route-based assistant surfaces can resolve the type on first paint, without waiting for the space page to mount.

- [ ] **Step 1: Write the failing space assistant loading test**

```ts
it('loads assistant type from space manifest', () => {
  const types = loadSpaceAssistantTypes([
    { id: 'devops', manifest: { assistant: { id: 'devops', label: 'DevOps' } } },
  ])
  expect(types[0].id).toBe('devops')
  expect(types[0].entryAgent).toBe('space:devops')
  expect(types[0].source).toBe('space:devops')
})
```

- [ ] **Step 2: Run test — expected FAIL**

- [ ] **Step 3: Implement frontend loader**

```ts
// frontend/assistant/loader.ts
export function loadSpaceAssistantTypes(spaces: LoadedSpace[]) {
  for (const space of spaces) {
    if (!space.manifest.assistant) continue
    const config = space.manifest.assistant
    registerAssistantType({
      id: config.id || space.id,
      label: config.label || space.id,
      entryAgent: config.entryAgent || `space:${space.id}`,
      renderMode: config.renderMode || 'blocks',
      finalSchema: null,  // v1: space types don't get structured output
      sessionScope: config.sessionScope || 'assistant',
      supportsAttachments: config.supportsAttachments ?? false,
      requiresProjectPath: config.requiresProjectPath ?? false,
      usesPriorityRouting: false,
      source: `space:${space.id}`,
      customRenderer: config.customRenderer,
    })
  }
}
```

- [ ] **Step 4: Hook into SpaceLoader early** — register assistant types immediately after manifest parse, and `unregisterAssistantTypesBySource()` before re-registering on reload
- [ ] **Step 5: Run tests — expected PASS**
- [ ] **Step 6: Commit**

```bash
git commit -m "feat: support space-defined assistant types"
```

### Task 7: Custom Renderers for Space Assistant Types

**Files:**
- Modify: `frontend/assistant/types.ts` — add `customRenderer` field
- Create: `frontend/assistant/AssistantRenderer.vue` — shared assistant host that resolves `blocks`, `timeline`, or custom renderers
- Modify: `frontend/components/ai/AssistantPanel.vue` — delegate rendering to the shared assistant host
- Modify: `frontend/spaces/architect/pages/ArchitectPage.vue` — keep using shared host where it makes sense
- Create: `frontend/assistant/renderers.ts` — renderer registry
- Test: `frontend/assistant/renderers.test.ts`

- [ ] **Step 1: Write the failing renderer resolution test**

```ts
it('resolves custom renderer component for space-defined type', () => {
  registerAssistantType({ id: 'kanban', renderMode: 'custom', customRenderer: 'KanbanRenderer', ... })
  expect(resolveRenderer('kanban')).toBe('KanbanRenderer')
  expect(resolveRenderer('general')).toBe('BlockRenderer')
})
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement renderer registry**

- Map `renderMode` → Vue component
- `blocks` → `BlockRenderer`, `timeline` → `TimelineRenderer`, `custom` → lookup `customRenderer`
- `AssistantRenderer.vue` uses `<component :is="resolveRenderer(assistantType)" />`
- `AssistantPanel.vue` and any future assistant surface reuse `AssistantRenderer.vue` instead of embedding custom-renderer logic directly

- [ ] **Step 4: Run tests**

Run: `bun test frontend/assistant/renderers.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: support custom renderers for space assistant types"
```

## Expected Outcome

After this plan:
- every assistant surface declares a stable `assistantType`
- all assistant surfaces still use the same backend request path
- routing context and workflow intent are explicit in the request
- Architect no longer relies on brittle prompt-only JSON parsing
- Coder keeps its specialized execution UX without becoming a special backend protocol
- spaces can define their own assistant types and custom renderers
- builtin contracts (`assistant.v1`, `architect.v1`, `coder-summary.v1`) work across providers, with native structured output used opportunistically when the model supports it
- adding a new space assistant type = drop assistant config into the space manifest + optionally ship a renderer component

## Non-Goals

- Do not make one assistant type for every `space:*` agent — only when a distinct UX is needed
- Do not create multiple backend endpoints per assistant workflow
- Do not force Coder into the generic chat block renderer
- Do not rewrite every agent prompt in one pass
- Do not require spaces to define an assistant type — most spaces work fine with `general`
- Do not assume every model supports native structured output
