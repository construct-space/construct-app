<script setup lang="ts">
/**
 * Toolbar3D - Unified 3D rotating toolbar
 *
 * Uses useToolbar for everything:
 * - Space detection and items (auto from route)
 * - Page-specific items (set by pages)
 * - 3D rotation animation
 */
// Detach moved to TitleBar.vue — toolbar focuses on breadcrumb + page items.
import ToolbarBreadcrumb from '../toolbar/Breadcrumb.vue'
import ToolbarSlotRenderer from './ToolbarSlotRenderer.vue'
import { Building2 } from 'lucide-vue-next'
import { useOrgStore } from '@/stores/org'
import { useOrgSpacesSync } from '@/composables/useOrgSpacesSync'
import { useToolbarSlots } from '@/composables/useToolbarSlots'

const router = useRouter()
const orgStore = useOrgStore()
const orgSpacesSync = useOrgSpacesSync()
const isSyncing = ref(false)
async function syncOrgSpaces() {
  if (isSyncing.value) return
  isSyncing.value = true
  orgSpacesSync.reset()
  try { await orgSpacesSync.run() }
  finally { isSyncing.value = false }
}
// Sync org spaces is a Spaces-page action — surfacing it on every
// toolbar implies a global "sync now" affordance, but the action
// only meaningfully refreshes what's listed on the Spaces grid.
// Gate to /app/spaces so it appears in context, not everywhere.
const route = useRoute()
const showOrgSync = computed(() => orgStore.isEnabled && route.path === '/app/spaces')
const { slotLeft, slotCenter, slotRight } = useToolbarSlots()
const {
  frontPanel,
  bottomPanel,
  rotationTransform,
  isRotating,
  toolbarItemsLeft,
  toolbarItemsCenter,
  toolbarItemsRight,
  bottomToolbarItems,
  initToolbar
} = useToolbar()

onMounted(async () => {
  await initToolbar()
})

async function handleItemClick(item: { id: string; onClick?: () => void; to?: string; action?: string }) {
  if (item.onClick) {
    item.onClick()
  } else if (item.to) {
    router.push(item.to)
  } else if (item.action) {
    const spaceName = frontPanel.value?.spaceName
    console.log('[Toolbar] action:', item.action, 'space:', spaceName)
    if (spaceName) {
      const { getAutomationProvider, listAutomationProviders } = await import('@/lib/spaceContextBus')
      console.log('[Toolbar] registered providers:', listAutomationProviders())
      const provider = getAutomationProvider(spaceName)
      console.log('[Toolbar] provider for', spaceName, ':', !!provider)
      if (provider) {
        const result = await provider.runAction(item.action)
        console.log('[Toolbar] action result:', result)
      }
    }
  }
}
</script>

<template>
  <div class="toolbar-cube relative h-11 select-none mt-1 mb-3" @contextmenu.prevent>
    <!-- Rotating Container — origin offset creates the cube depth -->
    <div class="toolbar-cube__wrapper w-full h-full relative"
      :class="isRotating ? 'toolbar-cube__wrapper--animated' : ''" :style="{ transform: rotationTransform }">
      <!-- Front Panel -->
      <div class="toolbar-face relative w-full h-11 px-3 flex items-center gap-2 " data-tauri-drag-region>
        <div class="min-w-0 shrink overflow-hidden">
          <ToolbarBreadcrumb :path="frontPanel.path" :breadcrumbs="frontPanel.breadcrumbs" />
        </div>

        <!-- Left: position='left' state items only -->
        <div class="flex items-center gap-0.5 shrink-0">
          <Tooltip v-for="item in toolbarItemsLeft" :key="item.id" :text="item.label">
            <button class="toolbar-btn" :class="item.active ? 'active' : ''" @click="handleItemClick(item)">
              <Icon :name="item.icon" class="size-4" />
            </button>
          </Tooltip>
        </div>

        <div class="flex-1" />

        <!-- Center: page items without an explicit position default here -->
        <template v-if="toolbarItemsCenter.length">
          <div class="flex items-center gap-0.5">
            <Tooltip v-for="item in toolbarItemsCenter" :key="item.id" :text="item.label">
              <button class="toolbar-btn" :class="item.active ? 'active' : ''" @click="handleItemClick(item)">
                <Icon :name="item.icon" class="size-4" />
              </button>
            </Tooltip>
          </div>
        </template>

        <div class="flex-1" />

        <!-- Right: position='right' state items only -->
        <div class="flex items-center gap-0.5">
          <Tooltip v-for="item in toolbarItemsRight" :key="item.id" :text="item.label">
            <button class="toolbar-btn" :class="item.active ? 'active' : ''" @click="handleItemClick(item)">
              <Icon :name="item.icon" class="size-4" />
            </button>
          </Tooltip>
        </div>
