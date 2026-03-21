/** Operator protocol types — matches construct-operator/internal/ */

// ─── Providers & Models ───

export interface ProviderModel {
  id: string
  label: string
}

export interface AIProvider {
  id: string
  label: string
  icon?: string
  authType?: 'oauth' | 'api' | 'local'
  models: ProviderModel[]
}

export interface ProvidersResponse {
  providers: AIProvider[]
  default: string
  defaultProvider?: string
  defaultModel?: string
}

/** Simplified provider shape from operator (subset of AIProvider) */
export interface OperatorProvider {
  id: string
  models: string[]
}

// ─── Agents ───

export interface OperatorAgent {
  id: string
  name: string
  description: string
  category: 'primary' | 'specialist' | 'space'
}

// ─── Dispatch & Chat ───

export interface DispatchResult {
  agent_id: string
  session_id: string
  content: string
  turns: number
  usage: { input_tokens: number; output_tokens: number }
  stop_reason: string
}

export interface ChatResult {
  content: string
  turns: number
  stop_reason: string
}

// ─── Tools ───

export interface Tool {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: {
      type: string
      properties: Record<string, {
        type: string
        description?: string
        enum?: string[]
        items?: Record<string, unknown>
        properties?: Record<string, unknown>
      }>
      required?: string[]
    }
  }
}

export interface ToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

export interface ToolResult {
  content: string
  is_error: boolean
  tool_call_id?: string
}

// ─── Streaming ───

export interface StreamEvent {
  content: string
  done: boolean
  error?: string
  requestId?: string
  type?: string
  data?: Record<string, unknown>
}

// ─── Context ───

export type Mode = 'code' | 'ui'

export interface ProjectContext {
  name: string
  type: string
  rootPath: string
  framework: string
  uiLibrary?: string
  styleSystem?: string
  components?: string[]
}

export interface ComponentContext {
  name: string
  type: string
  filePath?: string
  framework?: string
  props?: Record<string, unknown>
  styles?: Record<string, string>
  children?: string[]
  parentName?: string
}

// ─── System ───

export interface SystemInfo {
  version: string
  workDir: string
}
