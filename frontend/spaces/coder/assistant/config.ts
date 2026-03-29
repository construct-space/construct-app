import type { AssistantTypeConfig } from '@/assistant/types'

export const coderAssistantConfig: AssistantTypeConfig = {
  id: 'coder',
  label: 'Coder',
  entryAgent: 'coder',
  renderMode: 'timeline',
  finalSchema: null,
  sessionScope: 'project',
  supportsAttachments: false,
  requiresProjectPath: true,
  usesPriorityRouting: false,
  source: 'builtin',
}
