/**
 * useVibe — Singleton state + streaming for Vibe space
 *
 * Uses useStreamStatus for tool tracking and status display
 * per the operator protocol (status-events.md, agent-loop.md, transport.md).
 *
 * Operator stream events:
 *   session.start, turn.start, turn.end, status, text,
 *   tool.call, tool.result, done
 *
 * Vibe-specific events (orchestration layer):
 *   vibe.session, orchestration.plan, orchestration.phase,
 *   orchestration.complete
 */

import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useProjectStore } from '@/stores/project'
import { useAIModel } from '@/composables/useAIModel'
import { useOperator, useStreamStatus } from '@/operator'
import type { StreamEvent } from '@/operator'
import type { VibeSessionEvent, DoneEvent } from '@/operator/streamEvents'
import {
  deriveVibeGoal,
  loadProjectVibeHandoff,
  loadVibeHandoff,
  summarizeVibeHandoff,
  type VibeHandoff,
} from '../../architect/utils/vibeHandoff'
import { normalizeVibeProjectPath } from '../utils/sessionProject'

// ─── Types ───

interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface VibeUiMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
}

interface VibeSessionMeta {
  session_id: string
  project_id?: string
  goal?: string
  source?: string
  space?: string
  status?: string
  current_phase?: string
  session_type?: string
  autonomy_level?: string
  project_name?: string
  project_path?: string
}

export interface VibeGoalEntry {
  text: string
  status?: string
  created_at?: string
}

export interface VibeStoredSession {
  id: string
  project_id?: string
  project_name?: string
  project_path?: string
  goal: string
  goals?: VibeGoalEntry[]
  source?: string
  session_type?: string
  autonomy_level?: string
  status?: string
  current_phase?: string
  next_step?: string
  verification?: Record<string, string>
  created_at?: string
  updated_at?: string
}

interface VibeStoredEvent {
  id: number
  event_type: string
  phase?: string
  data?: Record<string, unknown>
  created_at?: string
}

interface VibeSessionDetails {
  session?: VibeStoredSession
  events?: VibeStoredEvent[]
}

// ─── Singleton state ───

interface VibeSessionState {
  draft: string
  submittedGoal: string
  messages: VibeUiMessage[]
  session: VibeSessionMeta | null
  routeInfo: { model?: string; tier?: string; reason?: string } | null
  error: string
  isRunning: boolean
  inputQueue: string[]
  abortController: AbortController | null
  autoRunKey: string
  generation: number
  completionText: string
}

function createEmpty(): VibeSessionState {
  return {
    draft: '',
    submittedGoal: '',
    messages: [],
    session: null,
    routeInfo: null,
    error: '',
    isRunning: false,
    inputQueue: [],
    abortController: null,
    autoRunKey: '',
    generation: 0,
    completionText: '',
  }
}

const _sessions = new Map<string, VibeSessionState>()
let _activeStreamCleanup: (() => void) | null = null

function clearActiveStreamCleanup() {
  const cleanup = _activeStreamCleanup
  _activeStreamCleanup = null
  cleanup?.()
}

function getSessionState(key: string): VibeSessionState {
  if (!_sessions.has(key)) {
    _sessions.set(key, createEmpty())
  }
  return _sessions.get(key)!
}

const _activeKey = ref('__global__')
const _state = ref<VibeSessionState>(getSessionState('__global__'))

// ─── Composable ───

