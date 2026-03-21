# LLM Providers

Operator is LLM-agnostic. Any backend implementing the `Provider` interface works.

## Interface

```go
type Provider interface {
    ID() string
    Models() []string
    Complete(ctx context.Context, req *Request) (*Response, error)
    Stream(ctx context.Context, req *Request) (<-chan StreamEvent, error)
}
```

Just 4 methods — simple and unified.

## Available Providers

### Anthropic (API Key)

| | |
|---|---|
| ID | `anthropic` |
| Auth | `x-api-key` header |
| Env | `ANTHROPIC_API_KEY` |
| Models | claude-opus-4-6, claude-sonnet-4-6, claude-haiku-4-5-20251001 |
| Endpoint | `https://api.anthropic.com/v1/messages` |
| Version | `anthropic-version: 2024-01-01` |

### Anthropic (OAuth)

| | |
|---|---|
| ID | `anthropic-oauth` |
| Auth | `Authorization: Bearer <token>` |
| Env | `ANTHROPIC_OAUTH_TOKEN` + `ANTHROPIC_OAUTH_REFRESH` |
| Alt | Auto-loads from OpenCode's `~/.local/share/opencode/auth.json` |
| Models | claude-opus-4-6, claude-sonnet-4-6, claude-haiku-4-5-20251001 |
| Endpoint | `https://api.anthropic.com/v1/messages?beta=true` |

**OAuth-specific behavior:**
- Tool names prefixed with `mcp_` (required by OAuth beta)
- System prompt sent as array with `cache_control: ephemeral`
- Auto-refreshes tokens 5 minutes before expiry
- PKCE flow for new authorization
- Beta flags: `oauth-2025-04-20,interleaved-thinking-2025-05-14,claude-code-20250219`

**Token sources (priority order):**
1. OpenCode tokens (`~/.local/share/opencode/auth.json`)
2. Environment variables (`ANTHROPIC_OAUTH_TOKEN`)

### DeepSeek

| | |
|---|---|
| ID | `deepseek` |
| Auth | `Authorization: Bearer <key>` |
| Env | `DEEPSEEK_API_KEY` |
| Models | deepseek-chat, deepseek-reasoner |
| Endpoint | `https://api.deepseek.com/v1/chat/completions` |

### OpenAI

| | |
|---|---|
| ID | `openai` |
| Auth | `Authorization: Bearer <key>` |
| Env | `OPENAI_API_KEY` |
| Models | gpt-4o, gpt-4o-mini, o3-mini |
| Endpoint | `https://api.openai.com/v1/chat/completions` |

### xAI (Grok)

| | |
|---|---|
| ID | `xai` |
| Auth | `Authorization: Bearer <key>` |
| Env | `XAI_API_KEY` |
| Models | grok-3, grok-3-mini |
| Endpoint | `https://api.x.ai/v1/chat/completions` |

## Adding a Provider

Any OpenAI-compatible API:

```go
opts = append(opts, runner.WithProvider(provider.NewOpenAICompat(provider.OpenAICompatConfig{
    Name:    "LM Studio",
    Key:     "lmstudio",
    BaseURL: "http://localhost:1234/v1",
    APIKey:  "not-needed",
    Models:  []string{"local-model"},
})))
```

## Message Format

Operator uses a unified message format. Each provider translates internally.

```go
type Message struct {
    Role       string      // system, user, assistant, tool
    Content    string
    ToolCalls  []ToolCall
    ToolResult *ToolResult
}
```

**Anthropic translation:**
- `tool` role → `user` role with `tool_result` content block
- Tool calls → `tool_use` content blocks

**OpenAI translation:**
- System prompt → `system` role message
- Tool calls → `tool_calls` array with `function` objects
- Tool results → `tool` role with `tool_call_id`

## Token Usage

Every response includes:
```go
type Usage struct {
    InputTokens  int
    OutputTokens int
    CacheRead    int  // Anthropic prompt caching
    CacheWrite   int
}
```
