/**
 * useBrain — Thin frontend client for the brain sidecar.
 *
 * Brain runs on its own port (BRAIN_HTTP_PORT, default 60182) and speaks
 * HTTP+SSE; this client only needs fetch and ReadableStream so it works
 * in any Tauri webview without touching Rust IPC.
 */

import { ref, computed } from 'vue'
import { isTauriEnv } from '@/utils/tauri'
import type { ProviderModel } from '@/brain/types'

// ─── Shared singleton state ──────────────────────────────────────────────
// Refs live at module scope so every useBrain() call shares the same
// reactive references. Without this, multiple components calling
// useBrain() would each get fresh `connected`/`version` refs and could
// not observe each other's state.

const connectedRef = ref(false)
const connectingRef = ref(false)
const versionRef = ref('')
const errorRef = ref<string | null>(null)
const isTauriRef = ref(isTauriEnv())

const DEFAULT_HTTP_PORT = 60182

export interface BrainChunk {
  id: string
  type?: string
  // Wire data — shape varies per chunk type (text_delta, tool_call, …);
  // consumers narrow per-field. Indexed as unknown so a typo'd field is a
  // type error instead of a silent any.
  data?: Record<string, unknown>
  error?: string
  done?: boolean
  success?: boolean
}

export interface BrainPromptPayload {
  prompt: string
  system?: string
  model?: string
  provider?: string
  max_tokens?: number
  session_id?: string
  agent_id?: string
  /** Construct-only tier hint for Source family routing. Forwarded to
   *  provider-api's /api/inference/v1/chat/completions in the `tier`
   *  body field. Ignored when the resolved provider isn't Construct
   *  (BYOK paths get a concrete model id selected client-side, no
   *  server-side tier picking needed). Values: 'large' | 'medium' |
   *  'small'. Omit = medium (default chat). */
  tier?: 'large' | 'medium' | 'small'
  /** Filters tier-1 skill disclosure to just these skill IDs.
   *  Empty/omitted = all loaded skills appear in the system prompt. */
  skills?: string[]
  /** Working directory tools (bash, read, write, edit, grep, …) resolve
   *  against. When omitted brain falls back to its process cwd. Senders
   *  pass the active project / space path so tool calls operate inside
   *  the user's target dir, not wherever Tauri launched brain. */
  project_dir?: string
  /** Mixed text + image content for the first user message.
   *  When set, brain prefers this over `prompt` (which becomes a
   *  text-only fallback summary). Images are passed as data URLs
   *  or http(s) URLs — brain decodes data URLs at the wire boundary. */
  content?: Array<
    | { type: 'text'; text: string }
    | { type: 'image'; url: string }
  >
}

