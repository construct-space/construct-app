import {
  CONTEXT_SOURCE_SPACE_QUERY_KEY,
  CONTEXT_TARGET_QUERY_KEY,
  type ContextTarget,
  type SpaceLocation,
  type SpaceNavigationMode,
  encodeContextTarget,
} from './contextMenuTypes'

export interface SpaceOpenRequest {
  spaceId: string
  page?: string
  projectId?: string | number
  sourceSpace?: string
  target: ContextTarget
  query?: Record<string, string | number | boolean>
}

export type SpaceOpenHandler = (
  request: SpaceOpenRequest,
) => SpaceLocation | void | Promise<SpaceLocation | void>

const spaceOpenHandlers = new Map<string, Set<SpaceOpenHandler>>()

export function registerSpaceOpenHandler(spaceId: string, handler: SpaceOpenHandler): () => void {
  const handlers = spaceOpenHandlers.get(spaceId) ?? new Set<SpaceOpenHandler>()
  handlers.add(handler)
  spaceOpenHandlers.set(spaceId, handlers)

  return () => {
    const current = spaceOpenHandlers.get(spaceId)
    if (!current) return
    current.delete(handler)
    if (current.size === 0) {
      spaceOpenHandlers.delete(spaceId)
    }
  }
}

export function resolveSpacePath(location: SpaceLocation): string {
  const base = location.projectId != null
    ? `/app/projects/${encodeURIComponent(String(location.projectId))}/${encodeURIComponent(location.spaceId)}`
    : `/app/${encodeURIComponent(location.spaceId)}`

  if (!location.page) return base

  return `${base}/${encodeURIComponent(location.page)}`
}

export function buildSpaceOpenLocation(request: SpaceOpenRequest): SpaceLocation {
  const query: Record<string, string | number | boolean> = {
    ...(request.query ?? {}),
    [CONTEXT_TARGET_QUERY_KEY]: encodeContextTarget(request.target),
  }

  if (request.sourceSpace) {
    query[CONTEXT_SOURCE_SPACE_QUERY_KEY] = request.sourceSpace
  }

  return {
    spaceId: request.spaceId,
    page: request.page,
    projectId: request.projectId ?? request.target.projectId,
    query,
  }
}

export async function navigateToSpace(
  location: SpaceLocation,
  mode: SpaceNavigationMode = 'push',
): Promise<void> {
  const { router } = await import('../router')
  const target = {
    path: resolveSpacePath(location),
    query: normalizeLocationQuery(location.query),
  }

  if (mode === 'replace') {
    await router.replace(target)
    return
  }

  await router.push(target)
}

export async function openTargetInSpace(
  request: SpaceOpenRequest,
  mode: SpaceNavigationMode = 'push',
): Promise<void> {
  let location = buildSpaceOpenLocation(request)
  const handlers = Array.from(spaceOpenHandlers.get(request.spaceId) ?? [])

  for (const handler of handlers) {
    const resolved = await handler(request)
    if (resolved) {
      location = resolved
      break
    }
  }

  await navigateToSpace(location, mode)
}

function normalizeLocationQuery(
  query?: Record<string, string | number | boolean>,
): Record<string, string> | undefined {
  if (!query) return undefined

  const normalized = Object.entries(query).reduce<Record<string, string>>((result, [key, value]) => {
    result[key] = String(value)
    return result
  }, {})

  return Object.keys(normalized).length > 0 ? normalized : undefined
}
