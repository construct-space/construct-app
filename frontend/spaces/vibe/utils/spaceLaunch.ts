import { buildProjectRoutePath, type ProjectRouteCandidate } from '@/utils/projectRoutes'
import type { VibeHandoff } from '../../architect/utils/vibeHandoff'

export function isConstructSpaceHandoff(handoff: VibeHandoff | null | undefined): boolean {
  return handoff?.plan?.type === 'construct-space' && !!handoff.plan?.spaceId?.trim()
}

export function buildConstructSpaceDevRoute(input: {
  handoff: VibeHandoff | null | undefined
  routeProjectId?: string | null
  project?: ProjectRouteCandidate | null
}): string {
  if (!isConstructSpaceHandoff(input.handoff)) return ''

  const spaceId = input.handoff?.plan?.spaceId?.trim()
  if (!spaceId) return ''

  const routeProjectId = (input.routeProjectId || input.handoff?.projectId || '').trim()
  if (routeProjectId) {
    return `/app/projects/${encodeURIComponent(routeProjectId)}/${encodeURIComponent(spaceId)}`
  }

  if (input.project) {
    return `${buildProjectRoutePath(input.project)}/${encodeURIComponent(spaceId)}`
  }

  return ''
}
