# OpenAI Agents SDK -- Research Notes

> Source: https://openai.github.io/openai-agents-python/
> Package: `openai-agents` (Python 3.10+, 226+ contributors)
> Last reviewed: 2026-03-13

---

## 1. Core Primitives

The SDK is built on four pillars: **Agent**, **Runner**, **Tools**, and **Tracing**.

### 1.1 Agent

An `Agent` is the central unit -- an LLM configured with instructions, tools, handoffs, guardrails, and optional structured output.

```python
from agents import Agent

agent = Agent(
    name="Calendar extractor",
    instructions="Extract calendar events from text",
    model="gpt-5.4",                   # optional, default gpt-4.1
    tools=[get_weather],                # function tools, hosted tools, MCP
    handoffs=[billing_agent],           # delegate to other agents
    input_guardrails=[safety_check],    # validate input
    output_guardrails=[pii_check],      # validate output
    output_type=CalendarEvent,          # Pydantic model for structured output
    model_settings=ModelSettings(temperature=0.2, tool_choice="auto"),
    hooks=LoggingHooks(),               # lifecycle callbacks
)
```

Key properties:

| Property | Purpose |
|---|---|
| `name` | Human-readable identifier (required) |
| `instructions` | System prompt -- static string or dynamic `(ctx, agent) -> str` callback |
| `model` | LLM to use (string name, `Model` instance, or resolved via `ModelProvider`) |
| `tools` | List of callable tools |
| `handoffs` | List of agents or `Handoff` objects for delegation |
| `output_type` | Pydantic model / dataclass for structured outputs |
| `model_settings` | Temperature, top_p, tool_choice, parallel_tool_calls, etc. |
| `hooks` | `AgentHooks` for per-agent lifecycle events |
| `input_guardrails` / `output_guardrails` | Validation checks |
| `tool_use_behavior` | Controls what happens after tool execution |

**Dynamic instructions** -- instructions can be a function that receives the run context and the agent, allowing runtime customization (e.g., injecting user name, session data).

**Cloning** -- `agent.clone(name="Variant", instructions="...")` creates a copy with overrides. Useful for creating agent variants from a template.

### 1.2 Runner

The `Runner` manages the agentic loop. Three execution modes:

```python
from agents import Runner

# Async
result = await Runner.run(agent, "user input")

# Sync (wraps async)
result = Runner.run_sync(agent, "user input")

# Streaming
result = Runner.run_streamed(agent, "user input")
async for event in result.stream_events():
    handle(event)
```

`Runner.run()` returns a `RunResult` with:
- `final_output` -- the agent's final response (string or structured type)
- `last_response_id` -- for chaining conversations via `previous_response_id`
- `new_items` -- all items generated during the run
- Usage tracking, guardrail results, etc.

**RunConfig** customizes execution without modifying agent definitions:

| Category | Parameters |
|---|---|
| Model | `model`, `model_provider`, `model_settings` |
| Sessions | `session_settings` |
| Guardrails | `input_guardrails`, `output_guardrails`, `handoff_input_filter` |
| Tracing | `tracing`, `trace_id`, `workflow_name`, `group_id` |
| Tools | `tool_error_formatter` |
| Safety | `max_turns` (raises `MaxTurnsExceeded` if exceeded) |

### 1.3 Tools

Five categories of tools:

#### Function Tools
Any Python function becomes a tool via `@function_tool`:

```python
from agents import function_tool

@function_tool
async def fetch_weather(location: str) -> str:
    """Fetch the weather for a given location.

    Args:
        location: The city and state, e.g. San Francisco, CA.
    """
    return "sunny"
```

The SDK auto-generates JSON schema from type annotations + docstrings (Google, Sphinx, NumPy formats). Supports Pydantic `Field` constraints, timeouts, error handlers, and returning images/files.

