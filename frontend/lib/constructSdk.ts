/**
 * Construct SDK Provider
 *
 * Exposes host app stores, composables, and utilities to space IIFE bundles
 * via window.__CONSTRUCT__['@construct/sdk'].
 *
 * Space builds externalize '@construct/sdk' → this global.
 * Auto-import generates: import { useProjectStore } from '@construct/sdk'
 * Rollup maps to: window.__CONSTRUCT__["@construct/sdk"].useProjectStore
 */

// === Stores (host-owned only — domain stores live in their respective spaces) ===
export { useAuthStore } from '@/stores/auth'
export { usePanelsStore } from '@/stores/panels'
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
export { useProjectStore } from '@/stores/project'
export { useSettingsStore } from '@/stores/settings'

// === Composables ===
export { useAIModel, isVisionModel } from '@/composables/useAIModel'
export { useApi } from '@/composables/useApi'
/** @deprecated Use useApi instead */
export { useApi as useSource } from '@/composables/useApi'
export { useApiHealth } from '@/composables/useApiHealth'
export { useAppMenu } from '@/composables/useAppMenu'
export { useAppTheme, appThemes } from '@/composables/useAppTheme'
export { useAssistant } from '@/operator'
export { useAuth } from '@/composables/useAuth'
export { useAuthorization } from '@/composables/useAuthorization'
export { useBilling } from '@/composables/useBilling'
export { useConstructAuth } from '@/composables/useConstructAuth'
export { useConstructConfig, getConstructRuntime } from '@/composables/useConstructConfig'
export { useContextDB } from '@/composables/useContextDB'
export {
  useOperator,
  useContextMode,
  useComponentContext,
} from '@/operator'
export type {
  Tool,
  ToolCall,
  ToolResult,
} from '@/operator/types'
export { useCredits } from '@/composables/useCredits'
export { useDateFormat } from '@/composables/useDateFormat'
export { useDeepLink } from '@/composables/useDeepLink'
export { useDraggableWindow } from '@/composables/useDraggableWindow'
export { useDropdownPosition } from '@/composables/useDropdownPosition'
export {
  useGoogleFonts,
  isFontLoaded,
  loadGoogleFont,
  preloadCachedFonts,
  searchFonts,
  POPULAR_FONTS,
} from '@/composables/useGoogleFonts'
export { useMarkdown, renderMarkdown, renderStreamingMarkdown } from '@/composables/useMarkdown'
export { showContextMenu } from '@/composables/useNativeContextMenu'
export {
  useContextMenus,
  openContextMenu,
  registerContextMenuContributor,
  resolveContextMenuGroups,
} from '@/composables/useContextMenus'
export { usePanelLayout, PRESET_LAYOUTS } from '@/composables/usePanelLayout'
export { usePanelResize } from '@/composables/usePanelResize'
export { usePanels } from '@/composables/usePanels'
export { usePermissions } from '@/composables/usePermissions'
export { useProjectContext } from '@/composables/useProjectContext'
export { useProjectDirectory } from '@/composables/useProjectDirectory'
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
export { useSkills } from '@/composables/useSkills'
export { useSpaceMarketplace } from '@/composables/useSpaceMarketplace'
export { useSpaceShortcuts } from '@/composables/useSpaceShortcuts'
export { useSpaces } from '@/composables/useSpaces'
export {
  useStorage,
  migrateFromLocalStorage,
  migratePinnedItems,
} from '@/composables/useStorage'
export { useTauriContext } from '@/composables/useTauriContext'
export { useNotification } from '@construct-space/ui'
export { useToolbar } from '@/composables/useToolbar'
export { useUpdater } from '@/composables/useUpdater'
export { useUserModule } from '@/composables/useUserModule'
export { useSpacePreview } from '@/composables/useSpacePreview'
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

// === Common Components ===
export { default as ConfirmationModal } from '@/components/common/ConfirmationModal.vue'
export { default as SplitPane } from '@/components/panels/SplitPane.vue'

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

// === Telemetry ===
export {
  useTelemetry,
  trackFeature,
  isTelemetryEnabled,
  setTelemetryConsent,
  TELEMETRY_FEATURE_KEYS,
} from '@/composables/useTelemetry'

// === Utilities ===
export { appConfig } from '@/utils/config'
export { db, deleteDatabase } from '@/utils/db'
export { isTauriEnv } from '@/utils/tauri'
export { randomFrom, randomInt } from '@/utils/index'
