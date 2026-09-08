<script setup lang="ts">
import ToolbarSlot from '@/components/common/ToolbarSlot.vue'
/**
 * MarketplacePage — Browse and install remote spaces
 *
 * Search bar + category filter tabs + grid of RemoteSpace cards.
 * Until the Go backend ships, this shows an empty state.
 */

import {
  useSpaceMarketplace,
  marketplaceSpaceToRemote,
  fetchMarketplaceCollections,
  fetchMarketplaceCollection,
  type RemoteSpace,
} from '@/composables/useSpaceMarketplace'
import { useOrg } from '@/composables/useOrg'
import { Search, RefreshCw, Store } from 'lucide-vue-next'

const router = useRouter()
const marketplace = useSpaceMarketplace()
const { isOrg } = useOrg()

const scopeLabels: Record<string, string> = {
  app: 'Personal',
  org: 'Organization',
}

const categories = ref<{ id: string; label: string }[]>([{ id: 'all', label: 'All' }])
const allScopes = ref<{ id: string; label: string }[]>([{ id: 'all', label: 'All' }])

// Personal users don't see org-scoped spaces.
const scopes = computed(() => {
  if (isOrg.value) return allScopes.value
  return allScopes.value.filter(s => s.id !== 'company')
})

// Reset active scope if it becomes invalid for current context.
watch(isOrg, (org) => {
  if (!org && marketplace.activeScope.value === 'company') {
    marketplace.activeScope.value = 'all'
    marketplace.fetchRemote(1)
  }
}, { immediate: true })

async function fetchFilters() {
  try {
    const { fetchMarketplaceCategories } = await import('@/composables/useSpaceMarketplace')
    const cats = await fetchMarketplaceCategories()
    categories.value = [
      { id: 'all', label: 'All' },
      ...cats.map(c => ({ id: c.slug, label: c.title })),
    ]
    // marketplace-api doesn't expose scopes — they're a fixed enum on Space.scope.
    const SCOPES = ['app', 'org']
    allScopes.value = [
      { id: 'all', label: 'All' },
      ...SCOPES.map(s => ({
        id: s,
        label: scopeLabels[s] || s.charAt(0).toUpperCase() + s.slice(1),
      })),
    ]
  } catch { /* silent */ }
}

// Track install-in-progress per space
const installing = ref<Set<string>>(new Set())

// Sidebar: Categories drill-down is collapsed by default so the
// collections list stays the visual focus, App-Store-style.
const categoriesOpen = ref(false)

// Curated collections strip on the home view (no filters/search/pagination).
interface CollectionStrip { slug: string; title: string; spaces: RemoteSpace[] }
const collections = ref<CollectionStrip[]>([])
const collectionsLoading = ref(false)

const showHome = computed(() =>
  marketplace.activeCategory.value === 'all'
  && marketplace.activeScope.value === 'all'
  && marketplace.currentPage.value === 1
  && !marketplace.searchQuery.value.trim(),
)

async function loadCollections() {
  collectionsLoading.value = true
  try {
    const list = await fetchMarketplaceCollections()
    const expanded = await Promise.all(list.map(async (c) => {
      const detail = await fetchMarketplaceCollection(c.slug)
      const spaces = (detail?.spaces ?? []).map(marketplaceSpaceToRemote)
      return { slug: c.slug, title: c.title, spaces }
    }))
    collections.value = expanded.filter(c => c.spaces.length > 0)
  } finally {
    collectionsLoading.value = false
  }
}

onMounted(async () => {
  await Promise.all([
    fetchFilters(),
    loadCollections(),
    marketplace.fetchRemote(1),
    marketplace.fetchInstalled(),
  ])
})

// Re-fetch when search or category changes
let searchDebounce: ReturnType<typeof setTimeout> | null = null
watch(() => marketplace.searchQuery.value, () => {
  if (searchDebounce) clearTimeout(searchDebounce)
  searchDebounce = setTimeout(() => {
    marketplace.fetchRemote(1)
  }, 300)
})