#### Hosted Tools (OpenAI-specific)
Run on OpenAI servers alongside the model:
- `WebSearchTool` -- web search
- `FileSearchTool` -- retrieval from Vector Stores
- `CodeInterpreterTool` -- sandboxed code execution
- `ImageGenerationTool` -- image generation
- `HostedMCPTool` -- remote MCP server tools
- `ToolSearchTool` -- deferred tool loading for large tool surfaces

#### Agents as Tools
An agent can be exposed as a tool (not a full handoff):

```python
spanish_agent = Agent(name="Spanish agent", instructions="Translate to Spanish")

orchestrator = Agent(
    name="orchestrator",
    tools=[
        spanish_agent.as_tool(
            tool_name="translate_to_spanish",
            tool_description="Translate messages to Spanish",
        ),
    ],
)
```

Differs from handoff: the orchestrator retains control. The sub-agent runs, returns its result, and the orchestrator continues. Supports `needs_approval=True` for human-in-the-loop, `is_enabled` for conditional availability, and `custom_output_extractor`.

#### Local Runtime Tools
Execute outside model responses:
- `ComputerTool` -- GUI automation via `Computer`/`AsyncComputer` interface
- `ShellTool` -- local or hosted container shell
- `ApplyPatchTool` -- file modifications

#### MCP Tools
Model Context Protocol integration for external tool servers.

#### Tool Search (Deferred Loading)
For agents with large tool surfaces, tools marked `@function_tool(defer_loading=True)` are only loaded when the model requests them, reducing token overhead. `tool_namespace()` groups related tools.

### 1.4 Tracing

Built-in observability with automatic instrumentation.

**Traces** = end-to-end operations. **Spans** = individual steps within a trace (with parent-child nesting).

Auto-traced operations:
- Runner execution
- Agent execution (`agent_span`)
- LLM calls (`generation_span`)
- Tool calls (`function_span`)
- Guardrail checks (`guardrail_span`)
- Handoffs (`handoff_span`)
- Audio operations

```python
from agents import trace

with trace("Joke workflow"):
    first = await Runner.run(agent, "Tell me a joke")
    second = await Runner.run(agent, f"Rate: {first.final_output}")
```

Customization:
- `set_trace_processors()` -- replace or add alongside default OpenAI exporter
- `set_tracing_export_api_key()` -- use OpenAI dashboard even with non-OpenAI models
- 20+ vendor integrations: W&B, Arize-Phoenix, MLflow, LangSmith, Langfuse, PostHog, AgentOps

Sensitive data control: `RunConfig.trace_include_sensitive_data` or env `OPENAI_AGENTS_TRACE_INCLUDE_SENSITIVE_DATA`.

---

## 2. Handoffs Between Agents

Handoffs are the primary multi-agent orchestration primitive. When Agent A hands off to Agent B, Agent B takes over the conversation entirely (unlike agents-as-tools where the caller retains control).

### How Handoffs Work

1. Handoffs are exposed to the LLM as tools (e.g., `transfer_to_refund_agent`)
2. When the LLM calls the handoff tool, the runner updates the current agent and restarts the loop
3. The new agent sees the conversation history and continues

```python
triage_agent = Agent(
    name="Triage agent",
    instructions="Hand off to billing or refund agents as needed.",
    handoffs=[billing_agent, refund_agent],
)
```

### Customization via `handoff()`

```python
from agents import handoff

handoff_obj = handoff(
    agent=target_agent,
    tool_name_override="custom_transfer_tool",
    tool_description_override="Transfer to specialist",
    on_handoff=callback_fn,          # executed when handoff triggers
    input_type=EscalationData,       # Pydantic model for LLM-generated metadata
    input_filter=filter_fn,          # controls what history the target sees
    is_enabled=bool_or_fn,           # conditionally enable/disable at runtime
    nest_handoff_history=True,       # collapse prior transcript into summary
)
```

### Handoff Input Types

The LLM can provide structured metadata when handing off:

```python
class EscalationData(BaseModel):
    reason: str

async def on_handoff(ctx: RunContextWrapper, input_data: EscalationData):
    print(f"Escalation reason: {input_data.reason}")
```