export function useVibe() {
  const route = useRoute()
  const router = useRouter()
  const projectStore = useProjectStore()
  const { init: initAIModel, defaultModelId, getModelId, resolveModelId } = useAIModel()
  const operator = useOperator()
  const streamStatus = useStreamStatus()

  const currentProject = computed(() => projectStore.currentProject)
  const projectPath = computed(() => currentProject.value?.path || currentProject.value?.local_path || '')
  const isProjectScoped = computed(() => /^\/app\/projects\/[^/]+\/vibe/.test(route.path))
  const currentProjectId = computed(() => {
    const raw = route.params.projectId
    return typeof raw === 'string' ? raw : ''
  })
  const scopeKey = computed(() => currentProjectId.value || '__global__')
  const requestedSessionId = computed(() => {
    const raw = route.query.session
    return typeof raw === 'string' ? raw.trim() : ''
  })
  const sessionKey = computed(() => requestedSessionId.value || scopeKey.value)

  const savedSessions = ref<VibeStoredSession[]>([])
  const isLoadingHistory = ref(false)
  const hasLoadedHistory = ref(false)
  const loadingSessionIds = new Set<string>()
  const sessionPollHandle = ref<number | null>(null)
  const storedProjectHandoff = ref<VibeHandoff | null>(null)

  // ─── Sync active state to route ───

  function syncSessionState() {
    const key = sessionKey.value
    if (_activeKey.value !== key) {
      _activeKey.value = key
      _state.value = getSessionState(key)
    }
  }
  syncSessionState()

  // ─── Reactive aliases ───

  const draft = computed({
    get: () => _state.value.draft,
    set: (v: string) => { _state.value.draft = v },
  })
  const submittedGoal = computed(() => _state.value.submittedGoal)
  const messages = computed(() => _state.value.messages)
  const session = computed(() => _state.value.session)
  const routeInfo = computed(() => _state.value.routeInfo)
  const error = computed(() => _state.value.error)
  const isRunning = computed(() => _state.value.isRunning)
  const inputQueue = computed(() => _state.value.inputQueue)

  // From useStreamStatus — operator protocol
  const statusMessage = streamStatus.statusMessage
  const statusNarration = streamStatus.statusNarration
  const progressUpdates = streamStatus.progressUpdates
  const isActive = streamStatus.isActive
  const toolHistory = streamStatus.toolHistory
  const status = streamStatus.status

  const handoff = computed<VibeHandoff | null>(() => {
    const handoffId = typeof route.query.handoff === 'string' ? route.query.handoff : ''
    return loadVibeHandoff(handoffId)
  })
  const effectiveHandoff = computed<VibeHandoff | null>(() => handoff.value || storedProjectHandoff.value)

  const derivedGoal = computed(() => {
    const queryGoal = typeof route.query.goal === 'string' ? route.query.goal : ''
    return deriveVibeGoal(effectiveHandoff.value, queryGoal)
  })

  const hasSession = computed(() =>
    !!_state.value.session || _state.value.messages.length > 0 || toolHistory.value.length > 0,
  )

  const selectedModel = () => getModelId(resolveModelId(defaultModelId.value, { allowAuto: false }))

  // ─── Route/session helpers ───

  async function replaceRouteSession(sessionId: string | null) {
    await router.replace({
      path: route.path,
      query: { ...route.query, session: sessionId || undefined, autorun: undefined },
    })
  }

  function promoteActiveStateToSession(sessionId: string, payload?: VibeSessionMeta) {
    const nextKey = sessionId.trim()
    if (!nextKey) return

    if (_activeKey.value !== nextKey) {
      const currentState = _state.value
      _sessions.set(nextKey, currentState)
      if (_activeKey.value === scopeKey.value) {
        _sessions.set(scopeKey.value, createEmpty())
      }
      _activeKey.value = nextKey
      _state.value = getSessionState(nextKey)
    }

    if (payload) {
      _state.value.session = { ..._state.value.session, ...payload }
    }

    if (route.query.session !== nextKey) {
      void replaceRouteSession(nextKey)
    }
  }

  function syncProjectBindingFromSession(sessionMeta: VibeSessionMeta | null) {
    const sessionPath = normalizeVibeProjectPath(sessionMeta?.project_path)

    if (isProjectScoped.value) {
      if (sessionPath && !projectStore.currentProject) {
        projectStore.openProject(sessionPath)
      }
      return
    }

    const currentPath = normalizeVibeProjectPath(projectStore.currentProject?.path || projectStore.currentProject?.local_path || '')
    if (sessionPath) {
      if (currentPath !== sessionPath) {
        projectStore.openProject(sessionPath)
      }
      return
    }

    if (projectStore.currentProject) {
      projectStore.clearCurrentProject()
    }
  }

  function replayStoredActivity(details: VibeSessionDetails) {
    streamStatus.reset()
    for (const event of details.events || []) {
      if (event.event_type === 'tool.call' || event.event_type === 'tool_call') {
        streamStatus.handleChunk({ content: '', done: false, type: 'tool.call', data: event.data || {} } as StreamEvent)
      } else if (event.event_type === 'tool.result' || event.event_type === 'tool_result') {
        streamStatus.handleChunk({ content: '', done: false, type: 'tool.result', data: event.data || {} } as StreamEvent)
      }
    }

    if (isTerminalStatus(details.session?.status || '')) {
      streamStatus.handleDone()
    }
  }

  // ─── Session management ───

  async function refreshHistory() {
    if (!operator.isTauri.value) return
    isLoadingHistory.value = true
    hasLoadedHistory.value = false
    try {
      const response = await operator.send<{ sessions?: VibeStoredSession[] }>('vibe.session.list', {
        project_id: currentProjectId.value || undefined,
        project_path: projectPath.value || undefined,
      })
      savedSessions.value = Array.isArray(response.sessions) ? response.sessions : []
    } catch (err) {
      if (!_state.value.error) {
        _state.value.error = err instanceof Error ? err.message : 'Failed to load sessions'
      }
    } finally {
      isLoadingHistory.value = false
      hasLoadedHistory.value = true
    }
  }

  async function refreshProjectHandoff() {
    if (!isProjectScoped.value || !projectPath.value) {
      storedProjectHandoff.value = null
      return
    }
    storedProjectHandoff.value = await loadProjectVibeHandoff(projectPath.value)
  }

  async function openSession(sessionId: string) {
    if (!sessionId.trim()) return
    await replaceRouteSession(sessionId.trim())
  }

  async function deleteSession(sessionId: string) {
    const trimmed = sessionId.trim()
    if (!trimmed || !operator.isTauri.value) return

    try {
      await operator.send('vibe.session.delete', { session_id: trimmed })
      savedSessions.value = savedSessions.value.filter(s => s.id !== trimmed)
      loadingSessionIds.delete(trimmed)
      _sessions.delete(trimmed)

      if (requestedSessionId.value === trimmed || _state.value.session?.session_id === trimmed) {
        stopSessionPolling()
        const next = createEmpty()
        _sessions.set(scopeKey.value, next)
        _activeKey.value = scopeKey.value
        _state.value = next
        streamStatus.reset()
        syncProjectBindingFromSession(null)
        await replaceRouteSession(null)
        maybeHydrateDraft()
      }
      _state.value.error = ''
    } catch (err) {
      _state.value.error = err instanceof Error ? err.message : 'Failed to delete session'
    }
  }

  async function loadSession(sessionId: string, options?: { preserveRuntime?: boolean; silent?: boolean }) {
    const trimmed = sessionId.trim()
    if (!trimmed || !operator.isTauri.value || loadingSessionIds.has(trimmed)) return

    loadingSessionIds.add(trimmed)
    try {
      const response = await operator.send<VibeSessionDetails>('vibe.session.get', { session_id: trimmed })
      const rebuilt = buildStateFromStored(response)
      if (options?.preserveRuntime) {
        const current = getSessionState(trimmed)
        _sessions.set(trimmed, mergeStored(current, rebuilt))
      } else {
        _sessions.set(trimmed, rebuilt)
      }
      if (_activeKey.value === trimmed) {
        _state.value = getSessionState(trimmed)
        syncProjectBindingFromSession(rebuilt.session || null)
      }
      // Don't clear error during background polling — only on explicit load
      if (!options?.preserveRuntime) {
        _state.value.error = ''
      }

      // Keep the activity panel aligned with the active session, including resume polling.
      if (_activeKey.value === trimmed) {
        replayStoredActivity(response)
      }
    } catch (err) {
      if (!options?.silent) {
        _state.value.error = err instanceof Error ? err.message : 'Failed to load session'
      }
    } finally {
      loadingSessionIds.delete(trimmed)
    }
  }

  // ─── Build context ───

  function buildLocalData(goal: string) {
    const project = currentProject.value
    const sessionProjectId = _state.value.session?.project_id?.trim() || ''
    const sessionProjectName = _state.value.session?.project_name?.trim() || ''
    const sessionProjectPath = normalizeVibeProjectPath(_state.value.session?.project_path)
    const currentProjectStoreId = project?.id ? String(project.id) : ''
    const currentProjectPath = normalizeVibeProjectPath(projectPath.value)
    const hasBoundSession = Boolean(_state.value.session?.session_id?.trim())
    const sessionMatchesCurrentProject = Boolean(project) && (
      (sessionProjectId && currentProjectStoreId === sessionProjectId)
      || (sessionProjectPath && currentProjectPath && sessionProjectPath === currentProjectPath)
    )
    const effectiveProjectId = hasBoundSession
      ? (sessionProjectId || (sessionMatchesCurrentProject ? currentProjectStoreId : ''))
      : currentProjectStoreId
    const effectiveProjectName = hasBoundSession
      ? (sessionProjectName || (sessionMatchesCurrentProject ? project?.name || '' : ''))
      : (project?.name || sessionProjectName)
    const effectiveProjectPath = hasBoundSession
      ? (sessionProjectPath || (sessionMatchesCurrentProject ? currentProjectPath : ''))
      : (currentProjectPath || sessionProjectPath)
    const effectiveProjectDescription = hasBoundSession && !sessionMatchesCurrentProject
      ? undefined
      : project?.description

    const spaceContext: Record<string, unknown> = { activeSpace: 'vibe' }
    if (hasBoundSession && sessionMatchesCurrentProject && project) {
      spaceContext.project = {
        id: String(project.id),
        name: project.name,
        description: project.description,
        localPath: project.path || project.local_path,
        spaces: project.spaces,
      }
    } else if (hasBoundSession && (effectiveProjectId || effectiveProjectName || effectiveProjectPath)) {
      spaceContext.project = {
        id: effectiveProjectId || undefined,
        name: effectiveProjectName || undefined,
        localPath: effectiveProjectPath || undefined,
      }
    } else if (project) {
      spaceContext.project = {
        id: String(project.id),
        name: project.name,
        description: project.description,
        localPath: project.path || project.local_path,
        spaces: project.spaces,
      }
    } else if (effectiveProjectName || effectiveProjectPath) {
      spaceContext.project = {
        name: effectiveProjectName || undefined,
        localPath: effectiveProjectPath || undefined,
      }
    }

    const localData: Record<string, unknown> = {
      project_id: effectiveProjectId || undefined,
      route_context: { isProjectScoped: isProjectScoped.value, projectId: currentProjectId.value || undefined, spaceName: 'vibe' },
      space_context: spaceContext,
      project_name: effectiveProjectName || undefined,
      project_path: effectiveProjectPath || undefined,
      project_description: effectiveProjectDescription,
      projects_root: projectStore.projectsRoot,
      vibe: { goal, source: effectiveHandoff.value?.source || route.query.source || 'vibe' },
      vibe_session: {
        session_id: _state.value.session?.session_id,
        status: _state.value.session?.status,
        current_phase: _state.value.session?.current_phase,
      },
    }

    if (effectiveHandoff.value) {
      localData.vibe_handoff = {
        source: effectiveHandoff.value.source,
        description: effectiveHandoff.value.description,
        plan_name: effectiveHandoff.value.plan?.name,
        created_at: effectiveHandoff.value.createdAt,
      }
    }

    return localData
  }

  function buildRequestMessages(userMessages: VibeUiMessage[]): ChatMessage[] {
    const requestMessages: ChatMessage[] = []
    const handoffSummary = summarizeVibeHandoff(effectiveHandoff.value)
    if (handoffSummary) {
      requestMessages.push({
        role: 'system',
        content: `You are running inside Construct Vibe.\nUse this handoff as the execution contract unless the user overrides it.\n\n${handoffSummary}`,
      })
    }
    for (const msg of userMessages) {
      requestMessages.push({ role: msg.role, content: msg.content })
    }
    return requestMessages
  }

  // ─── Streaming ───

  async function submit(rawText?: string) {
    const text = (rawText ?? _state.value.draft).trim()
    if (!text) return

    // Queue if busy
    if (_state.value.isRunning) {
      _state.value.inputQueue = [..._state.value.inputQueue, text]
      _state.value.draft = ''
      return
    }

    _state.value.error = ''
    _state.value.isRunning = true
    _state.value.submittedGoal = text
    _state.value.draft = ''
    streamStatus.reset()

    // Clear old messages when starting a fresh goal (previous session done or no session)
    const prevDone = !_state.value.session?.session_id || isTerminalStatus(_state.value.session?.status)
    if (prevDone) {
      _state.value.messages = []
      _state.value.completionText = ''
    }

    const userMessage: VibeUiMessage = { id: `user-${Date.now()}`, role: 'user', content: text }
    _state.value.messages = [..._state.value.messages, userMessage]

    _state.value.abortController?.abort()
    clearActiveStreamCleanup()
    _state.value.abortController = new AbortController()
    ++_state.value.generation
    const abortController = _state.value.abortController
    const generation = _state.value.generation

    if (!operator.isTauri.value) {
      _state.value.error = 'Vibe requires the Construct desktop app.'
      _state.value.isRunning = false
      return
    }

    try {
      // Re-sync auth tokens before each run (Claude Code may have rotated them)
      await operator.refreshTokens().catch(() => {})

      const localData = buildLocalData(text)
      const requestMessages = buildRequestMessages(_state.value.messages)
      const source = (
        effectiveHandoff.value?.source
        || (typeof route.query.source === 'string' ? route.query.source : '')
        || _state.value.session?.source
        || 'vibe'
      ).trim()
      _state.value.routeInfo = null

      let assistantId = ''

      const appendText = (delta: string) => {
        if (!delta || abortController?.signal.aborted || generation !== _state.value.generation) return
        if (!assistantId) {
          assistantId = `assistant-${Date.now()}`
          _state.value.messages = [..._state.value.messages, { id: assistantId, role: 'assistant', content: delta }]
          return
        }
        const idx = _state.value.messages.findIndex(m => m.id === assistantId)
        if (idx === -1) {
          _state.value.messages = [..._state.value.messages, { id: assistantId, role: 'assistant', content: delta }]
          return
        }
        const next = [..._state.value.messages]
        next[idx] = { ...next[idx], content: `${next[idx].content}${delta}` }
        _state.value.messages = next
      }

      await new Promise<void>((resolve, reject) => {
        operator.stream(
          'ai.vibe_stream',
          {
            model: selectedModel(),
            space: 'vibe',
            messages: requestMessages,
            source,
            goal: text,
            session_id: _state.value.session?.session_id || undefined,
            local_data: localData,
          },
          (chunk: StreamEvent) => {
            if (abortController?.signal.aborted || generation !== _state.value.generation) return
            const routeMeta = (chunk as StreamEvent & { route?: VibeSessionState['routeInfo'] }).route
            if (routeMeta) _state.value.routeInfo = routeMeta
            handleChunk(chunk, appendText)
          },
          () => {
            streamStatus.handleDone()
            // Finalize: if no assistant text streamed, create message from completionText
            if (!abortController?.signal.aborted && generation === _state.value.generation) {
              const completion = _state.value.completionText.trim()
              if (completion) {
                if (!assistantId) {
                  assistantId = `assistant-${Date.now()}`
                  _state.value.messages = [..._state.value.messages, { id: assistantId, role: 'assistant', content: completion }]
                } else {
                  const idx = _state.value.messages.findIndex(m => m.id === assistantId)
                  if (idx !== -1 && !_state.value.messages[idx].content.trim()) {
                    const next = [..._state.value.messages]
                    next[idx] = { ...next[idx], content: completion }
                    _state.value.messages = next
                  }
                }
              }
            }
            resolve()
          },
          (err: string) => {
            streamStatus.handleError(err)
            reject(new Error(err))
          },
        )
          .then((unlisten) => {
            if (abortController?.signal.aborted || generation !== _state.value.generation) {
              unlisten()
              return
            }
            _activeStreamCleanup = unlisten
            abortController?.signal.addEventListener('abort', () => {
              unlisten()
              if (_activeStreamCleanup === unlisten) _activeStreamCleanup = null
            }, { once: true })
          })
          .catch(reject)
      })
    } catch (err) {
      _state.value.error = err instanceof Error ? err.message : 'Vibe session failed'
    } finally {
      clearActiveStreamCleanup()
      if (_state.value.abortController === abortController) _state.value.abortController = null
      if (generation === _state.value.generation) _state.value.isRunning = false
      void refreshHistory()
      processQueue()
    }
  }

  function processQueue() {
    if (_state.value.inputQueue.length === 0 || _state.value.isRunning) return
    const next = _state.value.inputQueue[0]
    _state.value.inputQueue = _state.value.inputQueue.slice(1)
    void submit(next)
  }

  function handleChunk(chunk: StreamEvent, onText: (delta: string) => void) {
    const type = chunk.type || ''
    const data = chunk.data || {}

    // Normalize legacy event names (underscore → dot) before passing to streamStatus
    // The operator may emit either format depending on binary version
    let normalizedChunk = chunk
    if (type === 'tool_call') {
      normalizedChunk = { ...chunk, type: 'tool.call' } as StreamEvent
    } else if (type === 'tool_result') {
      normalizedChunk = { ...chunk, type: 'tool.result' } as StreamEvent
    } else if (type === 'progress') {
      const msg = (data.text as string) || chunk.content || ''
      normalizedChunk = { ...chunk, type: 'status', data: { state: 'thinking', message: msg } } as StreamEvent
    }

    // useStreamStatus handles: status, tool.call, tool.result, turn.start
    streamStatus.handleChunk(normalizedChunk)

    switch (type) {
      // ─── Standard protocol events (handled by streamStatus) ───
      case 'status':
      case 'turn.start':
      case 'tool.call':
      case 'tool.result':
      case 'tool_call':    // legacy
      case 'tool_result':  // legacy
      case 'progress':     // legacy
        break
      case 'text':
      case 'stream':
        onText((data.text as string) || chunk.content || '')
        break

      // ─── Vibe orchestration events ───
      case 'vibe.session': {
        const payload = data as unknown as VibeSessionEvent
        if (payload.session_id) promoteActiveStateToSession(payload.session_id, payload as unknown as VibeSessionMeta)
        syncProjectBindingFromSession(payload as unknown as VibeSessionMeta)
        break
      }
      case 'orchestration.phase': {
        const phase = (data.phase || {}) as { kind?: string; domain?: string }
        const phaseStatus = typeof data.status === 'string' ? data.status : 'running'
        const label = phase.domain ? `${phase.kind}:${phase.domain}` : (phase.kind || 'phase')
        if (_state.value.session) {
          _state.value.session = { ..._state.value.session, status: phaseStatus, current_phase: label }
        }
        break
      }
      case 'orchestration.complete': {
        if (typeof data.content === 'string' && data.content.trim()) {
          _state.value.completionText = data.content.trim()
        }
        if (_state.value.session) {
          _state.value.session = { ..._state.value.session, status: 'complete', current_phase: 'summarize' }
        }
        break
      }
      case 'done': {
        const done = data as unknown as DoneEvent
        if (done.content?.trim()) {
          _state.value.completionText = done.content.trim()
        }
        break
      }

      default:
        // Untyped text chunks
        if (!type) {
          const text = (data.text as string) || chunk.content || ''
          if (text) onText(text)
        }
    }
  }

  // ─── Controls ───

  async function stop() {
    const sessionId = _state.value.session?.session_id?.trim()
    if (sessionId && operator.isTauri.value) {
      try {
        await operator.send('vibe.session.cancel', {
          session_id: sessionId,
          reason: 'cancelled by user',
        })
      } catch {
        // Keep local stop responsive even if persistence fails.
      }
    }

    _state.value.abortController?.abort()
    clearActiveStreamCleanup()
    ++_state.value.generation
    _state.value.isRunning = false
    _state.value.inputQueue = []
    if (_state.value.session) {
      _state.value.session = {
        ..._state.value.session,
        status: 'cancelled',
        current_phase: 'cancelled',
      }
    }
    streamStatus.handleError('Stopped')
    void refreshHistory()
  }

  /** New goal within the same project — clears messages/activity but keeps project context */
  function newGoal() {
    _state.value.abortController?.abort()
    clearActiveStreamCleanup()
    streamStatus.reset()
    _state.value.draft = ''
    _state.value.submittedGoal = ''
    _state.value.messages = []
    _state.value.isRunning = false
    _state.value.error = ''
    _state.value.inputQueue = []
    _state.value.completionText = ''
    // Keep project context, clear session so operator creates new one
    const projectName = _state.value.session?.project_name
    const projectPath = _state.value.session?.project_path
    _state.value.session = projectName || projectPath
      ? { session_id: '', project_name: projectName, project_path: projectPath } as any
      : null
  }

  /** New project — clears everything, goes back to empty state */
  function newProject() {
    _state.value.abortController?.abort()
    clearActiveStreamCleanup()
    streamStatus.reset()
    const next = createEmpty()
    _sessions.set(scopeKey.value, next)
    _activeKey.value = scopeKey.value
    _state.value = next
    projectStore.clearCurrentProject()
    void replaceRouteSession(null)
  }

  /** Full reset — clears everything including history, goes back to empty state */
  function reset() {
    _state.value.abortController?.abort()
    clearActiveStreamCleanup()
    streamStatus.reset()
    const next = createEmpty()
    _sessions.set(scopeKey.value, next)
    _activeKey.value = scopeKey.value
    _state.value = next
    void replaceRouteSession(null)
    maybeHydrateDraft()
  }

  // ─── Session polling ───

  function stopSessionPolling() {
    if (sessionPollHandle.value != null) {
      window.clearInterval(sessionPollHandle.value)
      sessionPollHandle.value = null
    }
  }

  function syncSessionPolling() {
    const sessionId = _state.value.session?.session_id?.trim()
    const hasLiveStream = Boolean(_state.value.abortController)
    const terminal = isTerminalStatus(_state.value.session?.status)
    const shouldPoll = Boolean(sessionId) && !hasLiveStream && !terminal

    if (!shouldPoll || !sessionId) {
      stopSessionPolling()
      return
    }
    if (sessionPollHandle.value != null) return

    sessionPollHandle.value = window.setInterval(() => {
      void loadSession(sessionId, { preserveRuntime: true, silent: true })
    }, 2500)
    void loadSession(sessionId, { preserveRuntime: true, silent: true })
  }

  // ─── Hydrate / auto-run ───

  function maybeHydrateDraft() {
    if (requestedSessionId.value) return
    if (!_state.value.draft.trim()) {
      _state.value.draft = derivedGoal.value
    }
  }

  async function maybeAutoRun() {
    const shouldAutoRun = route.query.autorun === '1'
      || route.query.autorun === 'true'
      || (
        isProjectScoped.value
        && hasLoadedHistory.value
        && savedSessions.value.length === 0
        && effectiveHandoff.value?.source === 'architect'
      )
    const goal = derivedGoal.value.trim()
    const key = `${route.fullPath}:${goal}`
    if (requestedSessionId.value || !shouldAutoRun || !goal || _state.value.isRunning || _state.value.messages.length > 0 || _state.value.autoRunKey === key) return
    _state.value.autoRunKey = key
    await nextTick()
    await submit(goal)
  }

  async function maybeLoadRequestedSession() {
    if (!requestedSessionId.value) return
    await loadSession(requestedSessionId.value)
  }

  // ─── Lifecycle ───

  onMounted(async () => {
    await initAIModel()
    syncSessionState()
    await refreshProjectHandoff()
    await refreshHistory()
    await maybeLoadRequestedSession()
    maybeHydrateDraft()
    await maybeAutoRun()
  })

  onBeforeUnmount(() => { stopSessionPolling() })

  watch(() => route.fullPath, async () => {
    syncSessionState()
    await refreshProjectHandoff()
    await refreshHistory()
    await maybeLoadRequestedSession()
    maybeHydrateDraft()
    await maybeAutoRun()
  })

  watch(
    () => [_state.value.isRunning, _state.value.session?.session_id, _state.value.session?.status, Boolean(_state.value.abortController)] as const,
    () => syncSessionPolling(),
    { immediate: true },
  )

  watch(
    () => [_state.value.session?.session_id, _state.value.session?.project_path, isProjectScoped.value] as const,
    () => syncProjectBindingFromSession(_state.value.session),
    { immediate: true },
  )

  watch(
    () => [isProjectScoped.value, projectPath.value] as const,
    async () => {
      await refreshProjectHandoff()
      maybeHydrateDraft()
      await maybeAutoRun()
    },
  )

  return {
    // State
    draft,
    submittedGoal,
    messages,
    session,
    routeInfo,
    error,
    isRunning,
    inputQueue,
    currentProject,
    projectPath,
    handoff: effectiveHandoff,
    rawHandoff: handoff,
    hasSession,
    savedSessions,
    isLoadingHistory,

    // From useStreamStatus (operator protocol)
    status,
    statusMessage,
    statusNarration,
    progressUpdates,
    isActive,
    toolHistory,

    // Actions
    submit,
    stop,
    newGoal,
    newProject,
    reset,
    openSession,
    deleteSession,
    refreshHistory,
    clearError: () => { _state.value.error = '' },
  }
}

