// Type declarations for Context Service API (Tauri)

export type Mode = 'code' | 'design'

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

export interface ProjectContext {
  name: string
  type: string
  rootPath: string
  framework: string
  uiLibrary?: string
  styleSystem?: string
  components?: string[]
}

export interface SelectionContext {
  type: 'element' | 'text' | 'code'
  content?: string
  elementId?: string
  startLine?: number
  endLine?: number
}

export interface Context {
  mode: Mode
  component?: ComponentContext
  project?: ProjectContext
  selection?: SelectionContext
  timestamp: string
}

export interface Tool {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: {
      type: string
      properties: Record<string, { type: string; description: string; enum?: string[] }>
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
  tool_call_id: string
  content: string
  is_error?: boolean
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface ChatRequest {
  model: string
  messages: ChatMessage[]
  stream?: boolean
  token?: string
  local_data?: Record<string, unknown>
  include_space_context?: boolean
}

export interface StreamChunk {
  content: string
  done: boolean
  error?: string
  type?: 'stream' | 'tool_status'  // tool_status messages should be filtered from chat
}

export interface ChatResponse {
  message: {
    role: string
    content: string
  }
  done: boolean
}

export interface OllamaModel {
  name: string
  modified_at: string
  size: number
}

export interface ContextServiceApi {
  // Context operations
  getContext: () => Promise<Context>
  setMode: (mode: Mode) => Promise<void>
  setComponent: (component: ComponentContext) => Promise<void>
  setProject: (project: ProjectContext) => Promise<void>
  setSelection: (selection: SelectionContext) => Promise<void>

  // Tool operations
  getTools: () => Promise<Tool[]>
  callTool: (toolCall: ToolCall) => Promise<ToolResult>

  // System operations
  ping: () => Promise<{ pong: boolean; timestamp: number }>
  getInfo: () => Promise<{
    version: string
    socketPath: string
    ollamaHost: string
    platform: string
    arch: string
  }>

  // Connection status
  isConnected: () => Promise<boolean>

  // Chat operations
  chat: (request: ChatRequest) => Promise<ChatResponse>
  chatStream: (request: { model: string; messages: Array<{ role: string; content: string }>; token?: string }) => Promise<{ streaming: boolean; requestId: string }>
  listModels: () => Promise<{ models: OllamaModel[] }>

  // Event listeners
  onContextChanged: (callback: (context: Context) => void) => () => void
  onBroadcast: (callback: (message: { type: string; data: unknown }) => void) => () => void
  onStreamChunk: (callback: (chunk: StreamChunk) => void) => () => void
}

// ============================================================================
// Space Context Types (for cross-space AI context aggregation)
// ============================================================================

export interface SpaceContextProject {
  id: string | number
  name: string
  description: string
  spaces: string[]
  localPath?: string
}

export interface SpaceContextCode {
  currentFile: string | null
  language: string | null
  selectedText: string | null
  openFiles: string[]
  filePreview: string | null
}

export interface SpaceContextUI {
  selectedNodes: string[]
  canvasNodeCount: number
  currentPage: string | null
  hasUnsavedChanges: boolean
}

export interface SpaceContextTasks {
  total: number
  byStatus: Record<string, number>
  activeTask: { id: number; title: string; description: string } | null
  recentTasks: { id: number; title: string; status: string }[]
}

export interface SpaceContextNotes {
  count: number
  recentNotes: { id: number; content: string; color: string }[]
}

export interface SpaceContextGit {
  currentBranch: string | null
  hasUncommittedChanges: boolean
  recentCommits: string[]
}

export interface SpaceContextDocs {
  count: number
  documents?: { title: string; type?: string; filename?: string }[]
  activeDocument: { id: number; title: string; content: string } | null
}

export interface SpaceContext {
  activeSpace: string
  project: SpaceContextProject | null
  code: SpaceContextCode
  ui: SpaceContextUI
  tasks: SpaceContextTasks
  notes: SpaceContextNotes
  git: SpaceContextGit
  docs: SpaceContextDocs
}

declare global {
  interface Window {
    contextService: ContextServiceApi
  }
}
