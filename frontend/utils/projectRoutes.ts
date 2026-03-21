export interface ProjectRouteCandidate {
  id?: string | number | null
  name?: string | null
  path?: string | null
}

export const slugifyProjectToken = (value: string): string => {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

export const buildProjectId = (value: string, isExternal = false): string => {
  const slug = slugifyProjectToken(value) || 'project'
  return isExternal ? `ext-${slug}` : slug
}

const normalizeRouteId = (value: string): string => {
  const normalized = slugifyProjectToken(value)
  if (!normalized) return ''
  return normalized.startsWith('ext-') ? normalized.replace(/^ext-/, '') : normalized
}

export const routeParamString = (value: unknown): string => {
  if (typeof value === 'string') return value
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0]
  return ''
}

export const getProjectRouteKey = (project: ProjectRouteCandidate): string => {
  // 1. Prefer explicit id (strip ext- prefix)
  if (project.id !== undefined && project.id !== null && String(project.id).trim()) {
    const fromId = normalizeRouteId(String(project.id))
    if (fromId) return fromId
  }

  // 2. Fall back to slugified name
  const fromName = slugifyProjectToken(project.name || '')
  if (fromName) return fromName

  // 3. Fall back to path segment (directory name)
  const pathSegment = (project.path || '').split('/').filter(Boolean).pop() || ''
  const fromPath = normalizeRouteId(pathSegment)
  if (fromPath) return fromPath

  return 'project'
}

export const buildProjectRoutePath = (project: ProjectRouteCandidate): string => {
  return `/app/projects/${encodeURIComponent(getProjectRouteKey(project))}`
}

const collectLookupTokens = (value: string, into: Set<string>) => {
  if (!value) return
  const raw = String(value)
  const rawNoExt = raw.replace(/^ext-/, '')
  const slug = slugifyProjectToken(raw)
  const slugNoExt = slug.replace(/^ext-/, '')
  into.add(raw)
  into.add(rawNoExt)
  if (slug) into.add(slug)
  if (slugNoExt) into.add(slugNoExt)
}

export const projectMatchesLookup = (
  project: ProjectRouteCandidate,
  lookup: string,
): boolean => {
  if (!lookup) return false

  const lookupTokens = new Set<string>()
  collectLookupTokens(lookup, lookupTokens)

  const candidateTokens = new Set<string>()
  collectLookupTokens(String(project.id || ''), candidateTokens)
  collectLookupTokens(project.name || '', candidateTokens)
  collectLookupTokens((project.path || '').split('/').filter(Boolean).pop() || '', candidateTokens)
  collectLookupTokens(buildProjectId(String(project.name || ''), true), candidateTokens)
  collectLookupTokens(buildProjectId(String(project.name || ''), false), candidateTokens)
  collectLookupTokens(getProjectRouteKey(project), candidateTokens)

  for (const token of lookupTokens) {
    if (candidateTokens.has(token)) return true
  }
  return false
}
