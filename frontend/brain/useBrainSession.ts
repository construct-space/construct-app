/**
 * useBrainSession — Block-based agent session backed by brain (HTTP+SSE).
 *
 * Drop-in replacement for the subset of useAgentSession that
 * AssistantPanel consumes: turns/isLoading/error/hasTurns, selectedAgent,
 * statusMessage, send/stop/clear/setAgent. Built on `useBrain().prompt()`
 * + useBrainBridge for tool-request routing.
 *
 * Intentionally smaller than useAgentSession — no operator-stream-event
 * machinery, no buffering classifier, no permission-respond plumbing.
 * Brain pushes simple `text_delta` / `tool_call` / `tool_result` chunks
 * and we map them straight into Turn blocks.
 */

import { ref, computed, shallowRef } from 'vue'
import { useBrain, postToolResponse, type BrainChunk, type ToolRequestPayload } from './client'
import { useBrainBridge } from './bridge'
import { useAIModel } from '@/composables/useAIModel'
import { useConstructCredits } from '@/composables/useConstructCredits'
import type { RequestBlock, TextBlock, ToolBlock, Turn, ImageBlock } from '@/assistant'

let turnCounter = 0
const nextTurnId = () => `brain-turn-${++turnCounter}`

export interface BrainAgent {
  id: string
  name: string
  description?: string
  category?: string
}

export interface SendOptions {
  agentId?: string
  /** Skill IDs to load tier-1 for this prompt. When the panel is inside
   *  a space, the panel passes [spaceSlug] so brain pins only that
   *  space's skill instead of every loaded skill. */
  skills?: string[]
  /** Reserved for parity with useAgentSession.send; unused by brain today. */
  assistantType?: string
  outputSchema?: unknown
  /** Construct-gateway tier hint forwarded into the chat body for
   *  Source-family routing. Omit / undefined = medium (default).
   *  Internal callers (summarisers, classifiers, schedulers, sub-agent
   *  dispatchers) should pass 'small' to save tokens; reserve 'large'
   *  for explicit "think harder" UX (a button, an agent that needs it). */
  tier?: 'large' | 'medium' | 'small'
}

