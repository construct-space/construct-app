/**
 * Host-owned types shared across frontend code, the SDK re-exports, and
 * brain wire endpoints. Brain emits a subset (chat/tool stream chunks,
 * model lists); the rest are the public host shape used by provider
 * settings and space SDK consumers.
 *
 * If a brain wire endpoint starts emitting one of these types for real,
 * move the type next to that endpoint and keep this file the
 * cross-cutting hub.
 */

// ─── Providers & Models ───

export interface ProviderModel {
  id: string
  label: string
  capabilities?: string[]
  contextWindow?: number
  maxOutputTokens?: number
  inputCostPer1M?: number
  outputCostPer1M?: number
  default?: boolean
  deprecated?: boolean
  replacedBy?: string
  minAppVersion?: string
  /** Suggested tier slot for this model when first added by the user.
   *  Sourced from provider_catalog_models.tier_hint on the server.
   *  The desktop's per-provider tier map can override. */
  tierHint?: 'large' | 'medium' | 'small'
}

export interface ProviderApiKeyMode {
  enabled: boolean
  baseUrl?: string
  envKeys?: string[]
  docsUrl?: string
  signupUrl?: string
  hasSharedKey?: boolean
}

export interface ProviderMonthlyMode {
  enabled: boolean
  authType?: string
  baseUrl?: string
  oauthConfig?: Record<string, unknown>
  docsUrl?: string
  signupUrl?: string
}

export interface AIProvider {
  id: string
  label: string
  icon?: string
  authType?: 'oauth' | 'api' | 'local'
  active?: boolean
  models: ProviderModel[]
  slug?: string
  description?: string
  baseUrl?: string
  oauthConfig?: Record<string, unknown>
  envKeys?: string[]
  capabilities?: string[]
  docsUrl?: string
  signupUrl?: string
  hasSharedKey?: boolean
  orgManaged?: boolean
  minAppVersion?: string
  apiKey?: ProviderApiKeyMode
  monthly?: ProviderMonthlyMode
}

export interface ProvidersResponse {
  providers: AIProvider[]
  default: string
  defaultProvider?: string
  defaultModel?: string
}

// ─── Agents ───

export interface OperatorAgent {
  id: string
  name: string
  description: string
  category: 'primary' | 'specialist' | 'space'
}

// ─── Dispatch & Chat (legacy stream contract) ───

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

// ─── Streaming (legacy operator chunk shape) ───

export interface StreamEvent {
  content: string
  done: boolean
  error?: string
  requestId?: string
  type?: string
  data?: Record<string, unknown>
}

// ─── Stream-status telemetry types ───
// Brain does not emit these yet. Components that bind to them are hidden
// in space-developer until brain adds context/cost reporting.

export interface ContextInfo {
  totalChars: number
  charLimit: number
  charPct: number
  estimatedTokens: number
  tokenLimit: number
  tokenPct: number
  totalMessages: number
  wastedChars: number
  warning: boolean
  critical: boolean
}

export interface CostInfo {
  costUSD: number
  budgetUSD: number
  usedPct: number
  warning: boolean
  exceeded: boolean
  totalTokens: number
  inputTokens: number
  outputTokens: number
  cacheRead: number
  cacheWrite: number
  cacheHitRate: number
  inputCostUSD: number
  outputCostUSD: number
  cacheReadCostUSD: number
  cacheWriteCostUSD: number
}

export type PermissionModeValue = 'default' | 'yolo' | 'strict' | 'ask'

const LEGACY_MODE_MAP: Record<string, PermissionModeValue> = {
  bypass: 'yolo',
  accept_edits: 'default',
  plan: 'strict',
  dont_ask: 'strict',
  auto: 'ask',
}

export function normalizePermissionMode(value: unknown): PermissionModeValue {
  if (typeof value !== 'string') return 'default'
  if (value === 'default' || value === 'yolo' || value === 'strict' || value === 'ask') return value
  return LEGACY_MODE_MAP[value] || 'default'
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

// ─── Stream-event shapes (used by spaces consuming the SDK contract) ───

export interface ToolCallEvent {
  type: 'tool_call'
  call_id: string
  tool: string
  input: string
}

export interface ToolResultEvent {
  type: 'tool_result'
  call_id: string
  tool: string
  result: string
  is_error?: boolean
}

export interface StatusEvent {
  type: 'status'
  state: string
  message: string
  tool?: string
  call_id?: string
}

export interface TurnStartEvent {
  type: 'turn_start'
  turn: number
}

export interface TurnEndEvent {
  type: 'turn_end'
  turn: number
}

export interface TextEvent {
  type: 'text'
  content: string
}

export interface DoneEvent {
  type: 'done'
  agent_id?: string
  session_id?: string
  stop_reason?: string
}
