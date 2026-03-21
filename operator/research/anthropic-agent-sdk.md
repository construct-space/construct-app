# Anthropic Claude Agent SDK -- Architecture Research

> Research date: 2026-03-13
> Package: `claude-agent-sdk` (Python) / `@anthropic-ai/claude-agent-sdk` (TypeScript)
> Docs: https://platform.claude.com/docs/en/agent-sdk/overview
> Replaces deprecated: `claude-code-sdk` / `@anthropic-ai/claude-code-sdk`

---

## 1. The `query()` Function -- Core Architecture

The `query()` function is the single entry point for running an autonomous agent. It returns an **async iterator** of typed messages, handling the entire agent loop internally. You consume a stream; the SDK handles tool orchestration, retries, context management, and cost tracking.

### Signature

```python
# Python
async for message in query(
    prompt="Fix the bug in auth.py",
    options=ClaudeAgentOptions(
        allowed_tools=["Read", "Edit", "Bash"],
        permission_mode="acceptEdits",
        max_turns=30,
        max_budget_usd=5.0,
        system_prompt="You are a senior engineer.",
        model="claude-sonnet-4-6",
        effort="high",
        setting_sources=["project"],  # Load CLAUDE.md, skills, hooks
    ),
):
    ...
```

```typescript
// TypeScript
for await (const message of query({
  prompt: "Fix the bug in auth.py",
  options: {
    allowedTools: ["Read", "Edit", "Bash"],
    permissionMode: "acceptEdits",
    maxTurns: 30,
    maxBudgetUsd: 5.0,
    systemPrompt: "You are a senior engineer.",
    model: "claude-sonnet-4-6",
    effort: "high",
    settingSources: ["project"],
  }
})) { ... }
```

### Key Design Decisions

1. **Async iterator, not callback**: The consumer pulls messages at their own pace. No event emitter pattern. This maps cleanly to `async for` / `for await`.

2. **Single function, not a class hierarchy**: `query()` is the only public entry point. No `Agent` class, no `Runner` class. The SDK wraps the entire Claude Code engine as a subprocess (it spawns the Claude Code binary internally).

3. **Options bag pattern**: A single `ClaudeAgentOptions` / `Options` object carries all configuration. This is extensible without breaking API.

4. **Streaming by default**: Messages arrive as the agent works. For batch processing, you collect all messages into a list.

5. **`ClaudeSDKClient`** (Python only): An alternative to standalone `query()` that holds session state across multiple `client.query()` / `client.receive_response()` calls. Used for multi-turn conversations within a single process.

### Message Types (5 Core Types)

| Type | When Emitted | Key Fields |
|------|-------------|------------|
| `SystemMessage` | Session init, compaction boundary | `subtype` ("init", "compact_boundary"), `session_id`, `mcp_servers` |
| `AssistantMessage` | After each Claude response | `content` (text blocks + tool_use blocks) |
| `UserMessage` | After tool execution | Tool result content |
| `StreamEvent` | Partial streaming (opt-in) | Raw API streaming deltas |
| `ResultMessage` | Always last | `result`, `subtype`, `total_cost_usd`, `usage`, `session_id`, `num_turns` |

### Result Subtypes

| Subtype | Meaning |
|---------|---------|
| `success` | Task completed normally |
| `error_max_turns` | Hit `maxTurns` limit |
| `error_max_budget_usd` | Hit cost limit |
| `error_during_execution` | API or runtime error |
| `error_max_structured_output_retries` | Structured output validation failed |

---

## 2. Built-in Tools

The SDK ships with the same tools that power Claude Code. The agent decides which tools to call based on the task; the SDK executes them and feeds results back.

### Tool Inventory

