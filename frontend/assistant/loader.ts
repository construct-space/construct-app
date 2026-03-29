import type { AssistantTypeConfig } from './types'
import { registerAssistantType, unregisterAssistantTypesBySource } from './registry'
import { registerBlockRenderer } from './renderers'
import { coderAssistantConfig } from '@/spaces/coder/assistant'
import { architectAssistantConfig } from '@/spaces/architect/assistant'
import { brainstormAssistantConfig } from '@/spaces/brainstorm/assistant'

export function loadCoreAssistantTypes() {
  registerAssistantType(coderAssistantConfig)
  registerAssistantType(architectAssistantConfig)
  registerAssistantType(brainstormAssistantConfig)
}

export function registerCoreBlockRenderers() {
  // Lazy imports avoid pulling .vue files into the module graph at load time,
  // which would break test environments that lack a Vue compiler plugin.
  registerBlockRenderer('architect:questions', () => import('@/spaces/architect/components/ArchitectQuestionsBlock.vue'))
  registerBlockRenderer('architect:plan', () => import('@/spaces/architect/components/ArchitectPlanBlock.vue'))
  registerBlockRenderer('architect:progress', () => import('@/spaces/architect/components/ArchitectProgressBlock.vue'))
}

interface SpaceManifestAssistant {
  id?: string
  label?: string
  entryAgent?: string
  renderMode?: 'blocks' | 'timeline' | 'custom'
  customRenderer?: string
  finalSchema?: string | null
  sessionScope?: 'global' | 'assistant' | 'project'
  supportsAttachments?: boolean
  requiresProjectPath?: boolean
}

export function loadSpaceAssistantTypes(spaces: Array<{ id: string; manifest: { assistant?: SpaceManifestAssistant } }>) {
  for (const space of spaces) {
    if (!space.manifest.assistant) continue
    const config = space.manifest.assistant
    const source = `space:${space.id}` as AssistantTypeConfig['source']

    // Unregister previous version on reload
    unregisterAssistantTypesBySource(source)

    registerAssistantType({
      id: config.id || space.id,
      label: config.label || space.id,
      entryAgent: config.entryAgent || `space:${space.id}`,
      renderMode: config.renderMode || 'blocks',
      finalSchema: null, // v1: space types don't get structured output
      sessionScope: config.sessionScope || 'assistant',
      supportsAttachments: config.supportsAttachments ?? false,
      requiresProjectPath: config.requiresProjectPath ?? false,
      usesPriorityRouting: false,
      source,
      customRenderer: config.customRenderer,
    })
  }
}
