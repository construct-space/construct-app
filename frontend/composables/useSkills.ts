/**
 * useSkills - Manage skills and hooks via context service
 *
 * Features:
 * - Progressive loading: summaries first, full content on-demand
 * - Relevance search: find skills by keywords/query
 * - Instruction-style: get skill knowledge for AI context
 */
import { readonly, ref } from 'vue'
import { isTauriEnv } from '@/utils/tauri'
import { useBrain } from '@/brain'

export interface SkillInfo {
  id: string
  name: string
  category: string
  description: string
  version: string
  state: 'unloaded' | 'loading' | 'active' | 'disabled' | 'error'
  dependencies: readonly string[]
  hooksCount: number
  toolsCount: number
  loadedAt?: string
  error?: string
  source?: string
}

export interface HookInfo {
  id: string
  name: string
  type: string
  priority: number
  skillId?: string
  enabled: boolean
  description?: string
  // "user" | "builtin" | "space:<id>" | "skill:<id>" — only "user"
  // entries are editable/deletable via the UI.
  source?: string
}

export interface SkillMetrics {
  skillId: string
  hooksExecuted: number
  toolsExecuted: number
  errorCount: number
  totalDuration: number
  lastUsed?: string
}

export interface HookMetrics {
  hookId: string
  executionCount: number
  errorCount: number
  avgDuration: number
  lastExecuted?: string
}

// Progressive Loading Types
export interface SkillSummary {
  id: string
  name: string
  category: string
  description: string
  keywords: string[]
  toolNames: string[]
  hookTypes: string[]
  isLoaded: boolean
}

export interface SkillContent {
  id: string
  instructions: string
  tools: ToolDefinition[]
  hooks: HookDefinition[]
  settings: Record<string, unknown>
  examples: SkillExample[]
}

export interface ToolDefinition {
  name: string
  description: string
  parameters: ParameterDefinition[]
  action: string
  config: Record<string, unknown>
}

export interface HookDefinition {
  id: string
  name: string
  type: string
  priority: number
  description: string
  action: string
  config: Record<string, unknown>
}

export interface ParameterDefinition {
  name: string
  type: string
  description: string
  required: boolean
  default?: unknown
  enum?: string[]
}

export interface SkillExample {
  title: string
  description: string
  input?: string
  output?: string
}

// Relevance Search Types
export interface SkillMatch {
  skill: SkillSummary
  score: number
  matchedOn: string[]
  reason: string
}

export interface SkillSearchQuery {
  query: string
  categories?: string[]
  keywords?: string[]
  hasTools?: boolean
  hasHooks?: boolean
  limit?: number
}

export interface SkillSearchResult {
  matches: SkillMatch[]
  totalCount: number
  query: string
}

