/**
 * Construct SDK Provider
 *
 * Exposes host app stores, composables, and utilities to space IIFE bundles
 * via window.__CONSTRUCT__['@construct-space/sdk'].
 *
 * Space builds externalize '@construct-space/sdk' -> this global.
 * Rollup maps `import { x } from '@construct-space/sdk'` to
 * `window.__CONSTRUCT__["@construct-space/sdk"].x`.
 *
 * This file is the host's IMPLEMENTATION of @construct-space/sdk's typed
 * surface. Every runtime symbol the SDK re-exports from its root must be
 * provided here -- otherwise the import compiles fine but lookups return
 * undefined and crash at first call.
 */

import { computed } from 'vue'
// Local binding for use inside callSpaceAction/listSpaceActions — the
// `export { getAutomationProvider } from '@/lib/spaceContextBus'` below is a
// pure re-export and does NOT create an in-scope binding.
import { getAutomationProvider } from '@/lib/spaceContextBus'
import { useAIModel as useHostAIModel, isVisionModel } from '@/composables/useAIModel'
import { useBilling as useHostBilling } from '@/composables/useBilling'
import { useCredits as useHostCredits } from '@/composables/useCredits'
import { useSkills as useHostSkills } from '@/composables/useSkills'
import { useSpaceMarketplace as useHostSpaceMarketplace } from '@/composables/useSpaceMarketplace'
import { useSpaces as useHostSpaces } from '@/composables/useSpaces'

// === Validation schemas + helpers ===
// The SDK re-exports the contents of ./schemas from its root, so spaces
// can do `import { validateManifest } from '@construct-space/sdk'`. We
// pull from the same subpath so the runtime values land on __CONSTRUCT__.
export * from '@construct-space/sdk/schemas'

// === Telemetry feature keys ===
// Re-exported from the SDK package itself -- TELEMETRY_FEATURE_KEYS is
// static data that ships in the SDK; the host just surfaces it on
// __CONSTRUCT__ so externalised space imports resolve.
export { TELEMETRY_FEATURE_KEYS } from '@construct-space/sdk'

// === Stores ===
export { useAuthStore } from '@/stores/auth'
// useProjectStore was reinstated in SDK 2.0.1 after the v2 cleanup
// found real consumers (canvas, terminal). usePanelsStore points at the
// same store and is kept for legacy spaces; both are still candidates
// for replacement by manifest-declared project inputs eventually.
export { useProjectStore } from '@/stores/project'
export { useProjectStore as usePanelsStore } from '@/stores/project'
export {
  usePinnedStore,
  createFolderPin,
  createLinkPin,
  createPagePin,
  createProjectPin,
  createSpacePin,
  createTaskPin,
} from '@/stores/pinned'
export { usePreferencesStore } from '@/stores/preferences'
export { useSettingsStore } from '@/stores/settings'

