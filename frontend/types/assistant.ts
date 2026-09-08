/**
 * Shared types for the AI Assistant system.
 *
 * Extracted from AssistantFloat.vue to be reusable across
 * assistant composables and components.
 */

// DocumentListItem — inline to avoid importing the domain store
export interface DocumentListItem {
  id: number
  created_at: string
  updated_at: string
  title: string
  type: string
  project_id?: number
}

// Stub types for space composables provided at runtime by IIFE bundles
export interface FileTreeEntry {
  name: string
  path: string
  isDirectory: boolean
  children?: FileTreeEntry[]
}

export interface GitChange { path: string; status?: string }
export interface GitCommit { shortHash?: string; subject?: string; author?: string; message?: string }
export interface GitRepoInfo { name?: string; status?: string; remoteUrl?: string; hasUpstream?: boolean; ahead?: number; behind?: number }
export interface TaskCacheItem { id: number | string; title: string; status: string; priority?: number | string }
export interface DocCacheItem { content: string; title: string; type: string; id: number | string }

// Conductor question option
export interface ConductorOption {
  label: string
  value: string
  description?: string
}

// Conductor question for structured choices
export interface ConductorQuestion {
  type: 'question'
  question: string
  options: ConductorOption[]
  allowMultiple?: boolean
  allowOther?: boolean
}

// Tool call display for Claude-like UI
export interface ToolCallDisplay {
  id: string
  name: string
  arguments: Record<string, unknown>
  status: 'calling' | 'completed' | 'error'
  result?: string
  expanded: boolean
  startTime: number
  endTime?: number
  durationMs?: number // Server-measured duration (from Go-side timing)
}

// Image search result for clickable placement
export interface SearchImageResult {
  url: string
  thumb: string
  description: string
  credit: string
  width: number
  height: number
}

// Chat message with rendered HTML cache
export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  thinking?: string
  renderedHtml?: string
  conductorQuestion?: ConductorQuestion
  selectedOptions?: string[]
  imageUrl?: string // Base64 data URL for attached images
  toolCalls?: ToolCallDisplay[]
  searchImages?: SearchImageResult[]
  statusText?: string // Live progress status
}

// Intent analysis from conductor
export interface IntentAnalysis {
  primary_agent: string
  secondary_agents?: string[]
  reasoning: string
  confidence: number
  keywords?: string[]
}

// Project file structure for !autocomplete
export interface ProjectFile {
  name: string
  path: string
  type: 'file' | 'directory'
}

// Panel position type
export type PanelPosition = 'bottom-center' | 'left' | 'right' | 'bottom' | 'floating'

// Type for AI conversation response
export interface AIConversationResponse {
  conversations?: Array<{
    context_key: string
    messages_json: string
    user_id: number
  }>
}
