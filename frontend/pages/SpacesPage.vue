<script setup lang="ts">
/**
 * SpacesPage — Launchpad-style grid of all available spaces
 *
 * Shows all built-in + installed spaces with management features.
 * Users can pin/unpin, enable/disable, update, and uninstall spaces.
 */

import { useDebounceFn } from '@vueuse/core'
import { useSpaces } from '@/composables/useSpaces'
import { useSpaceMarketplace } from '@/composables/useSpaceMarketplace'
import { usePinnedStore, createSpacePin } from '@/stores/pinned'
import { useNotification } from '@/composables/useNotification'
import { getSpace as getSpaceConfig } from '@/config/spaces'
import { isCoreSpace } from '@/space_loader/coreSpaces'
import ToolbarSlot from '@/components/common/ToolbarSlot.vue'
import { useSpaceRunner } from '@/composables/useSpaceRunner'
import {
  Pin, PinOff, Store,
  Download, Trash2,
  ExternalLink, Search, X,
} from 'lucide-vue-next'

const router = useRouter()
const { spaces, loadSpaces } = useSpaces()
const marketplace = useSpaceMarketplace()
const pinnedStore = usePinnedStore()
const toast = useNotification()
const { openRunner } = useSpaceRunner()

const openMenu = ref<string | null>(null)
const confirmUninstall = ref<string | null>(null)
const searchQuery = ref('')
const searchInput = ref<HTMLInputElement | null>(null)

const isMac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC')
const searchHint = isMac ? '⌘K' : 'Ctrl K'

function focusSearch() {
  searchInput.value?.focus()
  searchInput.value?.select()
}

// Page-level shortcut: ⌘K / Ctrl+K from anywhere, or "/" when not already
// typing into a field. Escape (handled inline on the input) clears + blurs.
function onSearchShortcut(e: KeyboardEvent) {
  const mod = e.metaKey || e.ctrlKey
  if (mod && (e.key === 'k' || e.key === 'K')) {
    e.preventDefault()
    focusSearch()
    return
  }
  if (e.key === '/' && !mod) {
    const t = e.target as HTMLElement | null
    const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
    if (typing) return
    e.preventDefault()
    focusSearch()
  }
}
// Viewport-relative anchor for the right-click menu. Fixed-positioned so it
// escapes the grid's overflow:auto clipping and lands at the cursor.
const menuPos = ref({ x: 0, y: 0 })
const activeFilter = ref('all')

const filterCategories = [
  { id: 'all', label: 'All' },
  { id: 'pinned', label: 'Pinned' },
  { id: 'updates', label: 'Updates' },
]

const filteredSpaces = computed(() => {
  let list = spaceCards.value
  if (activeFilter.value === 'pinned') list = list.filter(s => s.isPinned)
  else if (activeFilter.value === 'updates') list = list.filter(s => s.hasUpdate)
  const q = searchQuery.value.trim().toLowerCase()
  if (q) {
    // Match name/displayName only — searching descriptions produces
    // surprising hits (e.g. "Mail" matching "email" in Pulses' blurb).
    list = list.filter(s =>
      s.displayName.toLowerCase().includes(q)
      || s.name.toLowerCase().includes(q),
    )
  }
  // Default to alphabetical order by display name (case-insensitive,
  // locale-aware). Copy first so we never mutate spaceCards' cached array.
  return [...list].sort((a, b) =>
    a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' }),
  )
})

// Debounced: coalesce bursts of spaces-changed into one manifest reload.
const onSpacesChanged = useDebounceFn(() => { loadSpaces() }, 250)
onMounted(async () => {
  if (spaces.value.length === 0) {
    await loadSpaces()
  }
  if (pinnedStore.items.length === 0) {
    await pinnedStore.init()
  }
  await marketplace.fetchInstalled()
  window.addEventListener('construct:spaces-changed', onSpacesChanged)
  window.addEventListener('keydown', onSearchShortcut)
})
onUnmounted(() => {
  window.removeEventListener('construct:spaces-changed', onSpacesChanged)
  window.removeEventListener('keydown', onSearchShortcut)
})

