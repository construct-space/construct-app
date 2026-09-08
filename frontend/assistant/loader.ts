import type { AssistantTypeConfig } from './types'
import { registerAssistantType, unregisterAssistantTypesBySource } from './registry'
import { brainstormAssistantConfig } from '~/spaces/ask/assistant'
import { z } from 'zod'

export function loadCoreAssistantTypes() {
  registerAssistantType(brainstormAssistantConfig)
}

export function registerCoreBlockRenderers() {
  // No core block renderers currently — architect/coder used to register
  // their own here; builder + space-developer manage their own blocks
  // inline via their BlockRenderer.vue components.
}

const spaceManifestAssistantSchema = z.object({
  id: z.string().trim().min(1).optional(),
  label: z.string().trim().min(1).optional(),
  entryAgent: z.string().trim().min(1).optional(),
  renderMode: z.enum(['blocks', 'timeline', 'custom']).optional(),
  customRenderer: z.string().trim().min(1).optional(),
  finalSchema: z.string().nullable().optional(),
  sessionScope: z.enum(['global', 'assistant', 'project']).optional(),
  supportsAttachments: z.boolean().optional(),
  requiresProjectPath: z.boolean().optional(),
}).refine(
  assistant => assistant.renderMode !== 'custom' || !!assistant.customRenderer,
  { path: ['customRenderer'], message: 'custom renderMode requires customRenderer' },
)

export function loadSpaceAssistantTypes(spaces: Array<{ id: string; manifest: { assistant?: unknown } }>) {
  for (const space of spaces) {
    const source = `space:${space.id}` as AssistantTypeConfig['source']

    // Unregister previous version on reload, including manifests that removed
    // or invalidated their assistant config.
    unregisterAssistantTypesBySource(source)
    if (!space.manifest.assistant) continue

    const parsed = spaceManifestAssistantSchema.safeParse(space.manifest.assistant)
    if (!parsed.success) {
      console.warn(`[assistant] Ignoring invalid assistant manifest for space "${space.id}"`, parsed.error.issues)
      continue
    }

    const config = parsed.data

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
