import { getAssistantType } from './registry'
import type { AssistantTypeConfig } from './types'

export function resolveAssistantType(input: { surface: string }): string {
  const surfaceMap: Record<string, string> = {
    'assistant-panel': 'general',
    'architect-page': 'architect',
    'coder-page': 'coder',
    'brainstorm-page': 'brainstorm',
  }
  return surfaceMap[input.surface] || 'general'
}

export function getAssistantConfig(surface: string): AssistantTypeConfig | undefined {
  const typeId = resolveAssistantType({ surface })
  return getAssistantType(typeId)
}
