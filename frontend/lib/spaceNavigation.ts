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

/**
 * Pick the router base for this window's shell. Preview windows route
 * space paths as `/preview/<id>/…` (lightweight shell), runner windows
 * use `/runner/<id>/…`, the main app uses `/app/<id>/…`. A space calling
 * `navigateToSpace({ spaceId: 'pm', page: 'board' })` must land inside
 * its current shell, not be punted to /app.
 *
 * Detected off the current route hash so every window sees its own
 * context; no cross-window state needed.
 */
function currentShellBase(): 'app' | 'preview' | 'runner' {
  if (typeof window === 'undefined') return 'app'
  const hash = window.location.hash.replace(/^#/, '')
  if (hash.startsWith('/preview/')) return 'preview'
  if (hash.startsWith('/runner')) return 'runner'
  return 'app'
}

export function resolveSpacePath(location: SpaceLocation): string {
  const shell = currentShellBase()
  // Preview + runner shells don't have a /projects/<id>/<spaceId>
  // nesting — their routes are a flat /preview/<spaceId>/<page>.
  const base = shell === 'app' && location.projectId != null
    ? `/app/projects/${encodeURIComponent(String(location.projectId))}/${encodeURIComponent(location.spaceId)}`
    : `/${shell}/${encodeURIComponent(location.spaceId)}`

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
  const currentRoute = router.currentRoute.value
  const ownQuery = normalizeLocationQuery(location.query) ?? {}

  // Preview + runner shells carry their IIFE source in `?dir=` and the
  // parent project in `?project=`. Preserve those through in-shell
  // navigations — otherwise the next page re-mounts with a blank
  // spaceName and the shell shows "Space not found".
  const preservedQuery: Record<string, string> = {}
  const rawDir = currentRoute.query.dir
  const rawProject = currentRoute.query.project
  if (typeof rawDir === 'string' && rawDir && !ownQuery.dir) {
    preservedQuery.dir = rawDir
  }
  if (typeof rawProject === 'string' && rawProject && !ownQuery.project) {
    preservedQuery.project = rawProject
  }

  const target = {
    path: resolveSpacePath(location),
    query: { ...preservedQuery, ...ownQuery },
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
