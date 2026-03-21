/**
 * Project types — local-first, no remote API
 */

export type SpaceType = 'code' | 'design' | 'git' | 'notes' | 'kanban' | 'architect' | 'terminal' | 'docs' | 'calendar' | 'ai' | 'chat'

export type SpaceScope = 'app' | 'project' | 'both'

/** Spaces that only exist inside a project context */
export const PROJECT_SCOPED_SPACES: SpaceType[] = [
  'code', 'design', 'git', 'kanban', 'docs', 'notes', 'terminal', 'calendar'
]

/** Spaces that live at the app/global level */
export const APP_SCOPED_SPACES: string[] = [
  'projects', 'chat', 'ai', 'settings', 'marketplace'
]

/** Spaces that appear in both scopes */
export const BOTH_SCOPED_SPACES: SpaceType[] = [
  'architect'
]

export interface LocalProject {
  id: string | number  // Path slug (e.g., 'my-app') or numeric ID for backward compat
  name: string
  path: string        // Absolute filesystem path
  local_path?: string // Alias for path — backward compat with old code
  description?: string
  spaces: SpaceType[]
  last_opened_at: string
  is_external: boolean // Not under projectsRoot
  created_at: string
  updated_at: string
}

export interface CreateProjectInput {
  name: string
  description?: string
  spaces?: SpaceType[]
}

export type UpdateProjectInput = Partial<CreateProjectInput>
