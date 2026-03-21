/**
 * Core Space Registry — spaces that ship with the app.
 *
 * Core spaces are compile-time dependencies: no IIFE eval, no checksum,
 * no disk loading. SpaceLoader checks this registry before falling back
 * to the active app spaces directory.
 *
 * To add a core space:
 *   1. Copy its source into src/spaces/{id}/
 *   2. Import its index page component and manifest here
 *   3. Add an entry to CORE_SPACES
 */

import type { LoadedSpace, SpaceManifest } from './SpaceLoader'

const CORE_SPACES: Record<string, LoadedSpace> = {
  // Populated in Phase 2 & 3 when space files are copied in
}

export function isCoreSpace(id: string): boolean {
  return id in CORE_SPACES
}

export function getCoreSpace(id: string): LoadedSpace | null {
  return CORE_SPACES[id] || null
}

export function getCoreSpaceManifests(): SpaceManifest[] {
  return Object.values(CORE_SPACES).map(s => s.manifest)
}
