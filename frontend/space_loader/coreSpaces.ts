/**
 * Core Space Registry — host-native spaces that ship with the app.
 *
 * Host-native spaces: ask, builder, org, org-project, project, space-developer.
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
 *   4. Add an entry to CORE_SPACES below — if the space exposes semantic
 *      actions for the assistant, set `createAutomationProvider` on that
 *      entry (registerCoreSpaceProviders wires it from here; there is no
 *      separate provider list to maintain)
 *   5. Add explicit routes in router/routes.ts
 */

import type { AutomationProvider } from '@/types/automation'
import type { LoadedSpace, SpaceManifest } from './SpaceLoader'
import { validateHostNativeManifest } from '@/types/space'

// Page components
import askPage from '@/spaces/ask/pages/AskPage.vue'
import ProjectsPage from '@/spaces/project/pages/ProjectsPage.vue'
import ProjectDetailPage from '@/spaces/project/pages/ProjectDetailPage.vue'
import BuilderPage from '@/spaces/builder/pages/BuilderPage.vue'
import SpaceDeveloperPage from '@/spaces/space-developer/pages/SpaceDeveloperPage.vue'

// Org pages
import OrgDashboard from '@/spaces/org/pages/OrgDashboard.vue'
import OrgMembers from '@/spaces/org/pages/OrgMembers.vue'
import OrgMemberDetail from '@/spaces/org/pages/members/[id].vue'
import OrgDepartments from '@/spaces/org/pages/OrgDepartments.vue'
import OrgDepartmentDetail from '@/spaces/org/pages/departments/[id].vue'
import OrgTeamDetail from '@/spaces/org/pages/teams/[id].vue'
import OrgInvitations from '@/spaces/org/pages/OrgInvitations.vue'
import OrgActivity from '@/spaces/org/pages/OrgActivity.vue'
import OrgSettings from '@/spaces/org/pages/OrgSettings.vue'
import OrgInsights from '@/spaces/org/pages/OrgInsights.vue'

// Widget components — ask
import QuickChat4x2 from '~/spaces/ask/widgets/QuickChat4x2.vue'
import QuickChat2x1 from '~/spaces/ask/widgets/QuickChat2x1.vue'

// Widget components — project
import RecentProjects4x2 from '@/spaces/project/widgets/RecentProjects4x2.vue'
import PinnedProjects4x2 from '@/spaces/project/widgets/PinnedProjects4x2.vue'
import PinnedProjects4x4 from '@/spaces/project/widgets/PinnedProjects4x4.vue'
import DeployStatus2x2 from '@/spaces/project/widgets/DeployStatus2x2.vue'
import QuickOpen2x1 from '@/spaces/project/widgets/QuickOpen2x1.vue'
import ProjectStats4x2 from '@/spaces/project/widgets/ProjectStats4x2.vue'

// Org-project pages
import OrgProjectsPage from '@/spaces/org-project/pages/OrgProjectsPage.vue'
import OrgProjectDetailPage from '@/spaces/org-project/pages/OrgProjectDetailPage.vue'

// Automation provider factories — store-backed, wired at startup by
// registerCoreSpaceProviders so the assistant can run these spaces'
// actions headlessly. Co-located with the space's CORE_SPACES entry so
// there's one place to register a host-native space, not two.
import { createAutomationProvider as createOrgProvider } from '@/spaces/org/composables/useAutomationProvider'
import { createAutomationProvider as createProjectProvider } from '@/spaces/project/composables/useAutomationProvider'
import { createAutomationProvider as createOrgProjectProvider } from '@/spaces/org-project/composables/useAutomationProvider'

// Manifests — validated at import time against the HostNativeManifest contract
import askManifest from '~/spaces/ask/manifest.json'
import orgManifest from '@/spaces/org/manifest.json'
import projectManifest from '@/spaces/project/manifest.json'
import orgProjectManifest from '@/spaces/org-project/manifest.json'
import builderManifest from '@/spaces/builder/manifest.json'
import spaceDeveloperManifest from '@/spaces/space-developer/manifest.json'

// Runtime validation: fail fast if a built-in manifest drifts from the contract
for (const [id, manifest] of Object.entries({ ask: askManifest, builder: builderManifest, org: orgManifest, project: projectManifest, 'org-project': orgProjectManifest, 'space-developer': spaceDeveloperManifest })) {
  const errors = validateHostNativeManifest(manifest)
  if (errors.length > 0) {
    console.error(`[CoreSpaces] Host-native manifest "${id}" failed validation:`, errors)
  }
}

const CORE_SPACES: Record<string, LoadedSpace> = {
  ask: {
    id: 'ask',
    manifest: askManifest as unknown as SpaceManifest,
    pages: { '': askPage },
    widgets: {
      'quick-chat': {
        '2x1': QuickChat2x1,
        '4x2': QuickChat4x2,
      },
    },
    cssInjected: false,
  },
  builder: {
    id: 'builder',
    manifest: builderManifest as unknown as SpaceManifest,
    pages: { '': BuilderPage },
    widgets: {},
    cssInjected: false,
  },
  'space-developer': {
    id: 'space-developer',
    manifest: spaceDeveloperManifest as unknown as SpaceManifest,
    pages: { '': SpaceDeveloperPage },
    widgets: {},
    cssInjected: false,
  },
  org: {
    id: 'org',
    manifest: orgManifest as unknown as SpaceManifest,
    pages: {
      '': OrgDashboard,
      'members': OrgMembers,
      'members/:id': OrgMemberDetail,
      'departments': OrgDepartments,
      'departments/:id': OrgDepartmentDetail,
      'teams/:id': OrgTeamDetail,
      'invitations': OrgInvitations,
      'activity': OrgActivity,
      'insights': OrgInsights,
      'settings': OrgSettings,
    },
    widgets: {},
    cssInjected: false,
    createAutomationProvider: createOrgProvider,
  },
  'org-project': {
    id: 'org-project',
    manifest: orgProjectManifest as unknown as SpaceManifest,
    pages: { '': OrgProjectsPage, ':projectId': OrgProjectDetailPage },
    widgets: {},
    cssInjected: false,
    createAutomationProvider: createOrgProjectProvider,
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
    createAutomationProvider: createProjectProvider,
  },
}

export function isCoreSpace(id: string): boolean {
  return id in CORE_SPACES
}

/** Core spaces that expose an AutomationProvider, as [id, factory] pairs.
 *  registerCoreSpaceProviders() drives off this so the provider list is
 *  never maintained separately from CORE_SPACES. */
export function getCoreSpaceProviderFactories(): Array<[string, () => AutomationProvider]> {
  const out: Array<[string, () => AutomationProvider]> = []
  for (const space of Object.values(CORE_SPACES)) {
    if (space.createAutomationProvider) {
      out.push([space.id, space.createAutomationProvider])
    }
  }
  return out
}

export function getCoreSpace(id: string): LoadedSpace | null {
  return CORE_SPACES[id] || null
}

export function getCoreSpaceManifests(): SpaceManifest[] {
  return Object.values(CORE_SPACES).map(s => s.manifest)
}

/** Core spaces that require developer mode to be visible (app-scoped only).
 * Project-scoped spaces (architect, coder) are naturally hidden
 * outside projects — they don't need dev mode gating. */
export const DEVELOPER_ONLY_SPACES = new Set<string>([])
