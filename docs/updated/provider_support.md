# Provider Support — Claude Code vs Construct

  What Claude Code does:

  - Anthropic-only: Claude models via API key or OAuth
  - Single provider, single auth path
  - No provider abstraction — tightly coupled to Anthropic API
  - OAuth with PKCE for Max/Pro subscriptions
  - Model fallback: Opus → Sonnet on repeated 529 errors

  How it is now:

  ┌────┬───────────────────────────────┬──────────────────────────────────────────────────┬──────────────────────────┐
  │  # │ What we built                 │ How it works                                     │ File                     │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │  1 │ Provider interface            │ Provider interface: ID(), Models(), Complete(),   │ provider/provider.go     │
  │    │                               │ Stream(). Optional: Capabilities, ModelMeta,     │                          │
  │    │                               │ HealthCheck interfaces.                          │                          │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │  2 │ Anthropic (API key)           │ Direct API key auth. Claude Opus 4, Sonnet 4,   │ connectors/anthropic.go  │
  │    │                               │ Haiku 4.5. Streaming SSE. cache_control for     │                          │
  │    │                               │ system prompt. Structured output via             │                          │
  │    │                               │ output_config.                                   │                          │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │  3 │ Anthropic (OAuth)             │ Bearer token auth with PKCE flow. Auto-refresh   │ connectors/              │
  │    │                               │ with 5-min buffer. Falls back to OpenCode's      │ anthropic_oauth.go       │
  │    │                               │ auth.json on refresh failure. mcp_ tool prefix.  │                          │
  │    │                               │ Beta features: oauth, interleaved thinking,      │                          │
  │    │                               │ claude-code mode. Emits tool_call_done for       │                          │
  │    │                               │ streaming executor.                              │                          │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │  4 │ OpenAI-compatible             │ Works with any OpenAI-compatible API: DeepSeek,  │ connectors/              │
  │    │                               │ xAI, LM Studio. Configurable base URL, key,     │ openai_compat.go         │
  │    │                               │ models. Supports reasoning_content for DeepSeek  │                          │
  │    │                               │ reasoner thinking. response_format for           │                          │
  │    │                               │ structured output.                               │                          │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │  5 │ OpenAI via Codex OAuth        │ NewOpenAIFromCodex() loads OAuth tokens from     │ connectors/              │
  │    │                               │ ~/.codex/auth.json. ChatGPT Plus subscriptions.  │ openai_compat.go         │
  │    │                               │ Models: gpt-4.1, gpt-4o, o3, o3-mini, o4-mini.  │                          │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │  6 │ OpenRouter                    │ Dynamic model discovery from /api/v1/models.     │ connectors/              │
  │    │                               │ Filters to free-tier models with tool support.   │ openrouter.go            │
  │    │                               │ RefreshModels(). ModelsMeta() with per-model     │                          │
  │    │                               │ capabilities (tools, reasoning, vision).          │                          │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │  7 │ GitHub Copilot (OAuth)        │ Uses GitHub OAuth tokens. Auto-refresh via       │ connectors/              │
  │    │                               │ RefreshGitHubCopilotToken(). Dynamic base URL    │ github_copilot.go        │
  │    │                               │ from Copilot API. Models: gpt-5-mini, gpt-4.1,  │                          │
  │    │                               │ claude-sonnet, claude-opus. Copilot-specific     │                          │
  │    │                               │ headers (User-Agent, Editor-Version, etc.).      │                          │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │  8 │ Google Gemini CLI (OAuth)     │ Uses Google Cloud OAuth. cloudcode-pa.googleapis │ connectors/              │
  │    │                               │ .com endpoint. Models: gemini-2.5-pro/flash,    │ google_gemini_cli.go     │
  │    │                               │ gemini-3-pro/flash, gemini-3.1-pro. 1M context  │                          │
  │    │                               │ window. functionCall/functionResponse format.     │                          │
  │    │                               │ Structured output via responseMimeType +          │                          │
  │    │                               │ responseSchema.                                  │                          │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │  9 │ Unified message format        │ provider.Message is provider-agnostic: Role,     │ provider/provider.go     │
  │    │                               │ Content, ReasoningContent, ToolCalls,            │                          │
  │    │                               │ ToolResult. Each connector translates to/from    │                          │
  │    │                               │ its native format.                               │                          │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │ 10 │ Rate limit handling           │ RateLimitError with RetryAfter parsed from       │ provider/provider.go     │
  │    │                               │ headers. Each connector: on 429, parse retry     │                          │
  │    │                               │ header, wait, retry once. Works for both         │                          │
  │    │                               │ Complete() and Stream().                          │                          │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │ 11 │ Capabilities declaration      │ CapabilitiesProvider interface: each connector   │ provider/provider.go     │
  │    │                               │ declares SupportsStructuredOutput, SupportsTools,│                          │
  │    │                               │ SupportsStreaming, MaxContextTokens. Runner      │                          │
  │    │                               │ uses these to skip unsupported features.          │                          │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │ 12 │ Tool name sanitization        │ helpers.SanitizeToolName / UnsanitizeToolName.   │ provider/helpers/        │
  │    │                               │ Handles per-provider quirks: mcp_ prefix for     │                          │
  │    │                               │ OAuth, function wrapping for OpenAI, name        │                          │
  │    │                               │ format for Gemini.                               │                          │
  └────┴───────────────────────────────┴──────────────────────────────────────────────────┴──────────────────────────┘

  The 1 gap — Claude Code vs Construct:

  ┌─────┬──────────────────────┬────────┬──────────────────────────────────────────┬────────────────────────────┐
  │  #  │        Gap           │ Impact │            What they do                  │       What we do           │
  ├─────┼──────────────────────┼────────┼──────────────────────────────────────────┼────────────────────────────┤
  │  1  │ Model fallback on    │ Low    │ Opus → Sonnet on repeated 529 errors.   │ We retry same model 3x.    │
  │     │ failure              │        │ Cost-aware degradation.                  │ No automatic model         │
  │     │                      │        │                                          │ downgrade across providers.│
  └─────┴──────────────────────┴────────┴──────────────────────────────────────────┴────────────────────────────┘

  Note: Construct has 7 provider connectors vs Claude Code's 1. This is a major
  differentiator — multi-provider from day one.