function getBaseURL(): string {
  // Allow override via Vite env (VITE_BRAIN_HTTP_PORT) or window global
  // set by the desktop shell. Fall back to default.
  const port =
    // @ts-expect-error window may carry a runtime override
    (typeof window !== 'undefined' && window.__BRAIN_HTTP_PORT__) ||
    (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_BRAIN_HTTP_PORT ||
    DEFAULT_HTTP_PORT
  return `http://127.0.0.1:${port}`
}

// Shared-secret token for the brain HTTP transport. Brain rejects requests
// without it (see brain/sidecar/http.go), which is what stops a random web
// page the user has open from POSTing to the loopback agent port. Fetched
// once from the desktop shell (`brain_token` Tauri command) and memoised.
// Empty string outside Tauri (pure-browser dev has no brain to talk to).
let _brainTokenPromise: Promise<string> | null = null
function getBrainToken(): Promise<string> {
  if (!_brainTokenPromise) {
    _brainTokenPromise = (async () => {
      if (!isTauriEnv()) return ''
      try {
        const { invoke } = await import('@tauri-apps/api/core')
        return (await invoke<string>('brain_token')) || ''
      } catch {
        // Older desktop builds without the command, or invoke failure —
        // fall back to no token so dev/manual brain runs (which also skip
        // enforcement) keep working.
        return ''
      }
    })()
  }
  return _brainTokenPromise
}

/** Build request headers, including the bearer token when available. */
async function brainHeaders(): Promise<Record<string, string>> {
  const token = await getBrainToken()
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

/** Invoke a Tauri brain command. Lazy-imports the core API so pure-browser
 *  builds (no Tauri host) never pull it into the bundle's eager path. */
async function brainInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(cmd, args)
}

let _nextId = 0
function nextId(): string {
  _nextId += 1
  return `br_${Date.now().toString(36)}_${_nextId.toString(36)}`
}

export interface ToolRequestPayload {
  id: string
  method: string
  params?: Record<string, unknown>
}

/**
 * postToolResponse — replies to a brain `tool_request` chunk. Callers
 * (typically the prompt host: AssistantPanel, etc.)
 * route tool_request chunks to useBrainBridge().dispatch(), then call
 * this with the result or error. Brain's `bridge.Frontend.Resolve`
 * unblocks the waiting tool call.
 *
 * Lives here so any consumer of useBrain() gets the helper for free
 * without re-importing bridge plumbing.
 */
export async function postToolResponse(
  baseURL: string,
  body: { id: string; result?: unknown; error?: string },
): Promise<void> {
  try {
    if (isTauriEnv()) {
      // Proxy through Rust so the secure webview origin doesn't try (and fail)
      // to POST over plaintext loopback HTTP. `baseURL` is unused here — Rust
      // resolves brain's port itself.
      await brainInvoke('brain_tool_response', { body })
      return
    }
    await fetch(`${baseURL}/v1/tool_response`, {
      method: 'POST',
      headers: await brainHeaders(),
      body: JSON.stringify(body),
    })
  } catch (e) {
    // Brain will time out the call via its context; nothing else to do here.
    console.warn('[brain] tool_response post failed:', e)
  }
}

export function useBrain() {
  const baseURL = ref(getBaseURL())
  const connected = connectedRef
  const connecting = connectingRef
  const version = versionRef
  const errorState = errorRef
  const isTauri = isTauriRef

  // ─── Connection lifecycle ─────────────────────────────────────────────
  // connect() mirrors useOperator.connect(): it invokes the Tauri
  // `brain_start` command (spawns the sidecar if not already running),
  // then probes `system.ping` to confirm liveness. Safe to call multiple
  // times — both the Tauri command and the wire op are idempotent.
  async function connect(): Promise<boolean> {
    if (connected.value) return true
    connecting.value = true
    errorState.value = null
    try {
      if (isTauri.value) {
        const { invoke } = await import('@tauri-apps/api/core')
        // `brain_start` returns the (tcp, http) pair; we don't need
        // them — getBaseURL() already resolves the http port.
        await invoke('brain_start').catch(() => null)
      }
      const result = await request<{ status: string; version: string }>('system.ping')
      if (result?.status === 'ok') {
        connected.value = true
        version.value = result.version ?? ''
        return true
      }
      return false
    } catch (e) {
      errorState.value = e instanceof Error ? e.message : String(e)
      connected.value = false
      return false
    } finally {
      connecting.value = false
    }
  }

  // ─── One-shot RPC ────────────────────────────────────────────────────
  // In the packaged app we invoke `brain_request` so Rust does the loopback
  // HTTP POST — the secure `tauri://` webview origin can't reach brain's
  // plaintext HTTP (WebKit upgrades it to https and the TLS handshake fails).
  // Browser dev (insecure http origin, no Tauri host) keeps using fetch.
  async function request<T = unknown>(type: string, payload?: Record<string, unknown>): Promise<T> {
    const id = nextId()
    const envelope = isTauri.value
      ? await brainInvoke<BrainChunk>('brain_request', { body: { id, type, payload } })
      : await (async () => {
          const res = await fetch(`${baseURL.value}/v1/request`, {
            method: 'POST',
            headers: await brainHeaders(),
            body: JSON.stringify({ id, type, payload }),
          })
          return (await res.json()) as BrainChunk
        })()
    if (!envelope.success && envelope.error) {
      throw new Error(envelope.error)
    }
    connected.value = true
    return envelope.data as T
  }

  // ─── Streaming ───────────────────────────────────────────────────────
  // Signature mirrors useOperator.stream so AssistantPanel can swap with
  // a single import change.
  async function stream(
    requestType: string,
    payload: Record<string, unknown>,
    onChunk: (chunk: BrainChunk) => void,
    onDone?: (data: Record<string, unknown>) => void,
    onError?: (error: string) => void,
    onStart?: (requestId: string) => void,
  ): Promise<() => void> {
    const id = nextId()
    onStart?.(id)

    let finished = false
    let cancelled = false

    // Shared frame handler — identical semantics whether frames arrive over
    // the Tauri channel (packaged app) or the fetch SSE reader (browser dev).
    const handleChunk = (chunk: BrainChunk): boolean => {
      if (finished) return true
      if (chunk.error) {
        finished = true
        onError?.(chunk.error)
        return true
      }
      if (chunk.done) {
        finished = true
        onDone?.((chunk.data as Record<string, unknown>) ?? {})
        return true
      }
      onChunk(chunk)
      return false
    }

    // fetch path only — kept null in the Tauri/IPC path.
    let controller: AbortController | null = null

    if (isTauri.value) {
      // IPC path: Rust runs the SSE read and forwards each parsed frame over
      // a channel, sidestepping the webview's mixed-content https upgrade.
      connected.value = true
      void (async () => {
        try {
          const { Channel } = await import('@tauri-apps/api/core')
          const channel = new Channel<BrainChunk>()
          channel.onmessage = (chunk) => {
            handleChunk(chunk)
          }
          await brainInvoke('brain_stream', {
            body: { id, type: requestType, payload },
            onEvent: channel,
          })
          // Stream closed without a terminal frame (e.g. brain ended it after
          // a cancel) — settle so callers don't hang.
          if (!finished) {
            finished = true
            onDone?.({})
          }
        } catch (e) {
          if (cancelled || finished) return
          finished = true
          onError?.(e instanceof Error ? e.message : String(e))
        }
      })()
    } else {
      controller = new AbortController()
      const ctrl = controller
      void (async () => {
        try {
          const res = await fetch(`${baseURL.value}/v1/stream`, {
            method: 'POST',
            headers: await brainHeaders(),
            body: JSON.stringify({ id, type: requestType, payload }),
            signal: ctrl.signal,
          })
          if (!res.ok) {
            onError?.(`brain: HTTP ${res.status}`)
            return
          }
          connected.value = true

          const reader = res.body?.getReader()
          if (!reader) {
            onError?.('brain: response has no readable stream')
            return
          }
          const decoder = new TextDecoder()
          let buf = ''
          while (true) {
            const { value, done } = await reader.read()
            if (done) break
            buf += decoder.decode(value, { stream: true })
            // SSE frames separated by blank line.
            let frameEnd: number
            while ((frameEnd = buf.indexOf('\n\n')) >= 0) {
              const frame = buf.slice(0, frameEnd)
              buf = buf.slice(frameEnd + 2)
              const line = frame.startsWith('data: ') ? frame.slice(6) : frame
              if (!line) continue
              let chunk: BrainChunk
              try {
                chunk = JSON.parse(line)
              } catch {
                continue
              }
              if (handleChunk(chunk)) return
            }
          }
        } catch (e) {
          if (ctrl.signal.aborted) return // user cancelled
          onError?.(e instanceof Error ? e.message : String(e))
        }
      })()
    }

    const cancelHandle = () => {
      if (finished) return
      finished = true
      cancelled = true
      controller?.abort()
      // Best-effort: tell brain to stop the in-flight prompt so any
      // tool calls in progress also abort. In the IPC path this also makes
      // brain end the SSE, which resolves the pending brain_stream invoke.
      void request('cancel', { target_id: id }).catch(() => {})
    }
    return cancelHandle
  }

  // ─── Convenience wrappers ────────────────────────────────────────────
  async function ping() {
    return request<string>('ping')
  }
  async function info() {
    return request<{ version: string; data_dir: string; brain_dir: string }>('info')
  }
  async function whoami() {
    return request<{ authenticated: boolean; user: Record<string, unknown> | null; subscriptions: Record<string, string> }>(
      'identity.whoami',
    )
  }
  async function listTools() {
    return request<Array<{ name: string; description: string; input_schema: Record<string, unknown> }>>('tools.list')
  }
  async function listSkills() {
    return request<unknown[]>('skills.list')
  }
  async function listModels() {
    return request<unknown>('models.list')
  }
  async function listSessions() {
    return request<Array<{ id: string; updated_at: string; size: number }>>('sessions.list')
  }
  async function getSession(sessionId: string) {
    return request<unknown[]>('sessions.get', { session_id: sessionId })
  }
  async function listAgents() {
    return request<{ agents: Array<{ id: string; name: string; description?: string; category?: string; max_turns?: number; skill_count: number }> }>(
      'agents.list',
    )
  }
  async function getAgent(id: string) {
    return request<{ id: string; name: string; description?: string; category?: string; max_turns?: number; skill_count: number }>(
      'agents.get',
      { id },
    )
  }
  // listProviders returns the OAuth + saved-key view the Settings page
  // uses to render "configured / not set up" badges. Pulls straight from
  // brain — no Tauri shim, no separate operator command.
  async function listProviders() {
    // Shape lined up with brain's `handleAIProviders` (wire_oauth.go). It
    // emits enough per-entry for the Settings + AI picker to render the
    // "configured" / "connected" badges; `models` carries just id+label
    // since the full catalog (with capabilities, costs, etc.) is fetched
    // separately via `models.list`.
    return request<{
      providers: Array<{
        id: string
        name?: string
        base_url?: string
        env_keys?: string[]
        api_key_present?: boolean
        oauth_linked?: boolean
        connected?: boolean
        models?: Array<{ id: string; label?: string; capabilities?: string[] }>
        capabilities?: string[]
      }>
      default?: string
      defaultProvider?: string
      defaultModel?: string
    }>('ai.providers')
  }

  // callTool — single tool invocation. Used by space composables
  // (useProjectContext, useProjectSummary, …) that need a directory
  // listing or a `path_exists` check without firing a full agent prompt.
  // Accepts the operator function-call envelope so callers can move
  // from `useOperator().callTool(...)` to `useBrain().callTool(...)`
  // without rewriting the arg shape.
  async function callTool(toolCall: {
    id?: string
    type?: 'function'
    function: { name: string; arguments: string }
  }): Promise<{ content: string; is_error: boolean }> {
    return request<{ content: string; is_error: boolean }>('tools.call', {
      toolCall,
    })
  }

  // dispatch — agents.dispatch wire op. Mirrors useOperator.dispatch(...)
  // so callers can swap with a single import change. brain registers
  // dispatch_stream (in wire_prompt.go) which streams chunks; this
  // helper uses the one-shot wire path that resolves with the final
  // result.
  async function dispatch(
    agentId: string,
    task: string,
    model?: string,
    options?: {
      projectPath?: string
      projectName?: string
      sessionId?: string
      assistantType?: string
      outputSchema?: string
      timeout?: number
    },
  ) {
    return request<{
      agent_id: string
      session_id: string
      content: string
      turns: number
      stop_reason?: string
    }>('agents.dispatch', {
      agent_id: agentId,
      task,
      ...(model ? { model } : {}),
      ...(options?.projectPath ? { project_path: options.projectPath } : {}),
      ...(options?.projectName ? { project_name: options.projectName } : {}),
      ...(options?.sessionId ? { session_id: options.sessionId } : {}),
      ...(options?.assistantType ? { assistant_type: options.assistantType } : {}),
      ...(options?.outputSchema ? { output_schema: options.outputSchema } : {}),
      ...(options?.timeout != null ? { timeout: options.timeout } : {}),
    })
  }

  // ─── LLM completion (tier-routed; used by space actions) ─────────────
  //
  // Wraps brain's `ai.complete` wire op with auto-resolution of
  //   tier ('small'|'medium'|'large') → provider+model
  // using the user's tier config (useTierConfig) + active provider
  // (useAIModel.currentProvider). Callers can also pass `provider` and
  // `model` explicitly to skip resolution — used by tests and by
  // headless flows that already know which slot they want.
  //
  // Returns the full response shape declared on @construct-space/sdk
  // (text, tier, provider, model, usage, elapsedMs, finishReason).

  type AiTier = 'small' | 'medium' | 'large'

  interface AiCompleteOptions {
    prompt: string
    tier?: AiTier
    system?: string
    maxTokens?: number
    temperature?: number
    provider?: string
    model?: string
  }

  interface AiChatMessage {
    role: 'system' | 'user' | 'assistant'
    content: string
  }

  interface AiChatOptions {
    messages: AiChatMessage[]
    tier?: AiTier
    system?: string
    maxTokens?: number
    temperature?: number
    provider?: string
    model?: string
  }

  interface AiResponse {
    text: string
    tier: AiTier
    provider: string
    model: string
    usage?: { inputTokens: number; outputTokens: number }
    elapsedMs: number
    finishReason: 'stop' | 'length' | 'error' | 'cancelled'
  }

  async function resolveProviderAndModel(
    explicitProvider: string | undefined,
    explicitModel: string | undefined,
    tier: AiTier,
  ): Promise<{ provider: string; model: string }> {
    if (explicitProvider && explicitModel) {
      return { provider: explicitProvider, model: explicitModel }
    }
    // Lazy import to avoid circular deps (useAIModel imports useBrain).
    const [{ useAIModel }, { useTierConfig }] = await Promise.all([
      import('@/composables/useAIModel'),
      import('@/composables/useTierConfig'),
    ])
    const ai = useAIModel()
    const tierConfig = useTierConfig()
    if (!ai.initialized.value) {
      await ai.init().catch(() => { /* fall through with whatever state we have */ })
    }
    const cur = ai.currentProvider.value
    const providerId = explicitProvider || cur?.id || ''
    if (!providerId) {
      throw new Error('useBrain: no active provider — open Settings → LLM Providers')
    }
    const models: ProviderModel[] = (cur?.models ?? []).map((m: ProviderModel) => ({
      id: m.id,
      label: m.label ?? m.id,
      tierHint: m.tierHint as AiTier | undefined,
      default: m.default,
      deprecated: m.deprecated,
    }))
    const modelId = explicitModel || tierConfig.resolveModel(providerId, tier, models) || ai.defaultModelId.value
    if (!modelId) {
      throw new Error(`useBrain: no model available for provider "${providerId}" tier "${tier}"`)
    }
    // useAIModel composite ids are "provider:model" (colon, not slash —
    // model ids themselves legitimately contain '/', e.g. NVIDIA's
    // "z-ai/glm-5.2", and ':' suffixes, e.g. OpenRouter's ":free").
    // Brain expects the bare model id: strip exactly this provider's own
    // prefix and nothing else. The old '/'-split mangled slash-bearing
    // ids ("z-ai/glm-5.2" → "glm-5.2") and passed colon composites
    // through verbatim.
    const bare = modelId.startsWith(providerId + ':')
      ? modelId.slice(providerId.length + 1)
      : modelId
    return { provider: providerId, model: bare }
  }

  function normaliseTier(t: AiTier | undefined): AiTier {
    return t === 'small' || t === 'large' ? t : 'medium'
  }

  // Reasoning models (e.g. MiniMax) emit their chain-of-thought inline in
  // <think>/<thinking>/<reasoning> blocks instead of a separate channel.
  // Strip it so callers only get the final answer. Models without these tags
  // (Haiku, etc.) pass through unchanged.
  function stripReasoning(s: string): string {
    if (!s) return s
    let out = s.replace(/<(think|thinking|reasoning)>[\s\S]*?<\/\1>/gi, '')
    // Open tag omitted, only a trailing close emitted: drop up to it.
    const close = out.match(/<\/(?:think|thinking|reasoning)>/i)
    if (close) out = out.slice(out.lastIndexOf(close[0]) + close[0].length)
    // Leading unclosed block (reasoning only, answer not emitted yet).
    out = out.replace(/^\s*<(?:think|thinking|reasoning)>[\s\S]*$/i, '')
    return out.trim()
  }

  async function aiCompleteWire(payload: Record<string, unknown>): Promise<AiResponse> {
    const data = await request<{
      text: string
      tier: AiTier
      provider: string
      model: string
      input_tokens?: number
      output_tokens?: number
      elapsed_ms: number
      finish_reason: string
    }>('ai.complete', payload)
    return {
      text: stripReasoning(data.text),
      tier: data.tier,
      provider: data.provider,
      model: data.model,
      usage: (data.input_tokens || data.output_tokens)
        ? { inputTokens: data.input_tokens ?? 0, outputTokens: data.output_tokens ?? 0 }
        : undefined,
      elapsedMs: data.elapsed_ms,
      finishReason: (data.finish_reason as AiResponse['finishReason']) || 'stop',
    }
  }

  async function complete(opts: AiCompleteOptions): Promise<AiResponse> {
    const tier = normaliseTier(opts.tier)
    const { provider, model } = await resolveProviderAndModel(opts.provider, opts.model, tier)
    return aiCompleteWire({
      provider,
      model,
      tier,
      system: opts.system,
      prompt: opts.prompt,
      max_tokens: opts.maxTokens,
      temperature: opts.temperature,
    })
  }

  async function chat(opts: AiChatOptions): Promise<AiResponse> {
    const tier = normaliseTier(opts.tier)
    const { provider, model } = await resolveProviderAndModel(opts.provider, opts.model, tier)
    return aiCompleteWire({
      provider,
      model,
      tier,
      system: opts.system,
      messages: opts.messages,
      max_tokens: opts.maxTokens,
      temperature: opts.temperature,
    })
  }

  async function prompt(payload: BrainPromptPayload, handlers: {
    onChunk: (chunk: BrainChunk) => void
    onDone?: (data: Record<string, unknown>) => void
    onError?: (error: string) => void
    onStart?: (requestId: string) => void
  }) {
    return stream('prompt', payload as unknown as Record<string, unknown>,
      handlers.onChunk, handlers.onDone, handlers.onError, handlers.onStart)
  }

  return {
    baseURL: computed(() => baseURL.value),
    connected: computed(() => connected.value),
    connecting: computed(() => connecting.value),
    version: computed(() => version.value),
    error: computed(() => errorState.value),
    isTauri: computed(() => isTauri.value),
    connect,
    request,
    stream,
    ping,
    info,
    whoami,
    listTools,
    listSkills,
    listModels,
    listSessions,
    getSession,
    listAgents,
    getAgent,
    listProviders,
    dispatch,
    callTool,
    prompt,
    complete,
    chat,
  }
}
