<script setup lang="ts">
/**
 * SpacesPage — Launchpad-style grid of all available spaces
 *
 * Shows all built-in + installed spaces with management features.
 * Users can pin/unpin, enable/disable, update, and uninstall spaces.
 */

import { useSpaces } from '@/composables/useSpaces'
import { useSpaceMarketplace } from '@/composables/useSpaceMarketplace'
import { usePinnedStore, createSpacePin } from '@/stores/pinned'
import { useToast } from '@/composables/useToast'
import { getSpace as getSpaceConfig } from '@/config/spaces'
import {
  Pin, PinOff, ArrowRight, Store,
  RefreshCw, Download, ToggleLeft, ToggleRight, Trash2,
  MoreVertical,
} from 'lucide-vue-next'

const router = useRouter()
const { spaces, loadSpaces } = useSpaces()
const marketplace = useSpaceMarketplace()
const pinnedStore = usePinnedStore()
const toast = useToast()

const openMenu = ref<string | null>(null)
const confirmUninstall = ref<string | null>(null)

const onSpacesChanged = () => { loadSpaces() }
onMounted(async () => {
  if (spaces.value.length === 0) {
    await loadSpaces()
  }
  if (pinnedStore.items.length === 0) {
    await pinnedStore.init()
  }
  await marketplace.fetchInstalled()
  window.addEventListener('construct:spaces-changed', onSpacesChanged)
})
onUnmounted(() => {
  window.removeEventListener('construct:spaces-changed', onSpacesChanged)
})

