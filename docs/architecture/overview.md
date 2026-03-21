# Architecture Overview

## System Diagram

```
┌─────────────────────────────────────────────────────────┐
│  Construct Desktop App (Tauri 2 + Vue 3)                │
│                                                         │
│  ┌──────┐  ┌──────────────────────────────────────────┐ │
│  │      │  │  Shell                                   │ │
│  │  3D  │  │  ┌────────────────────────────────────┐  │ │
│  │ Side │  │  │  Toolbar3D (breadcrumb + actions)  │  │ │
│  │ bar  │  │  ├────────────────────────────────────┤  │ │
│  │      │  │  │                                    │  │ │
│  │ ┌──┐ │  │  │  Space Content                     │  │ │
│  │ │  │ │  │  │  (dynamic page from active space)  │  │ │
│  │ │  │ │  │  │                                    │  │ │
│  │ └──┘ │  │  │                                    │  │ │
│  │      │  │  └────────────────────────────────────┘  │ │
│  └──────┘  └──────────────────────────────────────────┘ │
│                                                         │
│  ┌─────────────────┐  ┌──────────────────────────────┐  │
│  │ AssistantPanel   │  │  Stores (Pinia)              │  │
│  │ (AgentView +     │  │  auth, project, settings,    │  │
│  │  ToolCard blocks)│  │  panels, preferences, pinned │  │
│  └─────────────────┘  └──────────────────────────────┘  │
└───────────────┬─────────────────────────────────────────┘
                │ TCP :60100 (newline-delimited JSON)
┌───────────────▼─────────────────────────────────────────┐
│  Construct Operator (Go sidecar)                        │
│                                                         │
│  ┌─────────┐  ┌──────┐  ┌───────┐  ┌────────────────┐  │
│  │ Agents  │  │Tools │  │Skills │  │ Providers      │  │
│  │ 10+     │  │ 22+  │  │ 4+    │  │ Anthropic      │  │
│  │ per-    │  │built │  │prompt │  │ OpenAI (Codex) │  │
│  │ space   │  │-in + │  │templ  │  │ DeepSeek       │  │
│  │         │  │space │  │ates   │  │ Ollama (local) │  │
│  └─────────┘  └──────┘  └───────┘  └────────────────┘  │
│                                                         │
│  ┌───────────┐  ┌──────────┐  ┌────────────────────┐   │
│  │ Sessions  │  │ Hooks    │  │ MCP Protocol       │   │
│  │ JSON      │  │ pre/post │  │ external tools     │   │
│  │ persist   │  │ safety   │  │ discovery          │   │
│  └───────────┘  └──────────┘  └────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

## Key Concepts

### Spaces

A Space is a self-contained module that plugs into the Construct shell. Each space has:

- `space.manifest.json` — identity, pages, toolbar, theme, navigation
- `space.config.ts` — typed TypeScript config
- `pages/` — route components
- `components/` — space-specific UI
- `composables/` — shared logic
- `stores/` — state management
- `agent/` — AI config, tools, skills, hooks

Spaces teleport their content into the shell:
- **Sidebar icon** → from `navigation` in manifest
- **Toolbar actions** → from `pages[].toolbar` in manifest
- **Page content** → rendered in the main area

### Operator

Go sidecar binary that powers AI intelligence. Runs locally on `:60100`.

- **Agents** — each space can have its own agent (defined in `agent/config.md`)
- **Tools** — builtins (bash, read/write/edit, glob, grep) + space tools + MCP tools
- **Providers** — Anthropic (Claude Code auth), OpenAI (Codex auth), DeepSeek, Ollama
- **Sessions** — persisted as JSON in `~/Library/Application Support/`
- **Hooks** — pre/post tool execution safety checks
- **Skills** — reusable prompt templates triggered by keywords

### Agent View (Block Model)

The AI assistant uses a block-based rendering model:

```
Turn = Request + Response

RequestBlock  = text | image | file
ResponseBlock = text | tool | code | svg | image | error

ToolCard = collapsible card showing tool name, input, result, state
```

`useAgentSession` composable parses operator stream events into blocks in real-time. `AgentView` renders turns. `AssistantPanel` is a thin wrapper.

### 3D Shell

The sidebar and toolbar use CSS 3D transforms:

- **Sidebar3D** — rotateY cube. Front: main nav. Right face (-90deg): space sub-pages
- **Toolbar3D** — rotateX cube. Front: current breadcrumb. Bottom face: next page transition

## Data Flow

```
User input
  → useAgentSession.send(blocks)
    → operator.dispatchStream(agentId, task)
      → Operator selects agent + provider
        → LLM API call with tools
          → Stream events back
            → handleStreamChunk() → ResponseBlocks
              → AgentView renders in real-time
```

## File Structure

```
src/
  operator/           # Operator client + composables
    client.ts         # useOperator — TCP connection, dispatch, stream
    useAgentSession.ts # Block-based session (Turn/RequestBlock/ResponseBlock)
    useAssistant.ts   # Legacy assistant (visibility, backward compat)
    useStreamStatus.ts # Stream event → human-readable status
    streamEvents.ts   # Event type constants
    types.ts          # Protocol types

  components/
    agent/            # Block-based rendering
      AgentView.vue   # Turn list renderer
      AgentInput.vue  # Text + drag-drop input
      RequestBubble.vue
      ResponseBlocks.vue
      ToolCard.vue    # Collapsible tool call card
    ai/
      AssistantPanel.vue  # Header + AgentView + AgentInput
    common/
      Sidebar3D.vue   # 3D rotating sidebar
      Toolbar3D.vue   # 3D rotating toolbar
    ui/               # 29 UI components (Button, Modal, etc.)

  spaces/             # Built-in spaces
    vibe/             # Autonomous coding (Matrix-themed)
    architect/        # Project planning (interview flow)
    project/          # Project management

  stores/             # Pinia stores
  composables/        # 50+ composables
  pages/              # Top-level routes
  layouts/            # DefaultLayout, ProjectLayout
```