| Tool | Category | Permission Required | Description |
|------|----------|-------------------|-------------|
| `Read` | File I/O | No | Read files (text, images, PDFs, notebooks) |
| `Write` | File I/O | Yes | Create or overwrite files |
| `Edit` | File I/O | Yes | Precise string-replacement edits |
| `Bash` | Execution | Yes | Shell commands. Each command runs in a separate process; cwd persists, env does not |
| `Glob` | Search | No | Find files by pattern (`**/*.ts`) |
| `Grep` | Search | No | Regex content search (built on ripgrep) |
| `Agent` | Orchestration | No | Spawn a subagent with isolated context |
| `Skill` | Orchestration | Yes | Execute a skill (custom command) within the main conversation |
| `WebSearch` | Web | Yes | Search the web |
| `WebFetch` | Web | Yes | Fetch and parse a URL |
| `AskUserQuestion` | Interaction | No | Present multiple-choice questions to the user |
| `ToolSearch` | Discovery | No | Dynamically discover and load deferred tools |
| `TodoWrite` | Task Mgmt | No | Manage task checklist (headless/SDK mode) |
| `TaskCreate/Get/List/Update/Stop/Output` | Task Mgmt | No | Task management in interactive mode |
| `NotebookEdit` | File I/O | Yes | Modify Jupyter notebook cells |
| `EnterWorktree/ExitWorktree` | Git | No | Create/exit isolated git worktrees |
| `EnterPlanMode/ExitPlanMode` | Planning | No/Yes | Switch to/from plan mode |
| `CronCreate/Delete/List` | Scheduling | No | Schedule recurring prompts |
| `LSP` | Code Intel | No | Language server protocol operations |
| `ListMcpResourcesTool/ReadMcpResourceTool` | MCP | No | Access MCP resources |

### Tool Permission Architecture

Three layers control what runs:

1. **`allowedTools`**: Allowlist that auto-approves listed tools (no prompting)
2. **`disallowedTools`**: Denylist that blocks tools regardless of other settings
3. **`permissionMode`**: Controls behavior for tools not in either list

Permission modes:

| Mode | Behavior |
|------|----------|
| `default` | Tools trigger `canUseTool` callback; no callback = deny |
| `acceptEdits` | Auto-approve file edits, others follow default rules |
| `plan` | No tool execution; Claude produces a plan |
| `dontAsk` (TS only) | Deny anything not in allowedTools |
| `bypassPermissions` | Run everything. Only for sandboxed environments |

Scoped rules are supported: `"Bash(npm:*)"` allows only npm commands.

### Parallel Tool Execution

When Claude requests multiple tool calls in a single turn:
- **Read-only tools** (Read, Glob, Grep, read-only MCP): run concurrently
- **State-modifying tools** (Edit, Write, Bash): run sequentially

---

## 3. Subagents / Sessions

### Architecture

Subagents are **separate agent instances** running in their own context windows. They provide:

- **Context isolation**: Intermediate tool calls stay inside the subagent; only the final message returns to the parent
- **Parallelization**: Multiple subagents can run concurrently
- **Specialized instructions**: Each gets its own system prompt
- **Tool restrictions**: Each can be limited to specific tools

### Defining Subagents (Programmatic)

```python
# Python
options = ClaudeAgentOptions(
    allowed_tools=["Read", "Grep", "Glob", "Agent"],  # Agent tool required
    agents={
        "code-reviewer": AgentDefinition(
            description="Expert code reviewer. Use proactively after code changes.",
            prompt="You are a senior code reviewer. Focus on quality and security.",
            tools=["Read", "Glob", "Grep"],  # Read-only
            model="sonnet",
        ),
    },
)
```

### AgentDefinition Fields

| Field | Required | Description |
|-------|----------|-------------|
| `description` | Yes | Tells Claude when to delegate to this agent |
| `prompt` | Yes | System prompt for the subagent |
| `tools` | No | Tool allowlist. Omit to inherit all tools |
| `model` | No | `"sonnet"`, `"opus"`, `"haiku"`, `"inherit"`, or a full model ID |

### Defining Subagents (Filesystem)

Markdown files with YAML frontmatter in `.claude/agents/`:

```markdown
---
name: code-reviewer
description: Reviews code for quality and best practices
tools: Read, Glob, Grep
model: sonnet
permissionMode: dontAsk
maxTurns: 20
memory: user
isolation: worktree
background: true
---

You are a code reviewer. Analyze code and provide feedback.
```

Additional frontmatter fields for filesystem agents:
- `permissionMode`: Permission mode for the subagent
- `maxTurns`: Turn limit
- `memory`: Persistent memory scope (`user`, `project`, `local`)
- `isolation`: Set to `worktree` for git worktree isolation
- `background`: Run in background (concurrent with main conversation)
- `skills`: Preload skill content into subagent context
- `mcpServers`: Scoped MCP servers
- `hooks`: Lifecycle hooks scoped to this subagent
- `disallowedTools`: Tools to deny

