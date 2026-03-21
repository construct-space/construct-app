<script setup lang="ts">
/**
 * MarketplacePage — Browse and install remote spaces
 *
 * Search bar + category filter tabs + grid of RemoteSpace cards.
 * Until the Go backend ships, this shows an empty state.
 */

import { useSpaceMarketplace } from '@/composables/useSpaceMarketplace'
import {
  Search, Download, Check, RefreshCw, Star,
  ArrowLeft, Shield, Store,
} from 'lucide-vue-next'

const router = useRouter()
const marketplace = useSpaceMarketplace()

const categories = [
  { id: 'all', label: 'All' },
  { id: 'project', label: 'Project' },
  { id: 'app', label: 'App' },
  { id: 'both', label: 'Universal' },
]

// Track install-in-progress per space
const installing = ref<Set<string>>(new Set())

onMounted(async () => {
  await Promise.all([
    marketplace.fetchRemote(),
    marketplace.fetchInstalled(),
  ])
})

function setCategory(catId: string) {
  marketplace.activeCategory.value = catId
}

async function handleInstall(spaceId: string) {
  installing.value.add(spaceId)
  try {
    await marketplace.install(spaceId)
  } finally {
    installing.value.delete(spaceId)
  }
}

async function handleUpdate(spaceId: string) {
  installing.value.add(spaceId)
  try {
    await marketplace.update(spaceId)
  } finally {
    installing.value.delete(spaceId)
  }
}

function formatDownloads(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}
</script>

<template>
  <div class="h-full overflow-y-auto">
    <div class="max-w-5xl mx-auto px-6 py-10">