Use for small metadata (reason, language, priority). Not for passing application state (use context for that).

### Input Filters

Control what conversation history the target agent receives:

```python
from agents.extensions import handoff_filters

handoff_obj = handoff(
    agent=faq_agent,
    input_filter=handoff_filters.remove_all_tools
)
```

`HandoffInputData` gives access to `input_history`, `pre_handoff_items`, `new_items`, and `run_context`.

### Two Multi-Agent Patterns

| Pattern | Mechanism | Control Flow |
|---|---|---|
| **Handoff** | `handoffs=[agent_b]` | Agent B takes over entirely |
| **Manager** | `tools=[agent_b.as_tool()]` | Manager retains control, sub-agent returns result |

---

## 3. Guardrails System

Three types: **input**, **output**, and **tool** guardrails.

### Input Guardrails

Run on user input before/alongside agent execution. Two execution modes:

- **Parallel** (default): guardrail runs concurrently with agent -- lower latency but tokens consumed if guardrail trips
- **Blocking**: guardrail completes before agent starts -- no wasted tokens

```python
from agents import input_guardrail, GuardrailFunctionOutput, Runner, Agent

guardrail_agent = Agent(
    name="Guardrail check",
    instructions="Check if user asks for math homework help.",
    output_type=MathHomeworkOutput,  # Pydantic model with is_math_homework: bool
)

@input_guardrail
async def math_guardrail(ctx, agent, input):
    result = await Runner.run(guardrail_agent, input, context=ctx.context)
    return GuardrailFunctionOutput(
        output_info=result.final_output,
        tripwire_triggered=result.final_output.is_math_homework,
    )

agent = Agent(
    name="Support agent",
    input_guardrails=[math_guardrail],
)
```

When `tripwire_triggered=True`, the SDK raises `InputGuardrailTripwireTriggered` and halts execution.

### Output Guardrails

Run on agent's final output. Always execute after agent completion (no parallel mode).

```python
@output_guardrail
async def pii_guardrail(ctx, agent, output):
    result = await Runner.run(guardrail_agent, output.response, context=ctx.context)
    return GuardrailFunctionOutput(
        output_info=result.final_output,
        tripwire_triggered=result.final_output.contains_pii,
    )
```

Raises `OutputGuardrailTripwireTriggered` on failure.

### Tool Guardrails

Validate inputs/outputs of individual function tools:

```python
from agents import tool_input_guardrail, tool_output_guardrail, ToolGuardrailFunctionOutput

@tool_input_guardrail
def block_secrets(data):
    args = json.loads(data.context.tool_arguments or "{}")
    if "sk-" in json.dumps(args):
        return ToolGuardrailFunctionOutput.reject_content("Remove secrets before calling.")
    return ToolGuardrailFunctionOutput.allow()

@tool_output_guardrail
def redact_output(data):
    if "sk-" in str(data.output or ""):
        return ToolGuardrailFunctionOutput.reject_content("Output contained sensitive data.")
    return ToolGuardrailFunctionOutput.allow()

@function_tool(
    tool_input_guardrails=[block_secrets],
    tool_output_guardrails=[redact_output],
)
def classify_text(text: str) -> str:
    return f"length:{len(text)}"
```

### Guardrail Scope Rules

| Guardrail Type | Runs On | Notes |
|---|---|---|
| Input | First agent only | Does not re-run after handoffs |
| Output | Final agent only | Does not run on intermediate agents |
| Tool | Every function_tool invocation | Applies across all agents in the chain |

---

## 4. Responses API and `previous_response_id`

The Responses API is OpenAI's newer API (successor to Chat Completions) that provides:

1. **Server-side conversation state** via `previous_response_id`
2. **Built-in tool execution** (web search, file search, code interpreter run server-side)
3. **Agentic loop within a single API call** for hosted tools

### `previous_response_id` -- Stateful Conversations

