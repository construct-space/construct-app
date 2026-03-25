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

// Page components
import BrainstormPage from '@/spaces/brainstorm/pages/BrainstormPage.vue'
import VibePage from '@/spaces/vibe/pages/VibePage.vue'
import ArchitectPage from '@/spaces/architect/pages/ArchitectPage.vue'
import ProjectsPage from '@/spaces/project/pages/ProjectsPage.vue'
import ProjectDetailPage from '@/spaces/project/pages/ProjectDetailPage.vue'

// Widget components — brainstorm
import QuickChat4x2 from '@/spaces/brainstorm/widgets/QuickChat4x2.vue'
import QuickChat2x1 from '@/spaces/brainstorm/widgets/QuickChat2x1.vue'

// Widget components — vibe
import QuickVibe4x1 from '@/spaces/vibe/widgets/QuickVibe4x1.vue'
import QuickVibe2x1 from '@/spaces/vibe/widgets/QuickVibe2x1.vue'

// Widget components — architect
import QuickArchitect4x1 from '@/spaces/architect/widgets/QuickArchitect4x1.vue'

// Widget components — project
import RecentProjects4x2 from '@/spaces/project/widgets/RecentProjects4x2.vue'
import PinnedProjects4x4 from '@/spaces/project/widgets/PinnedProjects4x4.vue'
import DeployStatus2x2 from '@/spaces/project/widgets/DeployStatus2x2.vue'
import QuickOpen2x1 from '@/spaces/project/widgets/QuickOpen2x1.vue'
import ProjectStats4x2 from '@/spaces/project/widgets/ProjectStats4x2.vue'

// Manifests
import brainstormManifest from '@/spaces/brainstorm/manifest.json'
import vibeManifest from '@/spaces/vibe/manifest.json'
import architectManifest from '@/spaces/architect/manifest.json'
import projectManifest from '@/spaces/project/manifest.json'

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
  vibe: {
    id: 'vibe',
    manifest: vibeManifest as unknown as SpaceManifest,
    pages: { '': VibePage },
    widgets: {
      'quick-vibe': {
        '2x1': QuickVibe2x1,
        '4x1': QuickVibe4x1,
      },
    },
    cssInjected: false,
  },
  architect: {
    id: 'architect',
    manifest: architectManifest as unknown as SpaceManifest,
    pages: { '': ArchitectPage },
    widgets: {
      'quick-architect': {
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
