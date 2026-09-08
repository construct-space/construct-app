/**
 * Project types — local-first, no remote API
 */

export type SpaceType = 'builder' | 'space-developer' | 'editor' | 'code' | 'design' | 'git' | 'notes' | 'kanban' | 'terminal' | 'docs' | 'calendar' | 'ai' | 'chat' | string

export type SpaceScope = 'app' | 'org'

/**
 * "project"       → general dev, opens in Builder on click
 * "space-project" → Construct Space, opens in Space Developer on click
 * undefined       → legacy entries (behave as "project" for routing)
 */
export type ProjectKind = 'project' | 'space-project'

/**
 * Where the project record comes from — promotes the legacy `is_org`
 * boolean into a real enum so a third value (eg shared workspace) can
 * land later without breaking callers. 'local' = filesystem-only entry
 * managed by this app; 'org' = mirror of a row in source-api's
 * org_projects, identified by `org_project_id`.
 */
export type ProjectOrigin = 'local' | 'org'

export interface LocalProject {
  id: string | number  // Path slug (e.g., 'my-app') or numeric ID for backward compat
  name: string
  path: string        // Absolute filesystem path
  local_path?: string // Alias for path — backward compat with old code
  description?: string
  color?: string      // Hex color for project icon
  spaces: SpaceType[]
  kind?: ProjectKind   // Drives default-space routing. Nullable for legacy entries.
  /**
   * Where this project record comes from. Defaults to 'local' when omitted
   * (legacy entries written before this field existed). Prefer over
   * `is_org` in new code — `is_org` is kept as a deprecated alias.
   */
  origin?: ProjectOrigin
  last_opened_at?: string
  is_external: boolean // Not under projectsRoot
  /**
   * @deprecated Use `origin === 'org'` instead. Still written by older
   * code paths and still read by older consumers; new readers should
   * prefer `origin` and only fall through to this on undefined.
   */
  is_org?: boolean
  org_project_id?: string // ID in source org_projects table
  repo_url?: string    // Git repo URL for org projects
  framework?: string   // Detected framework
  created_at: string
  updated_at: string
}

/** True when the project mirrors a row from source-api's org_projects. */
export function isOrgProject(p: Pick<LocalProject, 'origin' | 'is_org'>): boolean {
  return p.origin === 'org' || p.is_org === true
}

export interface CreateProjectInput {
  name: string
  description?: string
  color?: string
  spaces?: SpaceType[]
  kind?: ProjectKind
}

export type UpdateProjectInput = Partial<CreateProjectInput>