Instead of the client sending the full message history each turn, each response has an ID. The next request just sends `previous_response_id` + the new user message. The server reconstructs full context.

```python
previous_response_id = None

while True:
    user_input = input("You: ")
    result = await Runner.run(
        agent,
        user_input,
        previous_response_id=previous_response_id,
        auto_previous_response_id=True,
    )
    previous_response_id = result.last_response_id
    print(f"Assistant: {result.final_output}")
```

### Four Conversation Strategies

| Strategy | Storage | Best For | What You Send Next Turn |
|---|---|---|---|
| `to_input_list()` | App memory | Manual control, small chats | Full prior list + new message |
| `session` | Custom store (SQLite, Redis) | Persistent resumable chats | Same session instance |
| `conversation_id` | OpenAI server | Named shared conversations | ID + new turn only |
| `previous_response_id` | OpenAI server | Lightweight continuation | Prior response ID + new turn |

### Agentic Loop for Built-in Tools

When using hosted tools (web search, file search, code interpreter), the Responses API handles tool execution server-side in a loop:

1. Model decides to call a hosted tool
2. Server executes the tool (no client round-trip)
3. Server feeds result back to the model
4. Model continues reasoning or calls another tool
5. Loop continues until final output

This is invisible to the client -- a single API call can involve multiple internal tool executions.

---

## 5. Built-in Tools

### WebSearchTool
Server-side web search. The model decides when to search, formulates queries, and synthesizes results.

### FileSearchTool
Retrieves from OpenAI Vector Stores. Useful for RAG patterns -- upload documents to a vector store, then the agent can search them.

### CodeInterpreterTool
Sandboxed Python execution. The model writes and runs code, sees output, iterates. Useful for data analysis, math, chart generation.

### ImageGenerationTool
Generates images from text prompts within the agent loop.

### HostedMCPTool
Exposes remote MCP server tools as hosted tools.

### ComputerTool / ShellTool (Local)
GUI automation and shell access running in your environment (not OpenAI servers).

---

## 6. The Agentic Loop

The Runner's loop is the execution engine:

```
1. Call LLM with current agent's instructions + tools + conversation history
2. Process LLM response:
   a. Final output (no tool calls) --> loop ends, return result
   b. Handoff tool call --> switch current agent, restart loop
   c. Tool calls --> execute tools, append results to history, restart loop
3. If max_turns exceeded --> raise MaxTurnsExceeded
```

### Tool Use Behavior Controls

After tools execute, several behaviors are available:

| Behavior | Effect |
|---|---|
| `"run_llm_again"` (default) | LLM processes tool results before responding |
| `"stop_on_first_tool"` | First tool's output becomes final response |
| `StopAtTools(["tool_name"])` | Halt on specific tool calls |
| Custom function | `(ctx, tool_results) -> ToolsToFinalOutputResult` |

**Infinite loop prevention**: The SDK auto-resets `tool_choice` to `"auto"` after tool calls when a specific tool was forced. Controlled via `agent.reset_tool_choice`.

### Advanced Loop Controls

- `call_model_input_filter` -- modify prepared model input right before the LLM call (trim history, inject guidance)
- Error handlers for specific error types (e.g., `"max_turns"`) return controlled outputs instead of exceptions
- WebSocket transport (`responses_websocket_session()`) for persistent connections across multiple runs

---

## 7. Comparison: OpenAI Agents SDK vs. Anthropic's Approach

### Architectural Philosophy

