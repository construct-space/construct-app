import type { AssistantTypeConfig } from './types'

const registry = new Map<string, AssistantTypeConfig>()

export function registerAssistantType(config: AssistantTypeConfig) {
  registry.set(config.id, config)
}

export function getAssistantType(id: string): AssistantTypeConfig | undefined {
  return registry.get(id)
}

export function listAssistantTypes(): AssistantTypeConfig[] {
  return [...registry.values()]
}

export function unregisterAssistantTypesBySource(source: AssistantTypeConfig['source']) {
  for (const [id, config] of registry.entries()) {
    if (config.source === source) registry.delete(id)
  }
}

// Construct is the only builtin without a space — registered here.
// Marketplace spaces register their own assistant types alongside it.
registerAssistantType({
  id: 'construct',
  label: 'Construct',
  entryAgent: 'construct',
  renderMode: 'blocks',
  finalSchema: 'assistant.v1',
  sessionScope: 'global',
  supportsAttachments: true,
  requiresProjectPath: false,
  usesPriorityRouting: true,
  source: 'builtin',
})
