/**
 * Core Space Registry — host-native spaces that ship with the app.
 *
 * There are exactly 4 host-native spaces: architect, brainstorm, coder, project.
 * They are compile-time dependencies: no IIFE eval, no checksum, no disk loading.
 * SpaceLoader.loadSpace() checks this registry first; if found, the space is
 * returned directly without any disk I/O. If not found, it falls back to the
 * dynamic loading path (IIFE bundles from the app data directory).
 *
 * The canonical list of host-native space IDs lives in `types/space.ts`
 * (HOST_NATIVE_SPACE_IDS). This file is the component registry that maps
 * those IDs to their compiled Vue page components and manifest data.
 *
 * To add a host-native space:
 *   1. Add its ID to HOST_NATIVE_SPACE_IDS in types/space.ts
 *   2. Create its source in frontend/spaces/{id}/
 *   3. Import its page components and manifest here
 *   4. Add an entry to CORE_SPACES below
 *   5. Add explicit routes in router/routes.ts
 */

import type { LoadedSpace, SpaceManifest } from './SpaceLoader'
import { validateHostNativeManifest } from '@/types/space'

// Page components
import BrainstormPage from '@/spaces/brainstorm/pages/BrainstormPage.vue'
import CoderPage from '@/spaces/coder/pages/CoderPage.vue'
import ArchitectPage from '@/spaces/architect/pages/ArchitectPage.vue'
import ProjectsPage from '@/spaces/project/pages/ProjectsPage.vue'
import ProjectDetailPage from '@/spaces/project/pages/ProjectDetailPage.vue'

// Widget components — brainstorm
import QuickChat4x2 from '@/spaces/brainstorm/widgets/QuickChat4x2.vue'
import QuickChat2x1 from '@/spaces/brainstorm/widgets/QuickChat2x1.vue'

// Widget components — architect
import QuickArchitect1x1 from '@/spaces/architect/widgets/QuickArchitect1x1.vue'
import QuickArchitect4x1 from '@/spaces/architect/widgets/QuickArchitect4x1.vue'

// Widget components — project
import RecentProjects4x2 from '@/spaces/project/widgets/RecentProjects4x2.vue'
import PinnedProjects4x2 from '@/spaces/project/widgets/PinnedProjects4x2.vue'
import PinnedProjects4x4 from '@/spaces/project/widgets/PinnedProjects4x4.vue'
import DeployStatus2x2 from '@/spaces/project/widgets/DeployStatus2x2.vue'
import QuickOpen2x1 from '@/spaces/project/widgets/QuickOpen2x1.vue'
import ProjectStats4x2 from '@/spaces/project/widgets/ProjectStats4x2.vue'

// Manifests — validated at import time against the HostNativeManifest contract
import brainstormManifest from '@/spaces/brainstorm/manifest.json'
import coderManifest from '@/spaces/coder/manifest.json'
import architectManifest from '@/spaces/architect/manifest.json'
import projectManifest from '@/spaces/project/manifest.json'

// Runtime validation: fail fast if a built-in manifest drifts from the contract
for (const [id, manifest] of Object.entries({ brainstorm: brainstormManifest, coder: coderManifest, architect: architectManifest, project: projectManifest })) {
  const errors = validateHostNativeManifest(manifest)
  if (errors.length > 0) {
    console.error(`[CoreSpaces] Host-native manifest "${id}" failed validation:`, errors)
  }
}

const CORE_SPACES: Record<string, LoadedSpace> = {
  brainstorm: {
    id: 'brainstorm',
    manifest: brainstormManifest as unknown as SpaceManifest,
    pages: { '': BrainstormPage },
    widgets: {
      'quick-chat': {
        '2x1': QuickChat2x1,
        '4x2': QuickChat4x2,
      },
    },
    cssInjected: false,
  },
  coder: {
    id: 'coder',
    manifest: coderManifest as unknown as SpaceManifest,
    pages: { '': CoderPage },
    widgets: {},
    cssInjected: false,
  },
  architect: {
    id: 'architect',
    manifest: architectManifest as unknown as SpaceManifest,
    pages: { '': ArchitectPage },
    widgets: {
      'quick-architect': {
        '1x1': QuickArchitect1x1,
        '4x1': QuickArchitect4x1,
      },
    },
    cssInjected: false,
  },
  project: {
    id: 'project',
    manifest: projectManifest as unknown as SpaceManifest,
    pages: { '': ProjectsPage, ':id': ProjectDetailPage },
    widgets: {
      'recent-projects': {
        '4x2': RecentProjects4x2,
      },
      'pinned-projects': {
        '4x2': PinnedProjects4x2,
        '4x4': PinnedProjects4x4,
      },
      'deploy-status': {
        '2x2': DeployStatus2x2,
      },
      'quick-open': {
        '2x1': QuickOpen2x1,
      },
      'project-stats': {
        '4x2': ProjectStats4x2,
      },
    },
    cssInjected: false,
  },
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