const spaceCards = computed(() => {
  return spaces.value.filter(s => !isCoreSpace(s.name)).map(s => {
    const config = getSpaceConfig(s.name)
    const pinId = `space-global-${s.name}`
    const installed = marketplace.installed.value.find(i => i.id === s.name || i.name === s.name)
    return {
      name: s.name,
      displayName: s.displayName || s.name,
      description: s.description || config.description,
      icon: config.icon,
      color: config.color,
      bg: config.bg,
      isPinned: pinnedStore.isPinned(pinId),
      pinId,
      isInstalled: s.isInstalled ?? false,
      version: installed?.version,
      hasUpdate: installed?.has_update ?? false,
      latestVersion: installed?.latest_version,
      enabled: installed?.enabled ?? true,
    }
  })
})

function openContextMenu(e: MouseEvent, spaceName: string) {
  e.preventDefault()
  confirmUninstall.value = null
  openMenu.value = spaceName
  // Clamp to the viewport so the menu never spills off-screen near the
  // right/bottom edges. Dimensions are an upper estimate of the menu box.
  const menuW = 180
  const menuH = 170
  menuPos.value = {
    x: Math.max(8, Math.min(e.clientX, window.innerWidth - menuW - 8)),
    y: Math.max(8, Math.min(e.clientY, window.innerHeight - menuH - 8)),
  }
}

function closeMenu() {
  openMenu.value = null
  confirmUninstall.value = null
}

async function openInWindow(space: typeof spaceCards.value[0]) {
  closeMenu()
  await openRunner({ spaceId: space.name })
}

async function togglePin(space: typeof spaceCards.value[0]) {
  const pin = createSpacePin({
    name: space.displayName,
    spaceId: space.name,
    icon: space.icon,
  })
  await pinnedStore.togglePin(pin)
}

async function _handleToggle(space: typeof spaceCards.value[0]) {
  if (space.enabled) {
    await marketplace.disable(space.name)
  } else {
    await marketplace.enable(space.name)
  }
  closeMenu()
  await loadSpaces()
}

async function handleUpdate(spaceId: string) {
  await marketplace.update(spaceId)
  closeMenu()
}

const updatingAll = ref(false)

async function handleCheckUpdates() {
  const count = await marketplace.checkUpdates()
  toast.add(count > 0
    ? { title: `${count} update${count > 1 ? 's' : ''} available`, color: 'warning' }
    : { title: 'All spaces are up to date', color: 'success' },
  )
}

const updatableSpaces = computed(() => spaceCards.value.filter(s => s.hasUpdate))

async function handleUpdateAll() {
  updatingAll.value = true
  for (const space of updatableSpaces.value) {
    await marketplace.update(space.name)
  }
  await loadSpaces()
  updatingAll.value = false
  toast.add({ title: 'All spaces updated', color: 'success' })
}

async function handleUninstall(spaceId: string) {
  await marketplace.uninstall(spaceId)
  closeMenu()
  await loadSpaces()
}

// Mouse-based drag to sidebar (Tauri blocks HTML5 drag)
function onMouseDown(e: MouseEvent, space: typeof spaceCards.value[0]) {
  // Left button only — right-click is reserved for the context menu.
  if (e.button !== 0) return
  const startX = e.clientX
  const startY = e.clientY
  let dragging = false

  function onMove(e: MouseEvent) {
    if (!dragging && (Math.abs(e.clientX - startX) > 5 || Math.abs(e.clientY - startY) > 5)) {
      dragging = true
      window.dispatchEvent(new CustomEvent('construct:space-drag-start', { detail: space }))
    }
    if (dragging) {
      window.dispatchEvent(new CustomEvent('construct:space-drag-move', { detail: { x: e.clientX, y: e.clientY } }))
    }
  }

  function onUp(e: MouseEvent) {
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
    if (dragging) {
      window.dispatchEvent(new CustomEvent('construct:space-drag-drop', { detail: { ...space, x: e.clientX, y: e.clientY } }))
    }
  }

  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}

function navigateToSpace(spaceName: string) {
  router.push(`/app/${spaceName}`)
}

function openMarketplace() {
  router.push('/app/marketplace')
}
</script>