// === Composables ===
export { isVisionModel }
export { useDelivery } from '@/composables/useDelivery'
export { useOrg } from '@/composables/useOrg'
export { useOrgMembers } from '@/composables/useOrgMembers'
export { useOrgTeams } from '@/composables/useOrgTeams'
export { useOrgDepartments } from '@/composables/useOrgDepartments'
export { useOrgRoles } from '@/composables/useOrgRoles'
export { useAccess } from '@/composables/useAccess'
export type { AccessMember } from '@/composables/useAccess'
export { useAppMenu } from '@/composables/useAppMenu'
export { useBreadcrumb } from '@/composables/useBreadcrumb'
export type { Breadcrumb } from '@/composables/useBreadcrumb'
export { useDownload } from '@/composables/useDownload'
export { useExport } from '@/composables/useExport'
export { useImport } from '@/composables/useImport'
export { useNavigator } from '@/composables/useNavigator'
export { useStorage } from '@/composables/useStorage'
// Legacy host alias kept for older spaces. New spaces import useAppTheme
// from '@construct-space/sdk'.
export { useAppTheme as useTheme, useAppTheme } from '@/composables/useAppTheme'
export { useAuth, useToast } from '@/lib/constructSdkCompat'
export { useAuthorization } from '@/composables/useAuthorization'
export { useConstructAuth } from '@/composables/useConstructAuth'
export { useConstructConfig, getConstructRuntime } from '@/composables/useConstructConfig'
export { useContextDB } from '@/composables/useContextDB'
export { useDateFormat } from '@/composables/useDateFormat'
export { useDeepLink } from '@/composables/useDeepLink'
export { useDraggableWindow } from '@/composables/useDraggableWindow'
export {
  useGoogleFonts,
  isFontLoaded,
  loadGoogleFont,
  preloadCachedFonts,
  searchFonts,
  POPULAR_FONTS,
} from '@/composables/useGoogleFonts'
export { useMarkdown, renderMarkdown, renderStreamingMarkdown } from '@/composables/useMarkdown'
export { useMediaSession } from '@/composables/useMediaSession'
export type { MediaTrack, MediaControls, MediaSessionState } from '@/composables/useMediaSession'
export { usePresenceStatus, PRESENCE_STATUS_META } from '@/composables/usePresenceStatus'
export type { PresenceStatus } from '@/composables/usePresenceStatus'
export { showContextMenu } from '@/composables/useNativeContextMenu'
export {
  useContextMenus,
  openContextMenu,
  registerContextMenuContributor,
  resolveContextMenuGroups,
} from '@/composables/useContextMenus'
export {
  useShortcutStore,
  getKey,
  setKey,
  resetKey,
  resetAll,
  hasOverride,
  exportJson,
  importJson,
  SHORTCUT_REGISTRY,
} from '@/composables/useShortcutStore'
export { useSidebar } from '@/composables/useSidebar'
export { useHttp } from '@/composables/useHttp'
export type {
  HttpClient,
  HttpMethod,
  HttpRequestConfig,
  HttpResponse,
  HttpError,
  HttpInterceptors,
  HttpClientDefaults,
  HttpFetchInit,
  HttpFetchResponse,
} from '@/composables/useHttp'
export { useSpaceShortcuts } from '@/composables/useSpaceShortcuts'
export { useSpaceTool } from '@/composables/useSpaceTool'
export type { SpaceToolHandle, SpaceToolResult, SpaceToolRunOptions, UseSpaceToolOptions } from '@/composables/useSpaceTool'
export {
  useLocalStorage,
  migrateFromLocalStorage,
  migratePinnedItems,
} from '@/composables/useLocalStorage'
// `notify` (the legacy bare-function helper) is host-internal only as of
// SDK 2.0; spaces import `useNotification` and call `.add({ title, ... })`.
export { useNotification } from '@/composables/useNotification'
export { useScheduler } from '@/composables/useScheduler'
export { useToolbar } from '@/composables/useToolbar'
export { useUpdater } from '@/composables/useUpdater'
export { useUserModule } from '@/composables/useUserModule'
export { useConstructWindow } from '@/composables/useConstructWindow'
export {
  CONTEXT_SOURCE_SPACE_QUERY_KEY,
  CONTEXT_TARGET_QUERY_KEY,
  decodeContextTarget,
  encodeContextTarget,
} from '@/lib/contextMenuTypes'
export {
  buildSpaceOpenLocation,
  navigateToSpace,
  openTargetInSpace,
  registerSpaceOpenHandler,
  resolveSpacePath,
} from '@/lib/spaceNavigation'

// === Routing ===
// SDK 2.0 dropped the imperative `navigateTo` helper from the space-facing
// surface. Spaces use `useNavigator()` (space-scoped, reactive, picker-aware).
// Host code that wants raw vue-router still imports useRoute/useRouter from
// 'vue-router' directly.
export { useRoute, useRouter } from 'vue-router'

export interface LocalDirectoryPickerOptions {
  title?: string
  defaultPath?: string
}

export async function pickLocalDirectory(options: LocalDirectoryPickerOptions = {}): Promise<string | null> {
  const { open } = await import('@tauri-apps/plugin-dialog')
  let defaultPath = options.defaultPath
  if (!defaultPath) {
    try {
      const { homeDir } = await import('@tauri-apps/api/path')
      defaultPath = await homeDir()
    } catch {
      defaultPath = undefined
    }
  }

  const selected = await open({
    directory: true,
    multiple: false,
    defaultPath,
    title: options.title,
  })
  const folder = Array.isArray(selected) ? selected[0] : selected
  return typeof folder === 'string' && folder ? folder : null
}

export function resolveLocalFileUrl(path: string, protocol = 'asset'): string {
  if (!path) return ''
  const internals = (window as unknown as {
    __TAURI_INTERNALS__?: {
      convertFileSrc?: (filePath: string, protocol?: string) => string
    }
  }).__TAURI_INTERNALS__
  const convertFileSrc = internals?.convertFileSrc
  if (typeof convertFileSrc === 'function') return convertFileSrc(path, protocol)
  return path
}

// === Common Components ===
export { default as ConfirmationModal } from '@/components/common/ConfirmationModal.vue'
export { default as SplitPane } from '@/components/panels/SplitPane.vue'
export { default as ToolbarSlot } from '@/components/common/ToolbarSlot.vue'

// === Space Context Bus ===
export {
  publishSpaceContext,
  subscribeSpaceContext,
  getLatestSpaceContext,
  registerContextHandler,
  requestSpaceData,
  registerAutomationProvider,
  getAutomationProvider,
  listAutomationProviders,
  setActiveSpace,
  getActiveSpace,
} from '@/lib/spaceContextBus'
export type {
  SpaceContextPayload,
  SpaceContextCallback,
  ContextHandler,
  AutomationProvider,
  SpaceSnapshot,
  AutomationAction,
  ActionResult,
} from '@/lib/spaceContextBus'