| Dimension | OpenAI Agents SDK | Anthropic (Claude) |
|---|---|---|
| **Framework** | Full SDK with Agent, Runner, Handoff, Guardrails as first-class primitives | No official agent framework; provides API primitives (Messages API + tool_use) and recommends building your own orchestration |
| **Agentic loop** | Built into Runner -- automatic tool execution, handoffs, re-prompting | Client-side loop: check `stop_reason == "tool_use"`, execute tools, send `tool_result` back. You write the loop. |
| **Multi-agent** | First-class handoffs and agents-as-tools | No built-in multi-agent primitive. Anthropic recommends composing single-agent loops yourself. |
| **Guardrails** | Built-in input/output/tool guardrails with tripwire pattern | Not a framework feature. You implement validation in your own orchestration code. |
| **Tracing** | Built-in with OpenAI dashboard + 20+ vendor integrations | No built-in tracing. Use external observability tools. |
| **Tool execution** | Server-side for hosted tools (web search, code interpreter), client-side for function tools | Always client-side. Claude returns `tool_use` blocks; you execute and return `tool_result`. |
| **State management** | `previous_response_id` for server-side state; sessions for custom stores | Client manages full message history. No server-side state. Extended thinking has internal state but conversation history is client-managed. |
| **Model support** | Multi-provider via LiteLLM (`litellm/anthropic/claude-3-5-sonnet-...`) | Claude models only via Messages API |
| **Structured output** | `output_type` on Agent, uses model's native structured output | `tool_use` with `input_schema` for structured extraction, or prefill-based JSON extraction |

### What Anthropic Does Differently (and Better)

1. **Extended Thinking**: Claude's chain-of-thought with thinking blocks is exposed to developers. OpenAI's reasoning is opaque.
2. **No vendor lock-in by design**: Anthropic's philosophy is "use the API, build what you need." No framework to lock into.
3. **Tool use quality**: Claude's tool use is considered strong on benchmarks (SWE-bench, TAU-bench). The tool contract is simple: you define tools, Claude decides when to call them, you execute and return results.
4. **Simplicity**: The Messages API + tool_use is a clean, composable primitive. No abstractions to learn.
5. **Strict tool use**: `strict: true` guarantees schema conformance (no invalid JSON).

### What OpenAI Does Differently (and Better)

1. **Out-of-the-box agent framework**: Lower barrier to entry for multi-agent systems. Handoffs, guardrails, tracing are ready-made.
2. **Server-side tool execution**: Web search, code interpreter, file search run on OpenAI servers in the same API call -- no client round-trips.
3. **`previous_response_id`**: Eliminates the need to send full conversation history. Server manages state.
4. **Built-in tracing**: Production observability without integrating external tools.
5. **Tool search / deferred loading**: Solves the "too many tools" problem by only surfacing relevant tools at runtime.

---

## 8. Lessons for an LLM-Agnostic Agent System

### Architecture Patterns Worth Adopting

#### 8.1 The Runner Pattern
Separate agent definition from execution. The Agent is a data structure (instructions, tools, constraints). The Runner is the execution engine (loop, error handling, tracing).

```
Agent = {instructions, tools, guardrails, output_type}  // declarative
Runner.run(agent, input)                                  // imperative
```

This separation enables:
- Swapping runners (sync, async, streaming)
- Running the same agent definition with different configs
- Testing agents without executing them

#### 8.2 Handoff vs. Agent-as-Tool
Two distinct patterns for multi-agent:
- **Handoff**: full delegation, target agent takes over. Good for routing/triage.
- **Agent-as-tool**: sub-agent runs and returns result to caller. Good for orchestrator patterns.

An LLM-agnostic system should support both. They map to different real-world needs.

#### 8.3 Guardrails as First-Class Citizens
Input/output/tool guardrails are cross-cutting concerns. Making them declarative (attached to agent or tool definitions) is cleaner than embedding validation in business logic.

Key design: guardrails can run **in parallel** with agent execution (optimistic) or **blocking** (pessimistic). This is a meaningful performance/cost tradeoff.

#### 8.4 Tool Abstraction
The five tool types (function, hosted, agent-as-tool, local runtime, MCP) suggest a generic tool interface:

```
Tool {
    name: string
    description: string
    parameters_schema: JSONSchema
    execute(context, args) -> ToolResult
    // metadata
    execution_location: "local" | "remote" | "server-side"
    requires_approval: bool
    guardrails: ToolGuardrail[]
}
```

