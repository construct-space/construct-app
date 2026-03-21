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

function handleItemClick(item: { id: string; onClick?: () => void; to?: string; action?: string }) {
  if (item.onClick) {
    item.onClick()
  } else if (item.to) {
    router.push(item.to)
  } else if (item.action) {
    console.log('Toolbar action:', item.action)
  }
}
</script>

<template>
  <div class="relative h-10 select-none" style="perspective: 1000px" @contextmenu.prevent>
    <!-- Rotating Container -->
    <div
      class="w-full h-full relative"
      :class="isRotating ? 'transition-transform duration-500 ease-in' : ''"
      :style="{
        transformStyle: 'preserve-3d',
        transform: rotationTransform
      }"
    >
      <!-- Front Panel -->
      <div
        class="absolute inset-0 w-full h-10 pl-4 pr-6 flex items-center gap-2 bg-app border-b border-gray-200/50 dark:border-gray-700/50"
        style="backface-visibility: hidden; transform: translateZ(20px)"
        data-tauri-drag-region>
        <ToolbarBreadcrumb :path="frontPanel.path" />

        <!-- Left slot (after breadcrumb) -->
        <div id="toolbar-left" class="flex items-center" />

        <div class="flex-1" />

        <!-- Separator before toolbar items -->
        <template v-if="toolbarItems.length">
          <div class="w-px h-4 bg-app-muted/30 ml-1" />

          <div class="flex items-center gap-1">
            <Tooltip
              v-for="item in toolbarItems" :key="item.id" :text="item.label">
              <Button
                :icon="item.icon" variant="ghost" color="neutral" size="xs"
                :class="item.active ? 'text-app-accent' : 'text-app-muted hover:text-app'"
                @click="handleItemClick(item)" />
            </Tooltip>
          </div>
        </template>

        <!-- Center slot (via Teleport from pages) -->
        <div id="toolbar-center" class="flex items-center gap-1" />

        <div class="flex-1" />

        <!-- Right slot (via Teleport from pages) -->
        <div id="toolbar-right" class="flex items-center gap-2 mr-2" />
      </div>

      <!-- Bottom Panel (for rotation animation) -->
      <div
        class="absolute inset-0 w-full h-10 pl-4 pr-6 flex items-center gap-2 bg-app border-b border-gray-200/50 dark:border-gray-700/50"
        style="backface-visibility: hidden; transform: rotateX(-90deg) translateZ(20px)"
        data-tauri-drag-region>
        <ToolbarBreadcrumb :path="bottomPanel.path" />

        <div class="flex-1" />

        <template v-if="bottomToolbarItems.length">
          <div class="w-px h-4 bg-app-muted/30 ml-1" />

          <div class="flex items-center gap-1">
            <Tooltip
              v-for="item in bottomToolbarItems" :key="item.id" :text="item.label">
              <Button
                :icon="item.icon" variant="ghost" color="neutral" size="xs"
                :class="item.active ? 'text-app-accent' : 'text-app-muted hover:text-app'"
                @click="handleItemClick(item)" />
            </Tooltip>
          </div>
        </template>

        <div class="flex-1" />
      </div>
    </div>
  </div>
</template>
