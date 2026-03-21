/**
 * Architect Space Type Definitions
 */

export interface QuestionOption {
  value: string
  label: string
  icon?: string
  description?: string
}

export interface ParsedQuestion {
  id: string
  question: string
  options: QuestionOption[]
}

export interface PRDContent {
  name: string
  description: string
  markdown: string
}

export interface TaskItem {
  title: string
  description?: string
  priority?: 'high' | 'medium' | 'low'
  subtasks?: string[]
}

export interface ParsedContent {
  textBefore: string
  question: ParsedQuestion | null
  prd: PRDContent | null
  tasks: TaskItem[] | null
  textAfter: string
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface ProjectAction {
  type: 'create_task' | 'create_repo' | 'create_design' | 'create_project'
  data: Record<string, unknown>
  status: 'pending' | 'approved' | 'rejected' | 'completed'
}

export interface ArchitectAction {
  id: string
  type: 'kanban' | 'code' | 'design' | 'project'
  action: string
  description: string
  data: Record<string, unknown>
  requiresApproval: boolean
}
