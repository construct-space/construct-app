# Changelog

## v1.0 — 2026-03-14

### HTTP/SSE Transport
- Full HTTP server with POST /api/request for JSON request/response
- SSE streaming via POST /api/stream for long-running operations
- GET /api/health endpoint
- CORS headers support
- Implements the same Server interface as TCP/WebSocket

### Authentication
- Token-based auth for non-local connections
- `GenerateToken(label)` creates new API tokens
- Tokens stored as SHA-256 hashes (never in plaintext)
- `ValidateToken()` / `RevokeToken()` for management
- HTTP middleware for Bearer token validation
- `ListTokens()` returns masked token list

### Plugin API
- `PluginManifest` format (plugin.json) with ID, name, version, type, entry point
- Plugin types: tool, provider, hook
- `ScanDir()` discovers plugins in a directory
- `RegisterPlugin()` auto-registers tools/hooks from manifests
- Plugin executors communicate via stdin/stdout JSON-RPC

### Tool Tests
- Complete tool registry test suite (register, get, ForAgent, All, Defs)

## v0.9 — 2026-03-14

### Error Recovery
- `RetryConfig` with exponential backoff + jitter
- `Retry()` function retries on transient errors (429, 500, 502, 503, 504, timeout)
- `IsTransient()` error classifier

### Structured Logging
- JSON-formatted log files in logs/ directory
- Log levels: Debug, Info, Warn, Error
- Daily log rotation (new file per day)
- Thread-safe concurrent logging

### Config File
- Simple key=value config format (no external TOML library needed)
- `Load(path)` and `Default()` for configuration
- Settings: port, work_dir, default_model, log_level

### Health Monitoring
- `Monitor` tracks provider health status
- Per-provider: last success time, error count, avg latency
- `Check(providerID)` for individual health
- `Report()` for system-wide health overview

## v0.8 — 2026-03-14

### Multi-provider Intelligence
- Model routing: `PickModelForTask()` classifies tasks into fast/smart/power/reason tiers
- Model info database with known costs for Claude, DeepSeek, Grok models
- Cost tracking: `CostTracker` records per-session and per-day token usage + estimated USD cost
- Rate limiting: `RateLimiter` with token bucket algorithm, per-provider limits
- Fallback chains: `FallbackChain` defines ordered provider fallback sequences

## v0.7 — 2026-03-14

### Hook System
- Shell command execution in pre/post tool hooks with environment variables
- Blocking hooks: non-zero exit code blocks the tool call
- JSON-structured hook output for programmatic control
- Tool name filtering with glob pattern support
- File path pattern matching for hooks
- Built-in safety hooks: block writes outside project root, block destructive bash commands
- Hook config loading from JSON files
- Hook timeout support (default 10s)

## v0.6 — 2026-03-14

### Memory & Context
- In-memory cache for fast search across all memory entries
- Scored keyword search across name, description, content, and tags
- Tag-based search with `SearchByTags()`
- `ListByType()` for filtering by memory type
- `ForContext()` builds context strings from relevant memories for agent prompts

## v0.5 — 2026-03-14

### Skills System
- Skill loading from directories (YAML frontmatter + markdown body)
- Trigger matching: keyword lists and regex patterns
- Template expansion with `{{variable}}` and `{{nested.key}}` syntax
- 4 built-in skills: commit, review, explain, test

## v0.4 — 2026-03-14

### Sub-agents & Routing
- `spawn_agent` tool for child agent creation
- Parallel tool execution via goroutines
- LLM-based routing for ambiguous tasks
- Agent handoff with context transfer

## v0.3 — 2026-03-14

### MCP Integration
- MCP stdio and HTTP clients with JSON-RPC 2.0
- Tool discovery with `mcp-{server}-{tool}` namespacing
- MCP config loading from spaces and user config

## v0.2 — 2026-03-14

### Real-time & Polish
- Progress events: `turn.start`, `turn.end`, `token.usage`
- WebSocket transport (stdlib-only, RFC 6455)
- Backpressure handling with configurable buffers

## v0.1.1 — 2026-03-14

### Session Persistence
- Sessions persist to disk as JSON files
- Messages stored with sessions for conversation replay
- Sessions loaded from disk on startup

### Project Context Injection
- Project metadata injected into agent system prompts
- Reads `agents.md`, `AGENTS.md`, `CLAUDE.md` from project root