const spaceCards = computed(() => {
  return spaces.value.map(s => {
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

function toggleMenu(spaceName: string) {
  openMenu.value = openMenu.value === spaceName ? null : spaceName
  confirmUninstall.value = null
}

function closeMenu() {
  openMenu.value = null
  confirmUninstall.value = null
}

async function togglePin(space: typeof spaceCards.value[0]) {
  const pin = createSpacePin({
    name: space.displayName,
    spaceId: space.name,
    icon: space.icon,
  })
  await pinnedStore.togglePin(pin)
}

async function handleToggle(space: typeof spaceCards.value[0]) {
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

async function handleCheckUpdates() {
  const count = await marketplace.checkUpdates()
  toast.add(count > 0
    ? { title: `${count} update${count > 1 ? 's' : ''} available`, color: 'warning' }
    : { title: 'All spaces are up to date', color: 'success' },
  )
}

async function handleUninstall(spaceId: string) {
  await marketplace.uninstall(spaceId)
  closeMenu()
  await loadSpaces()
}

function navigateToSpace(spaceName: string) {
  router.push(`/app/${spaceName}`)
}

function openMarketplace() {
  router.push('/app/marketplace')
}
</script>

<template>
  <div class="h-screen overflow-y-auto" @click="closeMenu">
    <div class="max-w-4xl mx-auto px-6 py-10">
      <!-- Header -->
      <div class="flex items-center justify-between mb-8">
        <div>
          <p class="text-lg tracking-wide select-none mb-1">
            <span class="text-[var(--app-muted)] font-normal">CONSTRUCT:</span><span class="font-bold text-[var(--app-foreground)]">SPACES</span>
          </p>
          <p class="text-sm text-[var(--app-muted)]">All available spaces. Pin your favorites to the sidebar dock.</p>
        </div>
        <div class="flex gap-2">
          <button
            class="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border border-[var(--app-border)] text-[var(--app-foreground)] hover:bg-[color-mix(in_srgb,var(--app-muted)_5%,transparent)] transition-colors disabled:opacity-50"
            :disabled="marketplace.isCheckingUpdates.value"
            @click.stop="handleCheckUpdates()"
          >
            <RefreshCw class="size-3" :class="marketplace.isCheckingUpdates.value ? 'animate-spin' : ''" />
            {{ marketplace.isCheckingUpdates.value ? 'Checking...' : 'Check Updates' }}
          </button>
          <button
            class="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-[var(--app-accent)] text-white hover:opacity-90 transition-opacity"
            @click="openMarketplace"
          >
            <Store class="size-3" />
            Browse Marketplace
          </button>
        </div>
      </div>

      <!-- Space grid -->
      <div class="grid grid-cols-2 md:grid-cols-3 gap-4 mb-10">
        <div
          v-for="space in spaceCards"
          :key="space.name"
          class="group relative text-left p-5 rounded-xl border transition-all"
          :class="space.enabled
            ? 'border-[var(--app-border)] hover:border-[color-mix(in_srgb,var(--app-accent)_30%,transparent)] hover:bg-[color-mix(in_srgb,var(--app-accent)_3%,transparent)]'
            : 'border-[var(--app-border)] opacity-50'"
        >
          <!-- Top-right: 3-dot menu on hover -->
          <div class="absolute top-3 right-3 z-10">
            <button
              class="p-1 rounded-md text-[var(--app-muted)] transition-all cursor-pointer"
              :class="openMenu === space.name ? 'opacity-100 bg-[color-mix(in_srgb,var(--app-muted)_10%,transparent)]' : 'opacity-0 group-hover:opacity-100 hover:bg-[color-mix(in_srgb,var(--app-muted)_10%,transparent)]'"
              @click.stop="toggleMenu(space.name)"
            >
              <MoreVertical class="size-4" />
            </button>

            <!-- Dropdown menu -->
            <div
              v-if="openMenu === space.name"
              class="absolute top-8 right-0 w-44 py-1 rounded-lg border border-[var(--app-border)] bg-[var(--app-background)] shadow-xl z-20"
              @click.stop
            >
              <!-- Pin/Unpin -->
              <button
                class="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-[var(--app-foreground)] hover:bg-[color-mix(in_srgb,var(--app-muted)_8%,transparent)] transition-colors"
                @click.stop="togglePin(space); closeMenu()"
              >
                <component :is="space.isPinned ? PinOff : Pin" class="size-3.5" />
                {{ space.isPinned ? 'Unpin from sidebar' : 'Pin to sidebar' }}
              </button>

              <!-- Enable/Disable (installed spaces only) -->
              <button
                v-if="space.isInstalled"
                class="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-[var(--app-foreground)] hover:bg-[color-mix(in_srgb,var(--app-muted)_8%,transparent)] transition-colors"
                @click.stop="handleToggle(space)"
              >
                <component :is="space.enabled ? ToggleLeft : ToggleRight" class="size-3.5" />
                {{ space.enabled ? 'Disable' : 'Enable' }}
              </button>

              <!-- Check for update -->
              <button
                v-if="space.isInstalled"
                class="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-[var(--app-foreground)] hover:bg-[color-mix(in_srgb,var(--app-muted)_8%,transparent)] transition-colors"
                @click.stop="handleCheckUpdates(); closeMenu()"
              >
                <RefreshCw class="size-3.5" />
                Check for update
              </button>

              <!-- Update (if available) -->
              <button
                v-if="space.hasUpdate"
                class="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-amber-400 hover:bg-amber-400/10 transition-colors"
                @click.stop="handleUpdate(space.name)"
              >
                <Download class="size-3.5" />
                Update to v{{ space.latestVersion }}
              </button>

              <div v-if="space.isInstalled" class="my-1 border-t border-[var(--app-border)]" />

              <!-- Uninstall -->
              <template v-if="space.isInstalled">
                <button
                  v-if="confirmUninstall !== space.name"
                  class="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-red-400 hover:bg-red-400/10 transition-colors"
                  @click.stop="confirmUninstall = space.name"
                >
                  <Trash2 class="size-3.5" />
                  Uninstall
                </button>
                <div v-else class="flex items-center gap-1 px-3 py-1.5">
                  <button
                    class="px-2 py-1 rounded text-[10px] font-medium text-red-400 bg-red-400/10 hover:bg-red-400/20 transition-colors"
                    @click.stop="handleUninstall(space.name)"
                  >
                    Confirm uninstall
                  </button>
                  <button
                    class="px-2 py-1 rounded text-[10px] text-[var(--app-muted)] hover:bg-[color-mix(in_srgb,var(--app-muted)_8%,transparent)] transition-colors"
                    @click.stop="confirmUninstall = null"
                  >
                    Cancel
                  </button>
                </div>
              </template>
            </div>
          </div>

          <!-- Installed badge + version -->
          <div class="flex items-center gap-1.5 mb-3 min-h-[18px]">
            <span
              v-if="space.isInstalled"
              class="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[color-mix(in_srgb,var(--app-accent)_12%,transparent)] text-[var(--app-accent)]"
            >
              Installed
            </span>
            <span
              v-if="space.version"
              class="text-[9px] text-[var(--app-muted)] bg-[color-mix(in_srgb,var(--app-muted)_8%,transparent)] px-1.5 py-0.5 rounded"
            >
              v{{ space.version }}
            </span>
            <span
              v-if="space.hasUpdate"
              class="text-[9px] font-semibold text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded"
            >
              Update available
            </span>
          </div>

          <!-- Clickable card body -->
          <button
            class="block w-full text-left"
            @click="navigateToSpace(space.name)"
          >
            <!-- Icon -->
            <div
              class="size-10 rounded-lg flex items-center justify-center mb-3"
              :class="space.bg"
            >
              <Icon :name="space.icon" class="size-5" :class="space.color" />
            </div>

            <!-- Name & description -->
            <h3 class="text-sm font-semibold text-[var(--app-foreground)] mb-1">{{ space.displayName }}</h3>
            <p class="text-xs text-[var(--app-muted)] line-clamp-2 leading-relaxed">{{ space.description }}</p>
          </button>

          <!-- Navigate arrow -->
          <ArrowRight class="absolute bottom-4 right-4 size-3.5 text-[var(--app-muted)] opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
      </div>

      <!-- Browse Marketplace -->
      <div class="border-t border-[var(--app-border)] pt-8">
        <button
          class="flex items-center gap-3 px-5 py-3.5 rounded-xl border border-dashed border-[var(--app-border)] hover:border-[var(--app-accent)] hover:bg-[color-mix(in_srgb,var(--app-accent)_3%,transparent)] transition-all w-full text-left"
          @click="openMarketplace"
        >
          <Store class="size-5 text-[var(--app-muted)]" />
          <div>
            <p class="text-sm font-medium text-[var(--app-foreground)]">Browse Marketplace</p>
            <p class="text-xs text-[var(--app-muted)]">Discover and install more spaces from the community</p>
          </div>
          <ArrowRight class="size-4 text-[var(--app-muted)] ml-auto" />
        </button>
      </div>
    </div>
  </div>
</template>
