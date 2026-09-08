import { getAssistantType } from './registry'
import type { AssistantTypeConfig } from './types'

export function resolveAssistantType(input: { surface: string }): string {
  const surfaceMap: Record<string, string> = {
    'assistant-panel': 'construct',
  }
  return surfaceMap[input.surface] || 'construct'
}

export function getAssistantConfig(surface: string): AssistantTypeConfig | undefined {
  const typeId = resolveAssistantType({ surface })
  return getAssistantType(typeId)
}