<template>
  <!-- Toolbar -->
  <ToolbarSlot name="left">
    <div class="flex gap-1">
      <button
        v-for="cat in filterCategories"
        :key="cat.id"
        class="px-2 py-0.5 rounded text-[10px] font-medium transition-all whitespace-nowrap"
        :class="activeFilter === cat.id
          ? 'bg-[var(--app-accent)] text-white'
          : 'text-[var(--app-muted)] hover:bg-[color-mix(in_srgb,var(--app-muted)_8%,transparent)]'"
        @click="activeFilter = cat.id"
      >
        {{ cat.label }}
      </button>
    </div>
  </ToolbarSlot>
  <ToolbarSlot name="center">
    <div class="relative">
      <Search class="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-[var(--app-muted)] pointer-events-none" />
      <input
        ref="searchInput"
        v-model="searchQuery"
        type="text"
        placeholder="Search installed spaces…"
        class="h-7 w-64 pl-7 pr-12 rounded-md text-xs bg-[var(--app-input-bg)] text-[var(--app-foreground)] placeholder:text-[var(--app-muted)] border border-[var(--app-border)] focus:border-[var(--app-accent)] focus:outline-none transition-colors"
        @keydown.escape="searchQuery = ''; searchInput?.blur()"
      >
      <!-- Clear (×) when there's a query, otherwise the shortcut hint. -->
      <button
        v-if="searchQuery"
        class="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-[var(--app-muted)] hover:text-[var(--app-foreground)] transition-colors"
        @click="searchQuery = ''; focusSearch()"
      >
        <X class="size-3" />
      </button>
      <kbd
        v-else
        class="absolute right-1.5 top-1/2 -translate-y-1/2 px-1 py-0.5 rounded text-[9px] font-medium leading-none text-[var(--app-muted)] bg-[color-mix(in_srgb,var(--app-muted)_12%,transparent)] pointer-events-none"
      >{{ searchHint }}</kbd>
    </div>
  </ToolbarSlot>
  <ToolbarSlot name="right">
    <div class="flex items-center justify-end gap-0.5 min-w-0 overflow-hidden">
      <Tooltip v-if="updatableSpaces.length > 0" :text="updatingAll ? 'Updating...' : `Update All (${updatableSpaces.length})`">
        <Button icon="lucide:download" variant="ghost" size="sm" color="warning" :disabled="updatingAll" @click.stop="handleUpdateAll()" />
      </Tooltip>
      <Tooltip :text="marketplace.isCheckingUpdates.value ? 'Checking...' : 'Check Updates'">
        <Button icon="lucide:cloud-download" variant="ghost" size="sm" :disabled="marketplace.isCheckingUpdates.value" @click.stop="handleCheckUpdates()" />
      </Tooltip>
      <!-- Space Store entry — teleported into the toolbar from this page
           only (the installed-spaces screen), since that's where it's
           most relevant. Other pages don't need a permanent shortcut.
           Tailwind-styled inline because Toolbar3D's .toolbar-btn-text
           is scoped and doesn't reach teleported content. -->
      <Tooltip text="Browse the Space Store">
        <button
          type="button"
          class="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md text-xs whitespace-nowrap shrink-0 text-[var(--app-muted)] hover:bg-[var(--app-input-bg)] hover:text-[var(--app-foreground)] transition-colors"
          @click="openMarketplace"
        >
          <Store class="size-3.5" />
          <span class="uppercase tracking-wider"><span class="font-normal opacity-70">Space</span><span class="font-bold">Store</span></span>
        </button>
      </Tooltip>
    </div>
  </ToolbarSlot>

  <div class="h-full overflow-y-auto px-6 py-6" @click="closeMenu">
    <!-- Empty state -->
    <div v-if="filteredSpaces.length === 0 && spaceCards.length === 0" class="flex flex-col items-center justify-center py-20 text-center">
      <Store class="size-10 text-[var(--app-muted)]/40 mb-4" />
      <p class="text-sm font-medium text-[var(--app-foreground)] mb-1">No spaces installed yet</p>
      <p class="text-xs text-[var(--app-muted)] mb-4">Browse the Space Store to discover and install spaces.</p>
      <button
        class="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium bg-[var(--app-accent)] text-white hover:opacity-90 transition-opacity"
        @click="openMarketplace">
        <Store class="size-3" />
        Open Space Store
      </button>
    </div>

    <!-- No results for filter -->
    <div v-else-if="filteredSpaces.length === 0" class="text-center py-20">
      <p class="text-sm text-[var(--app-muted)]">
        {{ searchQuery.trim() ? `No spaces match “${searchQuery.trim()}”.` : 'No spaces match this filter.' }}
      </p>
    </div>

    <!-- App-icon grid -->
    <div v-else class="grid justify-center gap-x-8 gap-y-5 [grid-template-columns:repeat(auto-fill,88px)]">
      <div
        v-for="space in filteredSpaces"
        :key="space.name"
        class="group relative flex w-[88px] flex-col items-center text-center"
        @contextmenu.prevent.stop="openContextMenu($event, space.name)"
      >
        <!-- Right-click context menu — fixed at the cursor so it escapes the
             grid's overflow clipping. -->
        <div v-if="openMenu === space.name"
          class="fixed w-44 py-1 rounded-lg border border-[var(--app-border)] bg-[var(--app-background)] shadow-xl z-50"
          :style="{ left: menuPos.x + 'px', top: menuPos.y + 'px' }"
          @click.stop>
          <button
            class="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-[var(--app-foreground)] hover:bg-[color-mix(in_srgb,var(--app-muted)_8%,transparent)] transition-colors"
            @click.stop="openInWindow(space)">
            <ExternalLink class="size-3.5" />
            Open in separate window
          </button>
          <button
            class="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-[var(--app-foreground)] hover:bg-[color-mix(in_srgb,var(--app-muted)_8%,transparent)] transition-colors"
            @click.stop="togglePin(space); closeMenu()">
            <component :is="space.isPinned ? PinOff : Pin" class="size-3.5" />
            {{ space.isPinned ? 'Unpin from sidebar' : 'Pin to sidebar' }}
          </button>
          <button v-if="space.hasUpdate"
            class="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-amber-400 hover:bg-amber-400/10 transition-colors"
            @click.stop="handleUpdate(space.name)">
            <Download class="size-3.5" />
            Update to v{{ space.latestVersion }}
          </button>
          <div v-if="space.isInstalled" class="my-1 border-t border-[var(--app-border)]" />
          <template v-if="space.isInstalled">
            <button v-if="confirmUninstall !== space.name"
              class="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-red-400 hover:bg-red-400/10 transition-colors"
              @click.stop="confirmUninstall = space.name">
              <Trash2 class="size-3.5" />
              Uninstall
            </button>
            <div v-else class="flex items-center gap-1 px-3 py-1.5">
              <button class="px-2 py-1 rounded text-[10px] font-medium text-red-400 bg-red-400/10 hover:bg-red-400/20" @click.stop="handleUninstall(space.name)">Confirm</button>
              <button class="px-2 py-1 rounded text-[10px] text-[var(--app-muted)]" @click.stop="confirmUninstall = null">Cancel</button>
            </div>
          </template>
        </div>

        <!-- App icon (drag to sidebar to pin) -->
        <button
          class="size-16 rounded-2xl flex items-center justify-center mb-2 transition-all cursor-grab active:cursor-grabbing"
          :class="space.enabled
            ? 'bg-[var(--app-surface)] hover:bg-[color-mix(in_srgb,var(--app-accent)_10%,transparent)] hover:scale-105'
            : 'bg-[var(--app-surface)] opacity-40'"
          @click="navigateToSpace(space.name)"
          @mousedown="onMouseDown($event, space)"
        >
          <Icon :name="space.icon" class="size-7" :class="space.enabled ? space.color : 'text-[var(--app-muted)]'" />
        </button>

        <!-- Name -->
        <span class="text-[11px] font-medium text-[var(--app-foreground)] leading-tight truncate w-full" :class="!space.enabled && 'opacity-40'">
          {{ space.displayName }}
        </span>

        <!-- Update badge -->
        <span v-if="space.hasUpdate" class="text-[8px] text-amber-400 mt-0.5">update</span>
      </div>
    </div>
  </div>
</template>