// === Cross-space actions ===
// `callSpaceAction` lets one space invoke another space's registered action
// — the same provider surface the agent drives via `space_run_action`. The
// action runs against the *target* space's own graph + permission gates, so
// domains stay encapsulated (calendar asks meet to createMeeting rather than
// writing meet's graph with a duck-typed model). Installed-but-not-open
// spaces work: their action bundle lazy-loads on first call.

/** Resolve a target space's provider, preloading manifest actions if the
 *  space hasn't registered yet (e.g. it was never opened this session). */
async function resolveSpaceProvider(spaceId: string) {
  const provider = getAutomationProvider(spaceId)
  if (provider) return provider
  try {
    const { registerCoreSpaceProviders } = await import('@/lib/coreSpaceProviders')
    await registerCoreSpaceProviders()
    const { preloadSpaceActions } = await import('@/space_loader/SpaceLoader')
    await preloadSpaceActions()
  } catch (e) {
    console.warn('[callSpaceAction] preload failed:', e)
  }
  return getAutomationProvider(spaceId)
}

export async function callSpaceAction<R = unknown>(
  spaceId: string,
  actionId: string,
  payload?: Record<string, unknown>,
): Promise<R> {
  const provider = await resolveSpaceProvider(spaceId)
  if (!provider) {
    throw new Error(`callSpaceAction: space "${spaceId}" has no registered actions`)
  }
  const result = await provider.runAction(actionId, payload)
  if (!result.success) {
    throw new Error(result.error || `callSpaceAction: "${spaceId}.${actionId}" failed`)
  }
  return result.data as R
}

export async function listSpaceActions(spaceId: string) {
  const provider = await resolveSpaceProvider(spaceId)
  if (!provider) return []
  return provider.listActions().map(a => ({
    id: a.id,
    description: a.description,
    params: a.params,
  }))
}

// === Telemetry ===
export {
  useTelemetry,
  trackFeature,
  isTelemetryEnabled,
  setTelemetryConsent,
} from '@/composables/useTelemetry'

// === Brain client ===
export { useBrain, postToolResponse } from '@/brain'

// === Utilities ===
export { appConfig } from '@/utils/config'
export { db, deleteDatabase } from '@/utils/db'
export { isTauriEnv } from '@/utils/tauri'
export { randomFrom, randomInt } from '@/utils/index'

export function useSkills() {
  const api = useHostSkills()
  const list = computed(() => api.skills.value.map(skill => ({
    id: skill.id,
    name: skill.name,
    description: skill.description,
    spaceId: skill.source?.startsWith('space:') ? skill.source.slice('space:'.length) : undefined,
  })))
  const byId = (id: string) => list.value.find(skill => skill.id === id)

  return { ...api, list, byId }
}

export function useSpaces() {
  const api = useHostSpaces()
  const installed = computed(() => api.spaces.value.map(space => ({
    id: space.name,
    name: space.displayName || space.name,
    description: space.description,
    icon: space.icon,
    scopes: space.scopes,
    projectAware: space.projectAware,
    version: space.version,
    isInstalled: space.isInstalled,
  })))
  const byId = (id: string) => installed.value.find(space => space.id === id || space.name === id)

  return { ...api, installed, byId }
}

export function useSpaceMarketplace() {
  const api = useHostSpaceMarketplace()
  const search = async (query: string) => {
    await api.searchRemote(query)
    return api.filteredRemote.value.map(space => ({
      id: space.id,
      name: space.display_name || space.name,
      description: space.description,
      icon: space.icon,
      version: space.version,
      isInstalled: api.isInstalled(space.id),
    }))
  }

  return { ...api, search }
}

export function useCredits() {
  const api = useHostCredits()
  const refresh = async () => { await api.fetchBalance() }
  return { ...api, refresh }
}

export function useBilling() {
  const api = useHostBilling()
  const plan = computed(() => api.currentPlan.value?.slug || api.currentPlan.value?.name || null)
  const status = computed(() => api.subscription.value?.status || null)
  const openPortal = async () => {
    const returnUrl = typeof window !== 'undefined' ? window.location.href : ''
    const url = await api.createPortalSession(returnUrl)
    if (typeof window !== 'undefined') {
      window.open(url, '_blank', 'noopener,noreferrer')
    }
  }

  return { ...api, plan, status, openPortal }
}

export function useAIModel() {
  const api = useHostAIModel()
  const available = computed(() => api.allModels.value.map(model => ({
    id: model.id,
    name: model.label,
    vision: model.capabilities?.includes('vision') ?? false,
    contextWindow: 0,
  })))
  const active = api.defaultModelId
  const setActive = api.setDefaultModel

  return { ...api, available, active, setActive }
}