### Built-in Subagents

| Agent | Model | Tools | Purpose |
|-------|-------|-------|---------|
| Explore | Haiku | Read-only | Fast codebase search |
| Plan | Inherits | Read-only | Research for plan mode |
| general-purpose | Inherits | All | Complex multi-step tasks |

### Key Constraints

- **Subagents cannot spawn subagents** (no recursive nesting)
- Subagents receive their own system prompt + Agent tool prompt, NOT the parent's conversation history
- The parent receives the subagent's final message as a tool result
- `Agent(type)` syntax in `tools` restricts which subagent types can be spawned

### Session Management

Sessions persist conversation history to disk at `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`.

Three modes of session continuity:

| Mode | How It Works | Use Case |
|------|-------------|----------|
| `continue` | Finds most recent session in current directory | Multi-turn chat, single process |
| `resume` | Takes a specific session ID | Multi-user apps, process restarts |
| `fork` | Creates a new session from a copy of another | Explore alternatives without losing original |

```python
# Capture session ID from first query
session_id = None
async for msg in query(prompt="Analyze auth module", options=...):
    if isinstance(msg, ResultMessage):
        session_id = msg.session_id

# Resume with full context
async for msg in query(
    prompt="Now refactor it",
    options=ClaudeAgentOptions(resume=session_id),
):
    ...
```

---

## 4. Hooks -- Pre/Post Tool Execution

Hooks are callback functions (SDK) or shell commands/HTTP endpoints (CLI) that fire at specific points in the agent lifecycle. They provide **deterministic control** over agent behavior.

### Hook Architecture

```
Event fires --> SDK collects registered hooks --> Matchers filter
--> Callback functions execute --> Callback returns decision
```

### Available Hook Events

| Event | SDK Support | Fires When | Matcher Field |
|-------|------------|-----------|---------------|
| `PreToolUse` | Python + TS | Before tool executes | Tool name |
| `PostToolUse` | Python + TS | After tool succeeds | Tool name |
| `PostToolUseFailure` | Python + TS | After tool fails | Tool name |
| `UserPromptSubmit` | Python + TS | User submits prompt | N/A |
| `Stop` | Python + TS | Agent finishes responding | N/A |
| `SubagentStart` | Python + TS | Subagent spawns | Agent type |
| `SubagentStop` | Python + TS | Subagent completes | Agent type |
| `PreCompact` | Python + TS | Before context compaction | Trigger type |
| `PermissionRequest` | Python + TS | Permission dialog appears | Tool name |
| `Notification` | Python + TS | Agent sends notification | Notification type |
| `SessionStart` | TS only | Session starts | How it started |
| `SessionEnd` | TS only | Session ends | Why it ended |
| `ConfigChange` | TS only | Config file changes | Config source |
| `WorktreeCreate/Remove` | TS only | Worktree lifecycle | N/A |
| `TeammateIdle` | TS only | Agent team member idle | N/A |
| `TaskCompleted` | TS only | Background task done | N/A |

### SDK Hooks (In-Process Callbacks)

```python
# Python
async def protect_env_files(input_data, tool_use_id, context):
    file_path = input_data["tool_input"].get("file_path", "")
    if file_path.endswith(".env"):
        return {
            "hookSpecificOutput": {
                "hookEventName": input_data["hook_event_name"],
                "permissionDecision": "deny",
                "permissionDecisionReason": "Cannot modify .env files",
            }
        }
    return {}  # Allow by default

options = ClaudeAgentOptions(
    hooks={
        "PreToolUse": [
            HookMatcher(matcher="Write|Edit", hooks=[protect_env_files])
        ]
    }
)
```

### Callback Input/Output

**Input** (3 arguments):
1. `input_data`: Typed object with `session_id`, `cwd`, `hook_event_name`, `tool_name`, `tool_input`
2. `tool_use_id`: Correlates PreToolUse/PostToolUse for same call
3. `context`: AbortSignal (TS) or reserved (Python)

**Output** (return object):
- Top-level: `systemMessage` (inject into conversation), `continue` (keep running)
- `hookSpecificOutput`: `permissionDecision` ("allow"/"deny"/"ask"), `permissionDecisionReason`, `updatedInput`

