import type { AssistantTypeConfig } from '@/assistant/types'
import { normalizeArchitectOutput } from './normalizer'

export const architectAssistantConfig: AssistantTypeConfig = {
  id: 'architect',
  label: 'Architect',
  entryAgent: 'architect',
  renderMode: 'blocks',
  finalSchema: 'architect.v1',
  sessionScope: 'project',
  supportsAttachments: false,
  requiresProjectPath: false,
  usesPriorityRouting: false,
  source: 'builtin',
  normalizer: normalizeArchitectOutput,
}