// ─── Pure helpers (module-level) ───

function buildStateFromStored(details: VibeSessionDetails): VibeSessionState {
  const state = createEmpty()
  const session = details.session

  if (session) {
    state.session = mapStoredToMeta(session)
    state.submittedGoal = session.goal || ''
    if (session.goal) {
      state.messages = [{ id: `stored-user-${session.id}`, role: 'user', content: session.goal }]
    }
  }

  // Replay text events to rebuild messages
  for (const event of details.events || []) {
    if ((event.event_type === 'text' || event.event_type === 'stream') && typeof event.data?.text === 'string') {
      const lastMsg = state.messages[state.messages.length - 1]
      if (lastMsg?.role === 'assistant') {
        lastMsg.content += event.data.text
      } else {
        state.messages.push({ id: `stored-assistant-${event.id}`, role: 'assistant', content: event.data.text as string })
      }
    } else if (event.event_type === 'orchestration.complete' || event.event_type === 'done') {
      if (typeof event.data?.content === 'string') {
        state.completionText = (event.data.content as string).trim()
      }
    }
  }

  // Add completion as final assistant message if no streaming text was captured
  if (state.completionText) {
    const hasAssistantMsg = state.messages.some(m => m.role === 'assistant' && m.content.trim())
    if (!hasAssistantMsg) {
      state.messages.push({ id: `stored-completion-${session?.id || Date.now()}`, role: 'assistant', content: state.completionText })
    }
  }

  return state
}