---

## Problem → Solution Log

### Provider interface — DONE
**Problem:** Need to support multiple LLM providers without coupling the agent loop to any specific API format.
**Solution:** `Provider` interface with ID(), Models(), Complete(), Stream(). Optional interfaces for capabilities, model metadata, and health checks. Unified `Message`, `ToolCall`, `ToolResult`, `StreamEvent` types. Each connector translates to/from its native API format.
**Files:** `provider/provider.go`

### Anthropic OAuth with PKCE — DONE
**Problem:** Users with Claude Pro/Max subscriptions can't use their subscription credits through API keys. Need OAuth flow.
**Solution:** Full PKCE OAuth flow: GeneratePKCE(), GetAuthorizationURL(), ExchangeCode(). Auto-refresh with 5-minute buffer. Falls back to OpenCode's auth.json if refresh fails. Matches Claude CLI exactly: user-agent, beta features, metadata, mcp_ tool prefix, array-format system prompt with cache_control.
**Files:** `connectors/anthropic_oauth.go`

### OpenAI-compatible connector — DONE
**Problem:** DeepSeek, xAI, LM Studio all speak the OpenAI API format. Need one connector for all of them.
**Solution:** `OpenAICompatProvider` with configurable name, key, base URL, API key, and model list. Handles DeepSeek-specific reasoning_content field. Structured output via response_format. Rate limit handling. `NewOpenAIFromCodex()` loads ChatGPT Plus tokens from Codex CLI auth.
**Files:** `connectors/openai_compat.go`

### OpenRouter with dynamic models — DONE
**Problem:** OpenRouter offers 100+ models. Hard-coding the model list goes stale. Also need to filter to free models with tool support.
**Solution:** `NewOpenRouter()` fetches /api/v1/models at construction time (10s timeout). Filters to free-tier models (both prompt and completion pricing are zero). Extracts per-model capabilities (tools, reasoning, vision, structured). `RefreshModels()` for manual refresh. Uses OpenAI-compatible connector underneath.
**Files:** `connectors/openrouter.go`

### GitHub Copilot connector — DONE
**Problem:** Users with GitHub Copilot subscriptions want to use those credits for Construct.
**Solution:** OAuth token auth with auto-refresh via `RefreshGitHubCopilotToken()`. Dynamic base URL from Copilot API (changes per session). Copilot-specific headers: User-Agent, Editor-Version, Editor-Plugin-Version, Copilot-Integration-Id, X-Initiator, Openai-Intent. Supports Claude and GPT models through Copilot.
**Files:** `connectors/github_copilot.go`

### Google Gemini CLI connector — DONE
**Problem:** Google Gemini offers 1M context window and free usage through Cloud Code. Different API format from OpenAI.
**Solution:** Native Gemini API integration via cloudcode-pa.googleapis.com. Converts between provider.Message and Gemini's contents/parts/functionCall format. Google Cloud OAuth with auto-refresh. Handles function calls with explicit ID tracking. Maps Gemini stop reasons to provider-agnostic format. 1M context window declared in capabilities.
**Files:** `connectors/google_gemini_cli.go`
