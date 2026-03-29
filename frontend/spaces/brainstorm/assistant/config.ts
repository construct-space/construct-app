import type { AssistantTypeConfig } from '@/assistant/types'

export const brainstormAssistantConfig: AssistantTypeConfig = {
  id: 'brainstorm',
  label: 'Brainstorm',
  entryAgent: 'brainstorm',
  renderMode: 'blocks',
  finalSchema: 'assistant.v1',
  sessionScope: 'assistant',
  supportsAttachments: false,
  requiresProjectPath: false,
  usesPriorityRouting: false,
  source: 'builtin',
}