#### 8.5 Deferred Tool Loading
For systems with many tools, the tool-search pattern is elegant: register tools with metadata, let the model discover and load them on demand. Reduces prompt token usage.

#### 8.6 Provider Abstraction
The `ModelProvider` pattern maps model names to implementations. Combined with LiteLLM, it enables:

```python
Agent(model="litellm/anthropic/claude-3-5-sonnet-20240620")
Agent(model="litellm/gemini/gemini-2.5-flash")
Agent(model="gpt-5.4")
```

For LLM-agnostic design, abstract over:
- Tool schema format (OpenAI function calling vs. Anthropic tool_use vs. others)
- Response parsing (stop_reason handling differs)
- Streaming format
- Structured output mechanism

#### 8.7 Conversation State Management
Four strategies from simple to complex:

1. **Client-managed list**: Full control, send entire history each turn
2. **Session store**: Persistent storage (SQLite, Redis) with automatic management
3. **Server-side ID chaining**: `previous_response_id` pattern (provider-specific)
4. **Named conversations**: Shared across clients/sessions

An LLM-agnostic system should implement (1) and (2), since (3) and (4) are OpenAI-specific.

#### 8.8 Lifecycle Hooks
Two scopes: run-level (`RunHooks`) and agent-level (`AgentHooks`). Events:
- `on_agent_start` / `on_agent_end`
- `on_llm_start` / `on_llm_end`
- `on_tool_start` / `on_tool_end`
- `on_handoff`

These hooks enable: logging, metrics, cost tracking, debugging, human-in-the-loop decisions.

### What to Avoid

1. **Deep coupling to one provider's API shape**: The Responses API (`previous_response_id`, hosted tools) is OpenAI-specific. Don't build core abstractions around it.
2. **Server-side tool execution dependency**: Great for convenience but creates vendor lock-in. Keep tool execution client-side as the primary path.
3. **Over-abstraction**: Anthropic's approach (simple API + you build the loop) has merit. An agent framework should add value (guardrails, tracing, multi-agent) without making simple things hard.

### Recommended Core Abstractions for LLM-Agnostic System

```
ModelProvider
  - resolve(model_name) -> Model
  - Model.generate(messages, tools, settings) -> Response

Agent
  - name, instructions (static or dynamic), tools, handoffs, guardrails, output_type

Runner
  - run(agent, input, config) -> RunResult
  - The agentic loop: LLM call -> check output -> execute tools/handoff -> repeat

Tool (interface)
  - FunctionTool, MCPTool, AgentTool, RemoteTool

Guardrail
  - InputGuardrail, OutputGuardrail, ToolGuardrail
  - execute(context, data) -> {allow: bool, reason: string}

Tracer
  - Trace, Span hierarchy
  - Pluggable exporters (console, OpenTelemetry, vendor-specific)

ConversationStore
  - InMemory, SQLite, Redis implementations
  - save/load message history
```

---

## 9. Quick Reference

### Installation

```bash
pip install openai-agents
# or
uv add openai-agents
```

Optional: `openai-agents[voice]`, `openai-agents[redis]`

### Minimal Example

```python
from agents import Agent, Runner

agent = Agent(name="Assistant", instructions="You are a helpful assistant")
result = Runner.run_sync(agent, "Write a haiku about recursion.")
print(result.final_output)
```

### Multi-Agent Example

```python
from agents import Agent, Runner

billing = Agent(name="Billing", instructions="Handle billing questions")
refund = Agent(name="Refund", instructions="Handle refund requests")

triage = Agent(
    name="Triage",
    instructions="Route to billing or refund agent",
    handoffs=[billing, refund],
)

result = Runner.run_sync(triage, "I want a refund for order #123")
# Runner: triage -> calls transfer_to_refund -> refund agent takes over -> final output
```

### Key Links

- Docs: https://openai.github.io/openai-agents-python/
- GitHub: https://github.com/openai/openai-agents-python
- PyPI: https://pypi.org/project/openai-agents/
