import type { AssistantTypeConfig } from '@/assistant/types'

export const brainstormAssistantConfig: AssistantTypeConfig = {
  id: 'ask',
  label: 'Ask',
  entryAgent: 'ask',
  renderMode: 'blocks',
  finalSchema: 'assistant.v1',
  sessionScope: 'assistant',
  supportsAttachments: false,
  requiresProjectPath: false,
  usesPriorityRouting: false,
  source: 'builtin',
}
