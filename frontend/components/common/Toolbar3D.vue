<script setup lang="ts">
/**
 * Toolbar3D - Unified 3D rotating toolbar
 *
 * Uses useToolbar for everything:
 * - Space detection and items (auto from route)
 * - Page-specific items (set by pages)
 * - 3D rotation animation
 */
import ToolbarBreadcrumb from '../toolbar/Breadcrumb.vue'

const router = useRouter()
const {
  frontPanel,
  bottomPanel,
  rotationTransform,
  isRotating,
  toolbarItems,
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
  <div class="relative h-11 select-none ml-[22px] mr-[22px] mt-3 perspective-[1000px]" @contextmenu.prevent>
    <!-- Rotating Container -->
    <div class="w-full h-full relative transform-3d"
      :class="isRotating ? 'transition-transform duration-500 ease-in' : ''" :style="{ transform: rotationTransform }">
      <!-- Front Panel -->
      <div
        class="toolbar-panel absolute inset-0 w-full h-11 px-4 flex items-center gap-2 rounded-r-xl border border-[var(--app-border)] bg-[var(--app-surface)]"
        data-tauri-drag-region>
        <ToolbarBreadcrumb :path="frontPanel.path" />

        <!-- Left slot (after breadcrumb) -->
        <div id="toolbar-left" class="flex items-center" />

        <div class="flex-1" />

        <!-- Separator before toolbar items -->
        <template v-if="toolbarItems.length">
          <!-- <div class="w-px h-5 bg-[var(--app-border)]" /> -->

          <div class="flex items-center gap-0.5">
            <Tooltip v-for="item in toolbarItems" :key="item.id" :text="item.label">
              <button class="toolbar-btn" :class="item.active ? 'active' : ''" @click="handleItemClick(item)">
                <Icon :name="item.icon" class="size-4" />
              </button>
            </Tooltip>
          </div>
        </template>

        <!-- Center slot (via Teleport from pages) -->
        <div id="toolbar-center" class="flex items-center gap-1" />

        <div class="flex-1" />

        <!-- Right slot (via Teleport from pages) -->
        <div id="toolbar-right" class="flex items-center gap-0.5 mr-1" />
      </div>

      <!-- Bottom Panel (for rotation animation) -->
      <div
        class="toolbar-panel toolbar-panel--bottom absolute inset-0 w-full h-11 px-4 flex items-center gap-2 rounded-r-xl border border-[var(--app-border)] bg-[var(--app-surface)]"
        data-tauri-drag-region>
        <ToolbarBreadcrumb :path="bottomPanel.path" />

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
  </div>
</template>

<style scoped>
.toolbar-panel {
  backface-visibility: hidden;
  transform: translateZ(22px);
}

.toolbar-panel--bottom {
  transform: rotateX(-90deg) translateZ(22px);
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
</style>