<!-- Header -->
      <div class="flex items-center gap-4 mb-8">
        <button
          class="p-2 rounded-lg hover:bg-[color-mix(in_srgb,var(--app-muted)_8%,transparent)] transition-colors"
          @click="router.push('/app/spaces')"
        >
          <ArrowLeft class="size-5 text-[var(--app-muted)]" />
        </button>
        <div>
          <p class="text-lg tracking-wide select-none mb-0.5">
            <span class="text-[var(--app-muted)] font-normal">CONSTRUCT:</span><span class="font-bold text-[var(--app-foreground)]">MARKETPLACE</span>
          </p>
          <p class="text-sm text-[var(--app-muted)]">Discover and install spaces from the community</p>
        </div>
      </div>

      <!-- Search bar -->
      <div class="relative mb-6">
        <Search class="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-[var(--app-muted)]" />
        <input
          v-model="marketplace.searchQuery.value"
          type="text"
          placeholder="Search spaces..."
          class="w-full pl-10 pr-4 py-2.5 rounded-lg border border-[var(--app-border)] bg-[var(--app-background)] text-[var(--app-foreground)] placeholder-[var(--app-muted)] text-sm focus:border-[var(--app-accent)] focus:outline-none transition-colors"
        />
      </div>

      <!-- Category tabs -->
      <div class="flex gap-1.5 mb-8 overflow-x-auto">
        <button
          v-for="cat in categories"
          :key="cat.id"
          class="px-3 py-1.5 rounded-md text-xs font-medium transition-all whitespace-nowrap"
          :class="marketplace.activeCategory.value === cat.id
            ? 'bg-[var(--app-accent)] text-white'
            : 'text-[var(--app-muted)] hover:bg-[color-mix(in_srgb,var(--app-muted)_8%,transparent)]'"
          @click="setCategory(cat.id)"
        >
          {{ cat.label }}
        </button>
      </div>

      <!-- Loading -->
      <div v-if="marketplace.isLoading.value" class="flex items-center justify-center py-20">
        <RefreshCw class="size-5 text-[var(--app-muted)] animate-spin" />
        <span class="ml-2 text-sm text-[var(--app-muted)]">Loading spaces...</span>
      </div>

      <!-- Empty state -->
      <div
        v-else-if="marketplace.filteredRemote.value.length === 0"
        class="text-center py-20"
      >
        <Store class="size-12 text-[var(--app-muted)] mx-auto mb-4 opacity-40" />
        <h3 class="text-lg font-semibold text-[var(--app-foreground)] mb-2">No spaces found</h3>
        <p class="text-sm text-[var(--app-muted)] max-w-sm mx-auto">
          No remote spaces match your search. Check back later for new community spaces,
          or browse your installed spaces.
        </p>
        <button
          class="mt-6 px-4 py-2 rounded-lg border border-[var(--app-border)] text-sm text-[var(--app-foreground)] hover:bg-[color-mix(in_srgb,var(--app-muted)_5%,transparent)] transition-colors"
          @click="router.push('/app/spaces')"
        >
          View Installed Spaces
        </button>
      </div>

      <!-- Error banner -->
      <div v-if="marketplace.error.value" class="mb-4 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400 flex items-center justify-between">
        <span>{{ marketplace.error.value }}</span>
        <button class="text-red-400/60 hover:text-red-400 text-xs" @click="marketplace.error.value = null">dismiss</button>
      </div>

      <!-- Space cards grid -->
      <div v-if="!marketplace.isLoading.value && marketplace.filteredRemote.value.length > 0" class="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <div
          v-for="space in marketplace.filteredRemote.value"
          :key="space.id"
          class="p-5 rounded-xl border border-[var(--app-border)] hover:border-[color-mix(in_srgb,var(--app-accent)_20%,transparent)] transition-all"
        >
          <!-- Top row: icon + meta -->
          <div class="flex items-start gap-3 mb-3">
            <div class="size-10 rounded-lg bg-[color-mix(in_srgb,var(--app-accent)_10%,transparent)] flex items-center justify-center shrink-0">
              <Icon :name="space.icon || 'i-lucide-box'" class="size-5 text-[var(--app-accent)]" />
            </div>
            <div class="min-w-0">
              <h3 class="text-sm font-semibold text-[var(--app-foreground)] truncate">{{ space.display_name }}</h3>
              <p class="text-[10px] text-[var(--app-muted)]">by {{ space.author }} &middot; v{{ space.version }}</p>
            </div>
          </div>

          <!-- Description -->
          <p class="text-xs text-[var(--app-muted)] line-clamp-2 mb-4 leading-relaxed">{{ space.description }}</p>

          <!-- Stats + action -->
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3 text-[10px] text-[var(--app-muted)]">
              <span class="flex items-center gap-0.5">
                <Star class="size-3" />
                {{ space.stars }}
              </span>
              <span class="flex items-center gap-0.5">
                <Download class="size-3" />
                {{ formatDownloads(space.downloads) }}
              </span>
            </div>

            <!-- Install / Installed / Update -->
            <button
              v-if="marketplace.hasUpdate(space.id)"
              class="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 transition-colors"
              :disabled="installing.has(space.id)"
              @click="handleUpdate(space.id)"
            >
              <RefreshCw class="size-3" :class="installing.has(space.id) ? 'animate-spin' : ''" />
              Update
            </button>
            <span
              v-else-if="marketplace.isInstalled(space.id)"
              class="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium text-[var(--app-accent)] bg-[color-mix(in_srgb,var(--app-accent)_10%,transparent)]"
            >
              <Check class="size-3" />
              Installed
            </span>
            <button
              v-else
              class="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-[var(--app-accent)] text-white hover:opacity-90 transition-opacity"
              :disabled="installing.has(space.id)"
              @click="handleInstall(space.id)"
            >
              <Download v-if="!installing.has(space.id)" class="size-3" />
              <RefreshCw v-else class="size-3 animate-spin" />
              Install
            </button>
          </div>

          <!-- Permissions notice -->
          <div
            v-if="space.permissions?.length"
            class="mt-3 pt-3 border-t border-[var(--app-border)]"
          >
            <div class="flex items-center gap-1 text-[10px] text-[var(--app-muted)]">
              <Shield class="size-3" />
              Requires {{ space.permissions.length }} permission{{ space.permissions.length > 1 ? 's' : '' }}
            </div>
          </div>
        </div>
      </div>
</div>
  </div>
</template>
