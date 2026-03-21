export interface VibeSessionProjectRef {
  id?: string
  session_id?: string
  project_id?: string
  project_path?: string
  project_name?: string
}

export function normalizeVibeProjectPath(value?: string): string {
  if (!value) return ''
  const trimmed = value.trim()
  if (!trimmed || trimmed === '/') return trimmed
  return trimmed.replace(/\/+$/g, '')
}

export function getVibeSessionProjectKey(session: VibeSessionProjectRef): string {
  const projectId = session.project_id?.trim()
  if (projectId) return `project:${projectId}`

  const projectPath = normalizeVibeProjectPath(session.project_path)
  if (projectPath) return `path:${projectPath}`

  const projectName = session.project_name?.trim()
  if (!projectName) return 'global'

  const sessionId = session.id?.trim() || session.session_id?.trim()
  if (sessionId) return `session:${sessionId}`

  return `name:${projectName.toLowerCase()}`
}

export function sameVibeSessionProject(
  left: VibeSessionProjectRef,
  right: VibeSessionProjectRef,
): boolean {
  return getVibeSessionProjectKey(left) === getVibeSessionProjectKey(right)
}
