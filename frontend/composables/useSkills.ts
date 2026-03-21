/**
 * useSkills - Manage skills and hooks via context service
 *
 * Features:
 * - Progressive loading: summaries first, full content on-demand
 * - Relevance search: find skills by keywords/query
 * - Instruction-style: get skill knowledge for AI context
 */
import { invoke } from '@tauri-apps/api/core'

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
}

export interface HookInfo {
  id: string
  name: string
  type: string
  priority: number
  skillId?: string
  enabled: boolean
  description?: string
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

  const isTauri = typeof window !== 'undefined' && '__TAURI__' in window

  // List all skills
  const listSkills = async () => {
    if (!isTauri) return
    isLoading.value = true
    error.value = null

    try {
      const result = await invoke<{ skills: SkillInfo[] }>('send_context_request', {
        requestType: 'skills.list',
        payload: {},
      })
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
      const result = await invoke<{ skill: SkillInfo }>('send_context_request', {
        requestType: 'skills.get',
        payload: { id: skillId },
      })
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
      await invoke('send_context_request', {
        requestType: 'skills.load',
        payload: { id: skillId },
      })
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
      await invoke('send_context_request', {
        requestType: 'skills.unload',
        payload: { id: skillId },
      })
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
      await invoke('send_context_request', {
        requestType: 'skills.enable',
        payload: { id: skillId },
      })
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
      await invoke('send_context_request', {
        requestType: 'skills.disable',
        payload: { id: skillId },
      })
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
      await invoke('send_context_request', {
        requestType: 'skills.load_builtins',
        payload: {},
      })
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
      const result = await invoke<{ metrics: SkillMetrics[] }>('send_context_request', {
        requestType: 'skills.metrics',
        payload: {},
      })
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
      const result = await invoke<{ hooks: HookInfo[] }>('send_context_request', {
        requestType: 'hooks.list',
        payload: {},
      })
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
      const result = await invoke<{ hooks: HookInfo[] }>('send_context_request', {
        requestType: 'hooks.by_type',
        payload: { type: hookType },
      })
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
      await invoke('send_context_request', {
        requestType: 'hooks.enable',
        payload: { id: hookId },
      })
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
      await invoke('send_context_request', {
        requestType: 'hooks.disable',
        payload: { id: hookId },
      })
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
      const result = await invoke<{ metrics: HookMetrics[] }>('send_context_request', {
        requestType: 'hooks.metrics',
        payload: {},
      })
      return result.metrics || []
    } catch (e) {
      console.error('[useSkills] getHookMetrics failed:', e)
      return []
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
      const result = await invoke<{ summaries: SkillSummary[] }>('send_context_request', {
        requestType: 'skills.summaries',
        payload: {},
      })
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
      const result = await invoke<{ content: SkillContent }>('send_context_request', {
        requestType: 'skills.content',
        payload: { skillId },
      })
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
      const result = await invoke<SkillSearchResult>('send_context_request', {
        requestType: 'skills.search',
        payload: query,
      })
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
      const result = await invoke<{ instructions: string }>('send_context_request', {
        requestType: 'skills.instructions',
        payload: skillId ? { skillId } : {},
      })
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
      const result = await invoke<{ formatted: string }>('send_context_request', {
        requestType: 'skills.format_for_ai',
        payload: { skillId },
      })
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

    // Utils
    refresh,
  }
}