function setCategory(catId: string) {
  marketplace.activeCategory.value = catId
  marketplace.fetchRemote(1)
}

function setScope(scopeId: string) {
  marketplace.activeScope.value = scopeId
  marketplace.fetchRemote(1)
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

// Build page number array with ellipsis: [1, 2, '...', 8, 9, 10]
const paginationPages = computed(() => {
  const current = marketplace.currentPage.value
  const total = marketplace.totalPages.value
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)

  const pages: (number | string)[] = []
  pages.push(1)
  if (current > 3) pages.push('...')

  const start = Math.max(2, current - 1)
  const end = Math.min(total - 1, current + 1)
  for (let i = start; i <= end; i++) pages.push(i)

  if (current < total - 2) pages.push('...')
  pages.push(total)
  return pages
})

function isRenderableRegistryIcon(icon: string | undefined): boolean {
  if (!icon) return false
  if (icon.startsWith('i-') || icon.startsWith('lucide:')) return true
  if (icon.startsWith('data:image/')) return true
  if (/^https?:\/\//.test(icon)) return true
  return !icon.includes('/') && !/\.(svg|png|webp|jpe?g|gif|ico)(\?|#|$)/i.test(icon)
}

function cardIcon(space: RemoteSpace): string {
  const installed = marketplace.installed.value.find(s => s.id === space.id || s.name === space.id)
  if (installed?.icon) return installed.icon
  return isRenderableRegistryIcon(space.icon) ? space.icon : 'i-lucide-box'
}
</script>

<template>
  <!-- Toolbar: search (left), pagination (center), per-page (right) -->
  <ToolbarSlot name="left">
    <div class="relative w-56">
      <Search class="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-[var(--app-muted)]" />
      <input
        v-model="marketplace.searchQuery.value"
        type="text"
        placeholder="Search spaces..."
        class="w-full pl-8 pr-3 py-1 rounded-md border border-[var(--app-border)] bg-transparent text-[var(--app-foreground)] placeholder-[var(--app-muted)] text-xs focus:border-[var(--app-accent)] focus:outline-none transition-colors"
      />
    </div>
  </ToolbarSlot>

  <ToolbarSlot name="center">
    <div v-if="marketplace.totalPages.value > 1" class="flex items-center gap-0.5">
      <Button
        icon="lucide:chevron-left"
        variant="ghost"
        size="2xs"
        :disabled="marketplace.currentPage.value <= 1"
        @click="marketplace.goToPage(marketplace.currentPage.value - 1)"
      />
      <template v-for="p in paginationPages" :key="p">
        <span v-if="p === '...'" class="px-0.5 text-[10px] text-[var(--app-muted)]">...</span>
        <button
          v-else
          class="size-6 rounded text-[10px] font-medium transition-all"
          :class="p === marketplace.currentPage.value
            ? 'bg-[var(--app-accent)] text-white'
            : 'text-[var(--app-muted)] hover:bg-[color-mix(in_srgb,var(--app-muted)_8%,transparent)]'"
          @click="marketplace.goToPage(p as number)"
        >
          {{ p }}
        </button>
      </template>
      <Button
        icon="lucide:chevron-right"
        variant="ghost"
        size="2xs"
        :disabled="marketplace.currentPage.value >= marketplace.totalPages.value"
        @click="marketplace.goToPage(marketplace.currentPage.value + 1)"
      />
      <span class="ml-1 text-[10px] text-[var(--app-muted)]">{{ marketplace.totalSpaces.value }}</span>
    </div>
  </ToolbarSlot>

  <ToolbarSlot name="right">
    <div class="flex items-center justify-end gap-2 min-w-0 max-w-[42vw] overflow-hidden">
      <select
        :value="marketplace.activeScope.value"
        class="min-w-0 max-w-36 text-xs bg-[var(--app-surface)] border border-[var(--app-border)] rounded-md px-2 py-1 text-[var(--app-foreground)] focus:outline-none focus:border-[var(--app-accent)] cursor-pointer"
        @change="setScope(($event.target as HTMLSelectElement).value)"
      >
        <option v-for="s in scopes" :key="s.id" :value="s.id">{{ s.label }}</option>
      </select>
      <select
        :value="marketplace.pageSize.value"
        class="min-w-0 max-w-32 text-xs bg-[var(--app-surface)] border border-[var(--app-border)] rounded-md px-2 py-1 text-[var(--app-foreground)] focus:outline-none focus:border-[var(--app-accent)] cursor-pointer"
        @change="marketplace.pageSize.value = Number(($event.target as HTMLSelectElement).value); marketplace.fetchRemote(1)"
      >
        <option v-for="n in [12, 24, 48, 96]" :key="n" :value="n">{{ n }} per page</option>
      </select>
    </div>
  </ToolbarSlot>

  <div class="h-full flex">
    <!-- Sidebar — App Store-style sections. Discover first (the curated
         home view), then one row per collection, then Categories +
         Updates anchored at the bottom. -->
    <aside class="w-56 shrink-0 py-4 px-2 overflow-y-auto flex flex-col gap-1 border-r border-[var(--app-border)]/40">
      <!-- Discover (home) -->
      <button
        class="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-all text-left"
        :class="marketplace.activeCategory.value === 'all' && !marketplace.searchQuery.value
          ? 'text-[var(--app-accent)] bg-[color-mix(in_srgb,var(--app-accent)_10%,transparent)] font-medium'
          : 'text-[var(--app-foreground)] hover:bg-[color-mix(in_srgb,var(--app-muted)_8%,transparent)]'"
        @click="setCategory('all')"
      >
        <Icon name="i-lucide-sparkles" class="size-4 shrink-0" />
        <span>Discover</span>
      </button>

      <!-- Curated collections — each routes to its detail page. -->
      <button
        v-for="col in collections"
        :key="col.slug"
        class="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-all text-left text-[var(--app-foreground)] hover:bg-[color-mix(in_srgb,var(--app-muted)_8%,transparent)]"
        @click="router.push(`/app/marketplace/collections/${col.slug}`)"
      >
        <Icon name="i-lucide-stars" class="size-4 shrink-0 text-[var(--app-muted)]" />
        <span class="truncate">{{ col.title }}</span>
      </button>

      <!-- Categories — drill-down toggle. Same auto-loaded list, just
           hidden behind a header so the sidebar doesn't get long. -->
      <div class="mt-2 pt-2 border-t border-[var(--app-border)]/40">
        <button
          class="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-all text-left text-[var(--app-foreground)] hover:bg-[color-mix(in_srgb,var(--app-muted)_8%,transparent)]"
          @click="categoriesOpen = !categoriesOpen"
        >
          <Icon name="i-lucide-layout-grid" class="size-4 shrink-0 text-[var(--app-muted)]" />
          <span class="flex-1">Categories</span>
          <Icon :name="categoriesOpen ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="size-3.5 text-[var(--app-muted)]" />
        </button>
        <div v-if="categoriesOpen" class="mt-1 ml-2 space-y-0.5">
          <button
            v-for="cat in categories.filter(c => c.id !== 'all')"
            :key="cat.id"
            class="w-full flex items-center px-3 py-1.5 rounded-md text-xs transition-all text-left"
            :class="marketplace.activeCategory.value === cat.id
              ? 'text-[var(--app-accent)] bg-[color-mix(in_srgb,var(--app-accent)_10%,transparent)] font-medium'
              : 'text-[var(--app-foreground)]/80 hover:bg-[color-mix(in_srgb,var(--app-muted)_8%,transparent)]'"
            @click="setCategory(cat.id)"
          >
            {{ cat.label }}
          </button>
        </div>
      </div>

      <!-- Updates — quick jump to installed spaces with pending updates. -->
      <button
        class="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-all text-left text-[var(--app-foreground)] hover:bg-[color-mix(in_srgb,var(--app-muted)_8%,transparent)]"
        @click="router.push('/app/spaces?tab=updates')"
      >
        <Icon name="i-lucide-cloud-download" class="size-4 shrink-0 text-[var(--app-muted)]" />
        <span>Updates</span>
      </button>
    </aside>

    <!-- Main content -->
    <div class="flex-1 min-w-0 overflow-y-auto">
      <div class="px-6 py-6">
<!-- Initial loading (no content yet) -->
      <div v-if="marketplace.isLoading.value && marketplace.filteredRemote.value.length === 0" class="flex items-center justify-center py-20">
        <RefreshCw class="size-5 text-[var(--app-muted)] animate-spin" />
        <span class="ml-2 text-sm text-[var(--app-muted)]">Loading spaces...</span>
      </div>

      <!-- Empty state -->
      <div
        v-else-if="!marketplace.isLoading.value && marketplace.filteredRemote.value.length === 0"
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

      <!-- Home view: curated collection strips on top -->
      <div v-if="showHome && collections.length > 0" class="mb-8 space-y-8">
        <section v-for="col in collections" :key="col.slug">
          <div class="flex items-end justify-between mb-3">
            <button
              type="button"
              class="text-base font-semibold text-[var(--app-foreground)] hover:text-[var(--app-accent)] transition-colors"
              @click="router.push(`/app/marketplace/collections/${col.slug}`)"
            >
              {{ col.title }}
            </button>
            <span class="text-[10px] text-[var(--app-muted)]">{{ col.spaces.length }} space{{ col.spaces.length === 1 ? '' : 's' }}</span>
          </div>
          <div class="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 snap-x">
            <div v-for="space in col.spaces" :key="space.id" class="snap-start shrink-0 w-72">
              <MarketplaceCard
                :space="space"
                :scopes="(marketplace.rawScopesById.value[space.id] as ('app'|'org')[] | undefined)"
                :project-aware="marketplace.rawProjectAwareById.value[space.id]"
                :icon="cardIcon(space)"
                :installed="marketplace.isInstalled(space.id)"
                :has-update="marketplace.hasUpdate(space.id)"
                :installing="installing.has(space.id)"
                @install="handleInstall"
                @update="handleUpdate"
                @open="(id) => router.push(`/app/${id}`)"
                @view-details="(id) => router.push(`/app/marketplace/spaces/${id}`)"
              />
            </div>
          </div>
        </section>
      </div>

      <!-- Heading for the full grid (only on home view, otherwise grid is the entire content) -->
      <div v-if="showHome && collections.length > 0 && marketplace.filteredRemote.value.length > 0" class="mb-3">
        <h2 class="text-base font-semibold text-[var(--app-foreground)]">All spaces</h2>
      </div>

      <!-- Space cards grid (stays visible during page transitions, dims while loading) -->
      <div v-if="marketplace.filteredRemote.value.length > 0"
        class="grid [grid-template-columns:repeat(auto-fill,minmax(260px,1fr))] gap-3 mb-8 transition-opacity duration-200"
        :class="marketplace.isLoading.value ? 'opacity-50 pointer-events-none' : 'opacity-100'">
        <MarketplaceCard
          v-for="space in marketplace.filteredRemote.value"
          :key="space.id"
          :space="space"
          :scopes="(marketplace.rawScopesById.value[space.id] as ('app'|'org')[] | undefined)"
          :project-aware="marketplace.rawProjectAwareById.value[space.id]"
          :icon="cardIcon(space)"
          :installed="marketplace.isInstalled(space.id)"
          :has-update="marketplace.hasUpdate(space.id)"
          :installing="installing.has(space.id)"
          @install="handleInstall"
          @update="handleUpdate"
          @open="(id) => router.push(`/app/${id}`)"
          @view-details="(id) => router.push(`/app/marketplace/spaces/${id}`)"
        />
      </div>
</div>
    </div>
  </div>
</template>