export function useSkills() {
  const skills = ref<SkillInfo[]>([])
  const hooks = ref<HookInfo[]>([])
  const isLoading = ref(false)
  const error = ref<string | null>(null)

  const isTauri = isTauriEnv()
  const brain = useBrain()

  // Skills/hooks now live in the brain (the operator context-service this
  // composable used — start_context_service / send_context_request — was
  // retired). brain.request(...) hits the brain wire ops; see wire_skills.go
  // and skills.list in wire_meta.go.
  async function sendContextRequest<T>(requestType: string, payload: Record<string, unknown> = {}): Promise<T> {
    if (!isTauri) throw new Error('Brain unavailable outside Tauri')
    return brain.request<T>(requestType, payload)
  }

  // List all skills
  const listSkills = async () => {
    if (!isTauri) return
    isLoading.value = true
    error.value = null

    try {
      const result = await sendContextRequest<{ skills: SkillInfo[] }>('skills.list')
      skills.value = result.skills || []
      console.log(`[useSkills] Loaded ${skills.value.length} skills:`, skills.value.map(s => s.id || s.name).join(', '))
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      console.error('[useSkills] listSkills failed:', e)
    } finally {
      isLoading.value = false
    }
  }

  // Get skill details
  const getSkill = async (skillId: string): Promise<SkillInfo | null> => {
    if (!isTauri) return null

    try {
      const result = await sendContextRequest<{ skill: SkillInfo }>('skills.get', { id: skillId })
      return result.skill
    } catch (e) {
      console.error('[useSkills] getSkill failed:', e)
      return null
    }
  }

  // Load a skill
  const loadSkill = async (skillId: string): Promise<boolean> => {
    if (!isTauri) return false

    try {
      await sendContextRequest('skills.load', { id: skillId })
      await listSkills()
      return true
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      return false
    }
  }

  // Unload a skill
  const unloadSkill = async (skillId: string): Promise<boolean> => {
    if (!isTauri) return false

    try {
      await sendContextRequest('skills.unload', { id: skillId })
      await listSkills()
      return true
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      return false
    }
  }

  // Enable a skill
  const enableSkill = async (skillId: string): Promise<boolean> => {
    if (!isTauri) return false

    try {
      await sendContextRequest('skills.enable', { id: skillId })
      await listSkills()
      return true
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      return false
    }
  }

  // Disable a skill
  const disableSkill = async (skillId: string): Promise<boolean> => {
    if (!isTauri) return false

    try {
      await sendContextRequest('skills.disable', { id: skillId })
      await listSkills()
      return true
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      return false
    }
  }

  // Load builtin skills
  const loadBuiltins = async (): Promise<boolean> => {
    if (!isTauri) return false

    try {
      await sendContextRequest('skills.load_builtins')
      await listSkills()
      return true
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      return false
    }
  }

  // Get skill metrics
  const getSkillMetrics = async (): Promise<SkillMetrics[]> => {
    if (!isTauri) return []

    try {
      const result = await sendContextRequest<{ metrics: SkillMetrics[] }>('skills.metrics')
      return result.metrics || []
    } catch (e) {
      console.error('[useSkills] getSkillMetrics failed:', e)
      return []
    }
  }

  // List all hooks
  const listHooks = async () => {
    if (!isTauri) return
    isLoading.value = true

    try {
      const result = await sendContextRequest<{ hooks: HookInfo[] }>('hooks.list')
      hooks.value = result.hooks || []
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      console.error('[useSkills] listHooks failed:', e)
    } finally {
      isLoading.value = false
    }
  }

  // Get hooks by type
  const getHooksByType = async (hookType: string): Promise<HookInfo[]> => {
    if (!isTauri) return []

    try {
      const result = await sendContextRequest<{ hooks: HookInfo[] }>('hooks.by_type', { type: hookType })
      return result.hooks || []
    } catch (e) {
      console.error('[useSkills] getHooksByType failed:', e)
      return []
    }
  }

  // Enable a hook
  const enableHook = async (hookId: string): Promise<boolean> => {
    if (!isTauri) return false

    try {
      await sendContextRequest('hooks.enable', { id: hookId })
      await listHooks()
      return true
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      return false
    }
  }

  // Disable a hook
  const disableHook = async (hookId: string): Promise<boolean> => {
    if (!isTauri) return false

    try {
      await sendContextRequest('hooks.disable', { id: hookId })
      await listHooks()
      return true
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      return false
    }
  }

  // Save a user hook to ~/Library/Application Support/Construct/hooks.json
  // Payload must be a single Hook object matching the operator's Hook shape
  // (id, name, type, priority, description, tools, patterns, command, timeout).
  const saveHook = async (hook: Record<string, unknown>): Promise<{ id: string; name: string; path: string } | null> => {
    if (!isTauri) return null
    try {
      const result = await sendContextRequest<{ id: string; name: string; path: string }>('hooks.save', hook)
      await listHooks()
      return result
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      return null
    }
  }

  // Delete a user hook (source === "user" only; builtin/space hooks can't be removed)
  const deleteHook = async (hookId: string): Promise<boolean> => {
    if (!isTauri) return false
    try {
      await sendContextRequest('hooks.delete', { id: hookId })
      await listHooks()
      return true
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      return false
    }
  }

  // Get hook metrics
  const getHookMetrics = async (): Promise<HookMetrics[]> => {
    if (!isTauri) return []

    try {
      const result = await sendContextRequest<{ metrics: HookMetrics[] }>('hooks.metrics')
      return result.metrics || []
    } catch (e) {
      console.error('[useSkills] getHookMetrics failed:', e)
      return []
    }
  }

  // Save a skill (.md file to ~/Library/Application Support/Construct/skills/)
  const saveSkill = async (filename: string, content: string): Promise<{ id: string; name: string; path: string } | null> => {
    if (!isTauri) return null

    try {
      const result = await sendContextRequest<{ id: string; name: string; path: string }>('skills.save', { filename, content })
      await listSkills()
      return result
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      return null
    }
  }

  // Delete a user skill
  const deleteSkill = async (skillId: string): Promise<boolean> => {
    if (!isTauri) return false

    try {
      await sendContextRequest('skills.delete', { id: skillId })
      await listSkills()
      return true
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      return false
    }
  }

  // Refresh all data
  const refresh = async () => {
    await Promise.all([listSkills(), listHooks()])
  }

  // ============================================
  // Progressive Loading API
  // ============================================

  // Get lightweight summaries of all skills (~100 tokens each)
  const getSummaries = async (): Promise<SkillSummary[]> => {
    if (!isTauri) return []

    try {
      const result = await sendContextRequest<{ summaries: SkillSummary[] }>('skills.summaries')
      return result.summaries || []
    } catch (e) {
      console.error('[useSkills] getSummaries failed:', e)
      return []
    }
  }

  // Get full content for a specific skill (on-demand)
  const getContent = async (skillId: string): Promise<SkillContent | null> => {
    if (!isTauri) return null

    try {
      const result = await sendContextRequest<{ content: SkillContent }>('skills.content', { skillId })
      return result.content || null
    } catch (e) {
      console.error('[useSkills] getContent failed:', e)
      return null
    }
  }

  // ============================================
  // Relevance Search API
  // ============================================

  // Search for skills by query with relevance scoring
  const searchSkills = async (query: SkillSearchQuery): Promise<SkillSearchResult> => {
    if (!isTauri) return { matches: [], totalCount: 0, query: query.query }

    try {
      const result = await sendContextRequest<SkillSearchResult>('skills.search', query as unknown as Record<string, unknown>)
      return result || { matches: [], totalCount: 0, query: query.query }
    } catch (e) {
      console.error('[useSkills] searchSkills failed:', e)
      return { matches: [], totalCount: 0, query: query.query }
    }
  }

  // Quick search helper
  const findRelevantSkills = async (query: string, limit = 5): Promise<SkillMatch[]> => {
    const result = await searchSkills({ query, limit })
    return result.matches
  }

  // ============================================
  // Instruction-Style API
  // ============================================

  // Get instructions for a skill (markdown body as AI knowledge)
  const getInstructions = async (skillId?: string): Promise<string> => {
    if (!isTauri) return ''

    try {
      const result = await sendContextRequest<{ instructions: string }>('skills.instructions', skillId ? { skillId } : {})
      return result.instructions || ''
    } catch (e) {
      console.error('[useSkills] getInstructions failed:', e)
      return ''
    }
  }

  // Get skill formatted for AI consumption
  const formatForAI = async (skillId: string): Promise<string> => {
    if (!isTauri) return ''

    try {
      const result = await sendContextRequest<{ formatted: string }>('skills.format_for_ai', { skillId })
      return result.formatted || ''
    } catch (e) {
      console.error('[useSkills] formatForAI failed:', e)
      return ''
    }
  }

  return {
    // State
    skills: readonly(skills),
    hooks: readonly(hooks),
    isLoading: readonly(isLoading),
    error: readonly(error),

    // Skills (basic)
    listSkills,
    getSkill,
    loadSkill,
    unloadSkill,
    enableSkill,
    disableSkill,
    loadBuiltins,
    getSkillMetrics,

    // Hooks
    listHooks,
    getHooksByType,
    enableHook,
    disableHook,
    saveHook,
    deleteHook,
    getHookMetrics,

    // Progressive Loading
    getSummaries,
    getContent,

    // Relevance Search
    searchSkills,
    findRelevantSkills,

    // Instruction-Style
    getInstructions,
    formatForAI,

    // CRUD
    saveSkill,
    deleteSkill,

    // Utils
    refresh,
  }
}
