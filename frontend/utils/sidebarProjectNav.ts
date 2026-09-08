export interface ProjectRouteContext {
  projectId: string
  spaceName: string
  subPage: string
}

export interface SpacePageLike {
  path: string
  label?: string
  icon?: string
}

export interface SpaceLike {
  name: string
  pages?: SpacePageLike[]
}

import { routeParamString } from '@/utils/projectRoutes'

export interface SidebarSubItem {
  id: string
  label: string
  icon: string
  route: string
}

export const parseProjectRouteContext = (params: {
  projectId?: unknown
  spaceName?: unknown
  subPage?: unknown
}): ProjectRouteContext | null => {
  const projectId = routeParamString(params.projectId)
  const spaceName = routeParamString(params.spaceName)
  const subPage = routeParamString(params.subPage)
  if (!projectId || !spaceName) return null
  return { projectId, spaceName, subPage }
}

export const buildProjectSpaceSubItems = (
  spaces: SpaceLike[],
  context: ProjectRouteContext | null,
): SidebarSubItem[] => {
  if (!context) return []

  const activeSpace = spaces.find(space => space.name === context.spaceName)
  if (!activeSpace?.pages?.length) return []

  const seen = new Set<string>()
  return activeSpace.pages
    .filter(page => Boolean(page.path))
    .map((page) => {
      const pagePath = page.path || ''
      const route = `/app/projects/${context.projectId}/${context.spaceName}/${pagePath}`
      return {
        id: pagePath,
        label: page.label || pagePath,
        icon: page.icon || 'i-lucide-circle',
        route,
      }
    })
    .filter((item) => {
      if (seen.has(item.route)) return false
      seen.add(item.route)
      return true
    })
}

export const isProjectRoutePath = (path: string): boolean => {
  return /^\/app\/projects\/[^/]+(?:\/.*)?$/.test(path)
}