function mapStoredToMeta(session: VibeStoredSession): VibeSessionMeta {
  return {
    session_id: session.id,
    project_id: session.project_id,
    goal: session.goal,
    source: session.source,
    status: session.status,
    current_phase: session.current_phase,
    session_type: session.session_type,
    autonomy_level: session.autonomy_level,
    project_name: session.project_name,
    project_path: session.project_path,
  }
}

export function shouldAdoptStoredMessages(
  current: readonly VibeUiMessage[],
  stored: readonly VibeUiMessage[],
): boolean {
  if (stored.length > current.length) return true
  if (stored.length < current.length) return false

  return stored.some((message, index) => {
    const existing = current[index]
    return !existing
      || existing.id !== message.id
      || existing.role !== message.role
      || existing.content !== message.content
  })
}

function mergeStored(current: VibeSessionState, stored: VibeSessionState): VibeSessionState {
  return {
    ...current,
    submittedGoal: stored.submittedGoal || current.submittedGoal,
    messages: shouldAdoptStoredMessages(current.messages, stored.messages) ? stored.messages : current.messages,
    session: stored.session ? { ...current.session, ...stored.session } : current.session,
    completionText: current.completionText || stored.completionText,
    error: current.error,
    isRunning: current.isRunning,
    abortController: current.abortController,
    autoRunKey: current.autoRunKey,
    generation: current.generation,
  }
}

function isTerminalStatus(status?: string): boolean {
  const s = (status || '').trim().toLowerCase()
  return s === 'complete' || s === 'blocked' || s === 'failed' || s === 'cancelled' || s === 'canceled'
}
