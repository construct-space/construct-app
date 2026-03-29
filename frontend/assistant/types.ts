export type AssistantTypeId = string
export type BuiltinAssistantTypeId = 'general' | 'brainstorm' | 'architect' | 'coder'

export type NormalizerFn = (raw: unknown) => import('./blocks').ResponseBlock[]

// Re-export CustomBlock from blocks.ts (single source of truth)
export type { CustomBlock } from './blocks'

export interface AssistantTypeConfig {
  id: AssistantTypeId
  label: string
  entryAgent: string
  renderMode: 'blocks' | 'timeline' | 'custom'
  customRenderer?: string
  finalSchema: string | null
  sessionScope: 'global' | 'assistant' | 'project'
  supportsAttachments: boolean
  requiresProjectPath: boolean
  usesPriorityRouting: boolean
  source: 'builtin' | `space:${string}`
  normalizer?: NormalizerFn // per-type LLM output → blocks
}
