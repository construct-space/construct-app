/**
 * Space Type System — the canonical contract for Construct spaces.
 *
 * Spaces come in two kinds:
 *
 * 1. **host-native** — Ship with the app binary. Their page components are
 *    compiled into the frontend bundle (Vite tree-shakes them in). They have
 *    explicit routes in `router/routes.ts` and their manifests live in
 *    `frontend/spaces/{id}/manifest.json`. They are registered in
 *    `space_loader/coreSpaces.ts` and loaded synchronously — no IIFE eval,
 *    no checksum verification, no disk I/O at runtime.
 *
 * 2. **dynamic** — Installed from the marketplace or linked via `construct dev`.
 *    Their IIFE bundles live in the user's app data directory. They are loaded
 *    at runtime by `SpaceLoader.loadSpaceFromDisk()`, verified against a
 *    SHA-256 checksum, and executed via `eval()`. They use the catch-all
 *    `:spaceName` route and render through `DynamicSpacePage.vue`.
 *
 * Both kinds share the same manifest schema (`SpaceManifest` in SpaceLoader.ts).
 * The distinction lives in the loading mechanism, not the data shape.
 */

/**
 * Discriminated union for space loading origin.
 *
 * - `host-native`: compiled into the app, loaded from `coreSpaces.ts`
 * - `dynamic`: installed on disk, loaded via IIFE bundle at runtime
 */

export type SpaceKind = 'host-native' | 'dynamic'

/**
 * The built-in space IDs that ship with every Construct installation.
 * This is the single source of truth — all other lists derive from this.
 */
export const HOST_NATIVE_SPACE_IDS = [
  'ask',
  'builder',
  'org',
  'org-project',
  'project',
  'space-developer',
] as const

export type HostNativeSpaceId = typeof HOST_NATIVE_SPACE_IDS[number]

/**
 * Check whether a space ID is a host-native (built-in) space.
 */
export function isHostNativeSpace(id: string): id is HostNativeSpaceId {
  return (HOST_NATIVE_SPACE_IDS as readonly string[]).includes(id)
}

/**
 * HostNativeManifest — the required manifest shape for built-in spaces.
 *
 * This is a strict subset of SpaceManifest (from SpaceLoader.ts).
 * Host-native spaces MUST have these fields. Dynamic spaces have
 * additional optional fields (build, recommended, etc.) defined
 * in SpaceManifest.
 */
export interface HostNativeManifest {
  /** Must match one of HOST_NATIVE_SPACE_IDS */
  id: string
  /** Human-readable display name */
  name: string
  /** Short description of what this space does */
  description: string
  /** Iconify icon identifier (e.g. "lucide:terminal") */
  icon: string
  /** Semver version string */
  version: string
  /**
   * Ownership scopes — who installs this space.
   * - "app": sidebar-level, accessible from main navigation (e.g. ask)
   * - "org": requires organization context (uses useOrg / useOrgMembers)
   */
  scopes: ('app' | 'org')[]
  /**
   * Whether this space participates in project context.
   * Orthogonal to `scopes`.
   */
  projectAware?: boolean
  /** Sidebar navigation entry */
  navigation: {
    label: string
    icon: string
    to: string
    order: number
  }
  /** Page definitions — at least one page with default: true */
  pages: Array<{
    path: string
    label: string
    icon?: string
    default?: boolean
    requiresContext?: boolean
    toolbar?: Array<{
      id: string
      icon: string
      label: string
      action?: string
      to?: string
    }>
  }>
  /** Optional widget declarations */
  widgets?: Array<{
    id: string
    name: string
    description?: string
    icon?: string
    defaultSize: string
    sizes: Record<string, string> | string[]
  }>
  /** If true, this space is only visible when developer mode is active */
  requiresDeveloper?: boolean
}

/**
 * Validate that a manifest object conforms to the HostNativeManifest contract.
 * Returns an array of error messages (empty = valid).
 */
export function validateHostNativeManifest(manifest: Record<string, unknown>): string[] {
  const errors: string[] = []

  if (typeof manifest.id !== 'string' || !manifest.id) {
    errors.push('Missing or invalid "id" (must be a non-empty string)')
  }
  if (typeof manifest.name !== 'string' || !manifest.name) {
    errors.push('Missing or invalid "name" (must be a non-empty string)')
  }
  if (typeof manifest.description !== 'string') {
    errors.push('Missing or invalid "description" (must be a string)')
  }
  if (typeof manifest.icon !== 'string' || !manifest.icon) {
    errors.push('Missing or invalid "icon" (must be a non-empty string)')
  }
  if (typeof manifest.version !== 'string' || !manifest.version) {
    errors.push('Missing or invalid "version" (must be a non-empty string)')
  }

  // scopes (required) + projectAware (optional boolean). Legacy single
  // `scope` field is no longer accepted.
  if ((manifest as { scope?: unknown }).scope !== undefined) {
    errors.push('"scope" is no longer supported — use scopes: ["app"|"org"] + projectAware: boolean')
  }
  const scopesArr = (manifest as { scopes?: unknown }).scopes
  if (!Array.isArray(scopesArr) || scopesArr.length === 0
    || !scopesArr.every(s => s === 'app' || s === 'org')) {
    errors.push('Missing or invalid "scopes" — must be a non-empty array of "app" | "org"')
  }
  if ((manifest as { projectAware?: unknown }).projectAware !== undefined
    && typeof (manifest as { projectAware?: unknown }).projectAware !== 'boolean') {
    errors.push('"projectAware" must be a boolean')
  }
  if (errors.length === 0) {
    ; (manifest as { projectAware: boolean }).projectAware = (manifest as { projectAware?: boolean }).projectAware === true
  }

  // navigation
  const nav = manifest.navigation as Record<string, unknown> | undefined
  if (!nav || typeof nav !== 'object') {
    errors.push('Missing "navigation" object')
  } else {
    if (typeof nav.label !== 'string') errors.push('navigation.label must be a string')
    if (typeof nav.icon !== 'string') errors.push('navigation.icon must be a string')
    if (typeof nav.to !== 'string') errors.push('navigation.to must be a string')
    if (typeof nav.order !== 'number') errors.push('navigation.order must be a number')
  }

  // pages
  const pages = manifest.pages as unknown[] | undefined
  if (!Array.isArray(pages) || pages.length === 0) {
    errors.push('Missing or empty "pages" array (at least one page required)')
  } else {
    const hasDefault = pages.some((p: unknown) => (p as Record<string, unknown>).default === true)
    if (!hasDefault) {
      errors.push('At least one page must have "default": true')
    }
    for (const page of pages) {
      const p = page as Record<string, unknown>
      if (typeof p.path !== 'string') errors.push('Each page must have a "path" string')
      if (typeof p.label !== 'string') errors.push('Each page must have a "label" string')
    }
  }

  return errors
}