</div>

      <!-- Bottom Panel (for rotation animation) -->
      <div class="toolbar-face toolbar-face--bottom absolute left-0 w-full h-11 ml-4 mr-3  flex items-center gap-2  "
        data-tauri-drag-region>
        <div class="min-w-0 shrink overflow-hidden">
          <ToolbarBreadcrumb :path="bottomPanel.path" :breadcrumbs="bottomPanel.breadcrumbs" />
        </div>

        <div class="flex-1" />

        <template v-if="bottomToolbarItems.length">
          <div class="w-px h-5 bg-[var(--app-border)]" />

          <div class="flex items-center gap-0.5">
            <Tooltip v-for="item in bottomToolbarItems" :key="item.id" :text="item.label">
              <button class="toolbar-btn" :class="item.active ? 'active' : ''" @click="handleItemClick(item)">
                <Icon :name="item.icon" class="size-4" />
              </button>
            </Tooltip>
          </div>
        </template>

        <div class="flex-1" />
</div>
    </div>

    <!-- Stable, non-rotating slot overlay. Pages register content through
         <ToolbarSlot>, and this overlay renders it outside the rotating
         wrapper so navigation doesn't carry slot content away on a cube
         face. Pointer-events: none on the container lets the drag region
         underneath stay reachable; each slot div re-enables pointer events
         for its content. -->
    <div class="toolbar-slot-overlay absolute inset-0 h-11 px-3 flex items-center gap-2 pointer-events-none">
      <!-- Breadcrumb-width placeholder. Mirrors the visible breadcrumb's
           width so slot content lines up where it did inline.
           min-w prevents collapse on first paint, before useToolbar()
           has set state.frontPanel.breadcrumbs — otherwise the left slot
           starts at x=0 and overlaps the rotating cube's breadcrumb. -->
      <!-- shrink-0 + NO overflow-hidden: reserve the breadcrumb's FULL
           natural width so the left slot (e.g. Builder's Skills chip)
           always starts after it. `shrink` let right-side width pressure
           shrink this below the real breadcrumb; `overflow-hidden` let the
           inner breadcrumb ellipsize narrower than the visible one — both
           slid the slot on top of the last crumb. Crumb labels are
           middle-ellipsis capped, so the natural width stays bounded. -->
      <div class="min-w-[200px] shrink-0 invisible">
        <ToolbarBreadcrumb :path="frontPanel.path" :breadcrumbs="frontPanel.breadcrumbs" />
      </div>
      <div id="toolbar-left" class="pointer-events-auto flex items-center gap-0.5 shrink-0">
        <ToolbarSlotRenderer :slot-fn="slotLeft" />
      </div>
      <div class="flex-1" />
      <div id="toolbar-center" class="pointer-events-auto flex items-center gap-1">
        <ToolbarSlotRenderer :slot-fn="slotCenter" />
      </div>
      <div class="flex-1" />
      <div class="pointer-events-auto flex items-center justify-end gap-0.5 shrink-0 min-w-0 max-w-[52vw] 2xl:max-w-[720px] overflow-hidden">
        <button
          v-if="showOrgSync"
          class="toolbar-btn-text toolbar-btn-text--warning shrink-0"
          :disabled="isSyncing"
          @click="syncOrgSpaces"
        >
          <Building2 class="size-3.5" :class="isSyncing ? 'animate-pulse' : ''" />
          <span>{{ isSyncing ? 'Syncing…' : 'Sync Org Spaces' }}</span>
        </button>
        <div id="toolbar-right" class="flex items-center justify-end gap-0.5 min-w-0 overflow-hidden">
          <ToolbarSlotRenderer :slot-fn="slotRight" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 3D cube formed by transform-origin offset — no translateZ, no magnification */
.toolbar-cube {
  perspective: 1000px;
}

.toolbar-cube__wrapper {
  transform-origin: 50% 50% -22px;
  /* half of h-11 (44px / 2 = 22px) behind the surface */
  transform-style: preserve-3d;
  will-change: transform;
}

.toolbar-cube__wrapper--animated {
  transition: transform 0.5s ease-in;
}

.toolbar-face {
  backface-visibility: hidden;
}

.toolbar-shadow {
  box-shadow: 0 0 3px rgba(0, 0, 0, 0.18);
}

.toolbar-face--bottom {
  top: 100%;
  transform-origin: center top;
  transform: rotateX(-90deg);
  backface-visibility: hidden;
}

.toolbar-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 0.375rem;
  cursor: pointer;
  transition: all 0.15s;
  border: none;
  background: transparent;
  color: var(--app-muted);
}

.toolbar-btn:hover {
  background: var(--app-input-bg);
  color: var(--app-foreground);
}

.toolbar-btn.active {
  background: color-mix(in srgb, var(--app-accent) 15%, transparent);
  color: var(--app-accent);
}

.toolbar-btn-text {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  height: 32px;
  padding: 0 0.625rem;
  border-radius: 0.375rem;
  cursor: pointer;
  transition: all 0.15s;
  border: none;
  background: transparent;
  color: var(--app-muted);
  font-size: 0.75rem;
  font-weight: 500;
  letter-spacing: 0.01em;
  white-space: nowrap;
}

.toolbar-btn-text:hover:not(:disabled) {
  background: var(--app-input-bg);
  color: var(--app-foreground);
}

.toolbar-btn-text:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* Warning variant — used for org-scoped actions that change state for
   everyone in the org (e.g. Sync Org Spaces). Yellow draws the eye
   without being alarming like the error red. */
.toolbar-btn-text--warning {
  color: #ca8a04;
}
.toolbar-btn-text--warning:hover:not(:disabled) {
  background: color-mix(in srgb, #ca8a04 12%, transparent);
  color: #a16207;
}
</style>