**Exit codes** (CLI hooks):
- `0`: Allow the action (stdout added to context for some events)
- `2`: Block the action (stderr becomes Claude's feedback)
- Other: Allow, stderr logged but not shown to Claude

### CLI Hook Types

| Type | Description |
|------|-------------|
| `command` | Shell command. Input on stdin, output via exit code + stdout/stderr |
| `http` | POST to URL. Same JSON in/out as command hooks |
| `prompt` | Single-turn LLM evaluation. Returns `{ok: true/false, reason: "..."}` |
| `agent` | Multi-turn verification with tool access (spawns a subagent to verify) |

### Hook Patterns

**Input modification** (PreToolUse):
```python
return {
    "hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "allow",
        "updatedInput": {**input_data["tool_input"], "file_path": f"/sandbox{path}"}
    }
}
```

**Async/fire-and-forget** (logging, webhooks):
```python
return {"async_": True, "asyncTimeout": 30000}  # Agent continues immediately
```

**Chaining**: Hooks execute in array order. Keep each focused on one responsibility. `deny` takes priority over `ask` over `allow`.

---

## 5. MCP Integration

MCP (Model Context Protocol) is an open standard for connecting AI tools to external data sources. The SDK supports three transport types plus in-process servers.

### Transport Types

| Transport | Config Key | Use Case |
|-----------|-----------|----------|
| `stdio` | `command` + `args` | Local processes (npx, python scripts) |
| `http` | `type: "http"`, `url` | Cloud-hosted servers (recommended for remote) |
| `sse` | `type: "sse"`, `url` | Server-Sent Events (deprecated, use HTTP) |
| SDK MCP Server | In-process | Custom tools defined in your application code |

### Configuration

```python
# Python - in code
options = ClaudeAgentOptions(
    mcp_servers={
        "github": {
            "command": "npx",
            "args": ["-y", "@modelcontextprotocol/server-github"],
            "env": {"GITHUB_TOKEN": os.environ["GITHUB_TOKEN"]},
        },
        "notion": {
            "type": "http",
            "url": "https://mcp.notion.com/mcp",
        },
    },
    allowed_tools=["mcp__github__*", "mcp__notion__*"],
)
```

```json
// .mcp.json (auto-loaded from project root)
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "${GITHUB_TOKEN}" }
    }
  }
}
```

### Tool Naming Convention

MCP tools are named `mcp__<server-name>__<tool-name>`. Wildcards work in `allowedTools`: `"mcp__github__*"`.

### MCP Tool Search (Dynamic Loading)

When many MCP tools would consume >10% of the context window, Tool Search activates automatically:

1. Tool definitions are marked `defer_loading: true` (not loaded upfront)
2. Claude uses a search tool to discover relevant MCP tools on-demand
3. Only actually-needed tools are loaded into context

Configure via `ENABLE_TOOL_SEARCH` env var: `"auto"` (default), `"auto:5"` (5% threshold), `"true"`, `"false"`.

### Custom Tools (In-Process MCP Servers)

```python
# Python
from claude_agent_sdk import tool, create_sdk_mcp_server

@tool("get_weather", "Get temperature for coordinates", {"lat": float, "lon": float})
async def get_weather(args):
    # ... call weather API ...
    return {"content": [{"type": "text", "text": f"Temperature: {temp}F"}]}

server = create_sdk_mcp_server(
    name="my-tools", version="1.0.0", tools=[get_weather]
)

options = ClaudeAgentOptions(
    mcp_servers={"my-tools": server},
    allowed_tools=["mcp__my-tools__get_weather"],
)
```

```typescript
// TypeScript
import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

const server = createSdkMcpServer({
  name: "my-tools",
  version: "1.0.0",
  tools: [
    tool("get_weather", "Get temperature", {
      lat: z.number(), lon: z.number()
    }, async (args) => ({
      content: [{ type: "text", text: `Temperature: ${temp}F` }]
    }))
  ]
});
```

### Scoping MCP to Subagents

```yaml
# In subagent frontmatter
mcpServers:
  - playwright:
      type: stdio
      command: npx
      args: ["-y", "@playwright/mcp@latest"]
  - github  # Reference to already-configured server
```

Inline MCP servers start when the subagent starts and stop when it finishes. This keeps tools out of the main conversation context.

---

## 6. Skills System

Skills are prompt-based extensions defined in `SKILL.md` files. They extend what Claude can do by injecting specialized instructions.

### Skill Architecture

```
SKILL.md (instructions) --> Loaded into context when invoked
         |
         +--> Invoked by user (/skill-name)
         +--> Invoked by Claude (automatic, based on description)
         +--> Both (default)
```

### Skill Definition

```yaml
# .claude/skills/deploy/SKILL.md
---
name: deploy
description: Deploy the application to production
disable-model-invocation: true  # Only user can invoke
context: fork                    # Run in a subagent
agent: Explore                   # Which subagent type
allowed-tools: Bash(gh *)
model: sonnet
---

Deploy $ARGUMENTS to production:
1. Run the test suite
2. Build the application
3. Push to the deployment target
```

### Frontmatter Fields

| Field | Description |
|-------|-------------|
| `name` | Slash command name |
| `description` | When Claude should use this skill |
| `disable-model-invocation` | `true` = only user can invoke (manual-only) |
| `user-invocable` | `false` = hidden from / menu (background knowledge only) |
| `allowed-tools` | Tools auto-approved when skill is active |
| `model` | Model override |
| `context` | `fork` to run in isolated subagent |
| `agent` | Subagent type when `context: fork` |
| `hooks` | Lifecycle hooks scoped to this skill |

### Invocation Control Matrix

| Config | User Can Invoke | Claude Can Invoke | Context Loading |
|--------|----------------|------------------|-----------------|
| (default) | Yes | Yes | Description always in context, full loads when invoked |
| `disable-model-invocation: true` | Yes | No | Not in context |
| `user-invocable: false` | No | Yes | Description always in context |

### String Substitutions

- `$ARGUMENTS`: All args passed to the skill
- `$ARGUMENTS[N]` / `$N`: Positional args
- `${CLAUDE_SESSION_ID}`: Current session ID
- `${CLAUDE_SKILL_DIR}`: Directory containing SKILL.md

### Dynamic Context Injection

`` !`command` `` syntax runs shell commands before skill content is sent to Claude:

```yaml
## Pull request context
- PR diff: !`gh pr diff`
- Changed files: !`gh pr diff --name-only`
```

### Bundled Skills

| Skill | Purpose |
|-------|---------|
| `/batch <instruction>` | Parallel changes across codebase (spawns worker agents in worktrees) |
| `/claude-api` | Load Claude API reference for your language |
| `/debug [description]` | Troubleshoot the current session |
| `/loop [interval] <prompt>` | Run a prompt repeatedly on an interval |
| `/simplify [focus]` | Review recent changes for quality |

### Skill Locations (Priority Order)

1. Enterprise managed settings (highest)
2. Personal: `~/.claude/skills/<name>/SKILL.md`
3. Project: `.claude/skills/<name>/SKILL.md`
4. Plugin skills (lowest, namespaced)

---

## 7. The Agent Loop Pattern

### Loop Mechanics

```
                   +---> Evaluate & Respond (AssistantMessage)
                   |          |
Receive Prompt --->+          v
                   |    Tool calls in response?
                   |     /            \
                   |   Yes             No
                   |    |               |
                   |    v               v
                   +-- Execute Tools   Return Result
                       (UserMessage)   (ResultMessage)
```

### How Claude Decides: Tools vs. Response

Claude evaluates each turn and determines:

1. **Does the task require action?** If yes, request tool calls.
2. **Are there multiple independent actions?** If yes, request parallel tool calls in a single turn.
3. **Do I have enough information to respond?** If yes, produce text-only response (no tool calls), ending the loop.

The loop continues until Claude produces a response with **no tool calls**. This is the termination signal.

### Turn Counting

A "turn" = one round trip: Claude produces output with tool calls, SDK executes tools, results feed back. Claude's final text-only response is not counted as a turn for `maxTurns` purposes.

### Context Window Management

Context accumulates across turns. Everything stays: system prompt, tool definitions, conversation history, tool inputs/outputs.

**Automatic compaction**: When context approaches the limit, the SDK summarizes older history. Emits `SystemMessage(subtype="compact_boundary")`.

**What gets prompt-cached** (across turns): system prompt, tool definitions, CLAUDE.md content. Only the first request pays full cost for these.

### Effort Levels

| Level | Behavior | Good For |
|-------|----------|----------|
| `low` | Minimal reasoning | File lookups, listing |
| `medium` | Balanced | Routine edits |
| `high` | Thorough (TS default) | Refactors, debugging |
| `max` | Maximum depth | Complex multi-step problems |

### Context Efficiency Strategies

1. **Use subagents**: Each starts fresh. Only the summary returns to parent.
2. **Be selective with tools**: Each tool definition consumes context.
3. **MCP Tool Search**: Load tools on-demand, not all upfront.
4. **Lower effort for routine tasks**: Reduces per-turn token usage.
5. **CLAUDE.md for persistent rules**: Re-injected after compaction (unlike initial prompt).

---

## Architecture Patterns Worth Learning From

### Pattern 1: Tool-Use-Terminated Loop

The agent loop terminates when Claude produces a response with no tool calls. This is simpler than explicit "done" signals or turn-counting. The model itself signals completion by choosing not to call any tools.

### Pattern 2: Permission as Configuration, Not Code

Instead of wrapping each tool call in permission logic, the SDK uses a declarative permission system:
- `allowedTools` / `disallowedTools` as config arrays
- `permissionMode` as a single enum
- Scoped rules like `Bash(npm:*)` for granular control
- Hooks for dynamic validation (the escape hatch)

### Pattern 3: Context Isolation via Subagents

The subagent pattern solves context window pollution: instead of accumulating all intermediate results in one conversation, delegate focused work to a subagent that operates in its own context. Only the final answer returns.

### Pattern 4: Filesystem-as-Configuration

Skills (`.claude/skills/`), subagents (`.claude/agents/`), hooks (`.claude/settings.json`), and MCP servers (`.mcp.json`) are all filesystem-based. This makes them:
- Version-controllable (commit to git)
- Team-shareable
- Scopeable (user vs. project vs. enterprise)
- Inspectable (plain text files)

### Pattern 5: Hook Composition

Hooks are arrays of matchers, each containing arrays of callbacks. This enables:
- **Chaining**: rate limiter -> authorization -> sanitizer -> logger
- **Filtering**: matchers use regex on tool names
- **Priority**: deny > ask > allow across all hooks

### Pattern 6: Async Iterator as the Universal Interface

Everything goes through one async iterator. Whether you want:
- Final result only: filter for `ResultMessage`
- Progress updates: filter for `AssistantMessage`
- Live streaming: enable partial messages, filter for `StreamEvent`
- Debugging: handle all message types

### Pattern 7: SDK MCP Servers (In-Process Custom Tools)

Instead of spawning a separate process for custom tools, the SDK allows defining tools as in-process MCP servers. This eliminates subprocess overhead while maintaining the MCP protocol for tool definition/invocation.

### Pattern 8: Persistent Memory for Agents

Subagents can have persistent memory scopes that survive across conversations:
- `user` scope: `~/.claude/agent-memory/<name>/`
- `project` scope: `.claude/agent-memory/<name>/`
- The agent reads/writes markdown files, building institutional knowledge over time.

---

## Package Information

### Installation

```bash
# TypeScript
npm install @anthropic-ai/claude-agent-sdk

# Python
pip install claude-agent-sdk
```

### Prerequisites

- Node.js 18+ (TypeScript) or Python 3.10+ (Python)
- Anthropic API key (or Bedrock/Vertex/Azure credentials)
- The SDK spawns the Claude Code binary internally (auto-installed)

### Authentication

```bash
export ANTHROPIC_API_KEY=your-key

# Or third-party providers:
export CLAUDE_CODE_USE_BEDROCK=1   # + AWS credentials
export CLAUDE_CODE_USE_VERTEX=1    # + GCP credentials
export CLAUDE_CODE_USE_FOUNDRY=1   # + Azure credentials
```

### Key Repositories

- TypeScript SDK: https://github.com/anthropics/claude-agent-sdk-typescript
- Python SDK: https://github.com/anthropics/claude-agent-sdk-python
- Example agents: https://github.com/anthropics/claude-agent-sdk-demos
- Claude Code (CLI): https://github.com/anthropics/claude-code