export function useBrainSession() {
  const brain = useBrain()
  const bridge = useBrainBridge()
  const aiModel = useAIModel()

  const turns = ref<Turn[]>([])
  const isLoading = ref(false)
  const error = ref<string | null>(null)
  const selectedAgent = ref<string>('general')
  const statusMessage = ref<string>('')
  const sessionId = ref<string | null>(null)

  const hasTurns = computed(() => turns.value.length > 0)

  // Cancel handle for the in-flight prompt stream; null when idle.
  const cancelHandle = shallowRef<(() => void) | null>(null)

  function appendText(turn: Turn, delta: string) {
    const last = turn.response[turn.response.length - 1]
    if (last && last.type === 'text') {
      ;(last as TextBlock).content += delta
    } else {
      turn.response.push({ type: 'text', content: delta })
    }
  }

  function upsertTool(turn: Turn, callId: string, patch: Partial<ToolBlock>) {
    const existing = turn.response.find(
      (b): b is ToolBlock => b.type === 'tool' && b.callId === callId,
    )
    if (existing) {
      Object.assign(existing, patch)
      return
    }
    const block: ToolBlock = {
      type: 'tool',
      tool: patch.tool ?? 'tool',
      title: patch.title ?? patch.tool ?? 'tool',
      callId,
      state: patch.state ?? 'running',
      ...(patch.input ? { input: patch.input } : {}),
      ...(patch.result ? { result: patch.result } : {}),
    }
    turn.response.push(block)
  }

  async function handleToolRequest(req: ToolRequestPayload): Promise<void> {
    const body: { id: string; result?: unknown; error?: string } = { id: req.id }
    try {
      body.result = await bridge.dispatch(req.method, req.params ?? {})
    } catch (e) {
      body.error = e instanceof Error ? e.message : String(e)
    }
    await postToolResponse(brain.baseURL.value, body)
  }

  function bumpReactivity() {
    // Turns are mutated in place; recreate the array so Vue rerenders.
    turns.value = [...turns.value]
  }

  async function send(blocks: RequestBlock[], opts: SendOptions = {}): Promise<void> {
    if (isLoading.value) return
    error.value = null

    const agentId = opts.agentId || selectedAgent.value || 'general'
    const textPrompt = blocks
      .filter((b): b is { type: 'text'; content: string } => b.type === 'text')
      .map((b) => b.content)
      .join('\n')
      .trim()
    // Collect images so we can build a multimodal `content` payload for
    // the first user message. File blocks are skipped silently — brain
    // has no file-attachment wire yet.
    const imageBlocks = blocks.filter((b): b is ImageBlock => b.type === 'image')
    // Allow image-only sends (e.g. user pastes a screenshot with no caption),
    // but if there's neither text nor an image, nothing to do.
    if (!textPrompt && imageBlocks.length === 0) return

    // Build mixed content[] only when at least one image is present.
    let content:
      | Array<{ type: 'text'; text: string } | { type: 'image'; url: string }>
      | undefined
    if (imageBlocks.length > 0) {
      content = []
      if (textPrompt) content.push({ type: 'text', text: textPrompt })
      for (const b of imageBlocks) {
        if (b.src) content.push({ type: 'image', url: b.src })
      }
    }

    const turn: Turn = {
      id: nextTurnId(),
      request: blocks,
      response: [],
      agentId,
      status: 'streaming',
      timestamp: Date.now(),
    }
    turns.value = [...turns.value, turn]
    // Operate on the REACTIVE turn from the ref, not the raw `turn` literal
    // above. onChunk mutates response blocks in place (appendText/upsertTool);
    // those writes are only tracked by Vue — and only re-render the nested
    // ResponseBlocks — when they go through the reactive proxy. Mutating the
    // raw object meant text streamed into an untracked block and the panel
    // only repainted on done (whole reply at once). Builder/space-developer
    // already do this (they look the message up from a reactive ref).
    const liveTurn = turns.value[turns.value.length - 1] as Turn
    isLoading.value = true
    statusMessage.value = 'Thinking…'

    // Send the bare model id + provider separately — one representation
    // crosses the wire. Brain also peels composites defensively, but
    // handlers like ai.complete forward the model verbatim upstream, so
    // the sender must not leak the "provider:" prefix.
    const compositeId = aiModel.currentModel.value?.id
    const provider = aiModel.currentProvider.value?.id || undefined
    const model = compositeId && provider && compositeId.startsWith(`${provider}:`)
      ? compositeId.slice(provider.length + 1)
      : compositeId || undefined

    try {
      cancelHandle.value = await brain.prompt(
        {
          prompt: textPrompt,
          agent_id: agentId,
          session_id: sessionId.value ?? undefined,
          ...(model ? { model } : {}),
          ...(provider ? { provider } : {}),
          ...(opts.skills && opts.skills.length ? { skills: opts.skills } : {}),
          ...(content ? { content } : {}),
          ...(opts.tier ? { tier: opts.tier } : {}),
        },
        {
          onChunk: (chunk: BrainChunk) => onChunk(liveTurn, chunk),
          onDone: () => {
            liveTurn.status = 'done'
            isLoading.value = false
            statusMessage.value = ''
            cancelHandle.value = null
            bumpReactivity()
          },
          onError: (msg) => {
            liveTurn.status = 'error'
            error.value = msg
            isLoading.value = false
            statusMessage.value = ''
            cancelHandle.value = null
            bumpReactivity()
          },
        },
      )
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      liveTurn.status = 'error'
      error.value = msg
      isLoading.value = false
      statusMessage.value = ''
      cancelHandle.value = null
      bumpReactivity()
    }
  }

  function onChunk(turn: Turn, chunk: BrainChunk) {
    if (chunk.type === 'session' && chunk.data?.session_id) {
      sessionId.value = chunk.data.session_id as string
      return
    }
    if (chunk.type === 'text_delta' && typeof chunk.data?.delta === 'string') {
      appendText(turn, chunk.data.delta)
      bumpReactivity()
      return
    }
    if (chunk.type === 'tool_call' && chunk.data) {
      const callId = String(chunk.data.id ?? chunk.data.call_id ?? chunk.data.name ?? Date.now())
      const name = String(chunk.data.name ?? 'tool')
      const input = chunk.data.input != null ? JSON.stringify(chunk.data.input) : undefined
      upsertTool(turn, callId, {
        tool: name,
        title: name,
        state: 'running',
        ...(input ? { input } : {}),
      })
      statusMessage.value = `Running ${name}…`
      bumpReactivity()
      return
    }
    if (chunk.type === 'tool_result' && chunk.data) {
      const callId = String(chunk.data.id ?? chunk.data.call_id ?? '')
      const output = chunk.data.output != null ? String(chunk.data.output) : ''
      const isError = Boolean(chunk.data.error)
      upsertTool(turn, callId || `result-${Date.now()}`, {
        state: isError ? 'error' : 'done',
        result: isError ? String(chunk.data.error) : output,
      })
      statusMessage.value = ''
      bumpReactivity()
      return
    }
    if (chunk.type === 'tool_request' && chunk.data && typeof chunk.data === 'object') {
      // Brain → frontend bridge call (permission.request, space.snapshot, …).
      void handleToolRequest(chunk.data as unknown as ToolRequestPayload)
      return
    }
    if (chunk.type === 'status' && typeof chunk.data?.message === 'string') {
      statusMessage.value = chunk.data.message
      return
    }
    if (chunk.type === 'routing' && chunk.data && typeof chunk.data === 'object') {
      // Construct gateway routing decision for this turn. Brain only
      // sees these when the upstream is provider-api / Source family.
      const d = chunk.data as Record<string, unknown>
      turn.routing = {
        operator: typeof d.operator === 'string' ? d.operator : undefined,
        slot: typeof d.slot === 'string' ? d.slot : undefined,
        routingTarget: typeof d.routing_target === 'string' ? d.routing_target : undefined,
        upstream: typeof d.upstream === 'string' ? d.upstream : undefined,
      }
      // Live-update the credits indicator from the same headers, so the
      // assistant panel reflects the new balance without a fetch.
      const { applyRoutingCredits } = useConstructCredits()
      applyRoutingCredits({
        used: typeof d.credits_used === 'number' ? d.credits_used : undefined,
        allowance: typeof d.credits_allowance === 'number' ? d.credits_allowance : undefined,
        balance: typeof d.credits_balance === 'number' ? d.credits_balance : undefined,
      })
      bumpReactivity()
      return
    }
  }

  async function stop(): Promise<void> {
    cancelHandle.value?.()
    cancelHandle.value = null
    isLoading.value = false
    statusMessage.value = ''
    const last = turns.value[turns.value.length - 1]
    if (last && last.status === 'streaming') {
      last.status = 'done'
      bumpReactivity()
    }
  }

  function clear(): void {
    void stop()
    turns.value = []
    error.value = null
    sessionId.value = null
  }

  function setAgent(id: string): void {
    selectedAgent.value = id
  }

  async function saveSession(): Promise<string | null> {
    // Brain persists sessions automatically once session_id is allocated.
    return sessionId.value
  }

  async function loadSession(id: string): Promise<boolean> {
    sessionId.value = id
    // TODO: hydrate turns from `sessions.get` once we render the
    // historical block shape brain returns. For now the new session id
    // is enough for follow-up prompts to thread correctly.
    return true
  }

  interface SessionMeta { id: string; agentId: string; turnCount: number; createdAt: string; updatedAt: string }

  async function listSessions(): Promise<SessionMeta[]> {
    try {
      const rows = await brain.listSessions()
      return (rows || []).map(r => ({
        id: r.id,
        agentId: selectedAgent.value,
        turnCount: 0,
        createdAt: r.updated_at,
        updatedAt: r.updated_at,
      }))
    } catch {
      return []
    }
  }

  async function deleteSession(id: string): Promise<void> {
    try {
      await brain.request('sessions.delete', { session_id: id })
      if (sessionId.value === id) {
        sessionId.value = null
        turns.value = []
      }
    } catch { /* ignore */ }
  }

  function newSession(): void {
    void stop()
    sessionId.value = null
    turns.value = []
    error.value = null
    isLoading.value = false
    statusMessage.value = ''
  }

  // Skill matches surfaced during streaming — populated by send() when
  // brain emits skill-match chunks. Empty for now; the chunk handler
  // will push entries as brain starts reporting them.
  const matchedSkills = ref<Array<{ id: string; name: string }>>([])

  return {
    turns,
    isLoading,
    error,
    hasTurns,
    selectedAgent,
    statusMessage,
    sessionId,
    matchedSkills,
    send,
    stop,
    clear,
    setAgent,
    saveSession,
    loadSession,
    listSessions,
    deleteSession,
    newSession,
    brain,
  }
}
