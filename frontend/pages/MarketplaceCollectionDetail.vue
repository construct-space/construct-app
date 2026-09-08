<script setup lang="ts">
/**
 * MarketplaceCollectionDetail — one curated collection in the Space Store.
 *
 * Renders the collection's title + description, then the same
 * MarketplaceCard grid the home view uses, populated from
 * marketplace-api's /collections/{slug} endpoint.
 *
 * Route: /app/marketplace/collections/:slug
 */
import { Card } from '@construct-space/ui'
import {
  fetchMarketplaceCollection,
  marketplaceSpaceToRemote,
  useSpaceMarketplace,
  type MarketplaceCollection,
  type RemoteSpace,
} from '@/composables/useSpaceMarketplace'
import MarketplaceCard from '@/components/marketplace/MarketplaceCard.vue'

const props = defineProps<{ slug: string }>()
const router = useRouter()
const marketplace = useSpaceMarketplace()

const collection = ref<MarketplaceCollection | null>(null)
const spaces = ref<RemoteSpace[]>([])
const rawScopesById = ref<Record<string, string[]>>({})
const rawProjectAwareById = ref<Record<string, boolean>>({})
const loading = ref(true)
const error = ref<string | null>(null)
const installing = ref<Set<string>>(new Set())

async function load() {
  loading.value = true
  error.value = null
  try {
    const data = await fetchMarketplaceCollection(props.slug)
    if (!data) {
      error.value = 'Collection not found.'
      collection.value = null
      spaces.value = []
      return
    }
    collection.value = data.collection
    // Convert MarketplaceSpace[] → RemoteSpace[] for the grid; also stash
    // scopes/project-awareness so the cards can render the chips.
    const scopes: Record<string, string[]> = {}
    const proj: Record<string, boolean> = {}
    for (const s of data.spaces) {
      scopes[s.id] = s.scopes || []
      proj[s.id] = !!s.project_aware
    }
    rawScopesById.value = scopes
    rawProjectAwareById.value = proj
    spaces.value = data.spaces.map(marketplaceSpaceToRemote)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

watch(() => props.slug, () => void load(), { immediate: true })

async function handleInstall(id: string) {
  installing.value.add(id)
  try { await marketplace.install(id) }
  finally { installing.value.delete(id) }
}
async function handleUpdate(id: string) {
  installing.value.add(id)
  try { await marketplace.update(id) }
  finally { installing.value.delete(id) }
}

// Card icon resolution mirrors MarketplacePage.cardIcon — fall back to a
// box glyph when the marketplace record doesn't carry a renderable icon.
function isRenderableRegistryIcon(icon: string | undefined): boolean {
  if (!icon) return false
  if (icon.startsWith('i-') || icon.startsWith('lucide:')) return true
  if (icon.startsWith('data:image/')) return true
  if (/^https?:\/\//.test(icon)) return true
  return !icon.includes('/') && !/\.(svg|png|webp|jpe?g|gif|ico)(\?|#|$)/i.test(icon)
}
function cardIcon(space: RemoteSpace): string {
  return isRenderableRegistryIcon(space.icon) ? space.icon : 'i-lucide-box'
}
</script>

<template>
  <div class="h-full overflow-y-auto px-6 py-6">
    <div v-if="loading" class="flex items-center justify-center py-20 text-sm text-[var(--app-muted)]">
      Loading…
    </div>

    <div v-else-if="error" class="max-w-2xl mx-auto py-20 text-center space-y-4">
      <p class="text-sm text-[var(--app-foreground)]">{{ error }}</p>
    </div>

    <div v-else-if="collection" class="max-w-6xl mx-auto space-y-4">
      <!-- Header card -->
      <Card variant="muted" :title="collection.title">
        <p v-if="collection.description" class="text-sm text-[var(--app-muted)] leading-relaxed">
          {{ collection.description }}
        </p>
        <p class="text-[10px] uppercase tracking-[0.14em] text-[var(--app-muted)] mt-3">
          {{ spaces.length }} space{{ spaces.length === 1 ? '' : 's' }}
        </p>
      </Card>

      <!-- Spaces grid — same layout as the main marketplace -->
      <div
        v-if="spaces.length > 0"
        class="grid [grid-template-columns:repeat(auto-fill,minmax(260px,1fr))] gap-3"
      >
        <MarketplaceCard
          v-for="s in spaces"
          :key="s.id"
          :space="s"
          :scopes="(rawScopesById[s.id] as ('app'|'org')[] | undefined)"
          :project-aware="rawProjectAwareById[s.id]"
          :icon="cardIcon(s)"
          :installed="marketplace.isInstalled(s.id)"
          :has-update="marketplace.hasUpdate(s.id)"
          :installing="installing.has(s.id)"
          @install="handleInstall"
          @update="handleUpdate"
          @open="(id) => router.push(`/app/${id}`)"
          @view-details="(id) => router.push(`/app/marketplace/spaces/${id}`)"
        />
      </div>

      <div v-else class="text-center py-20 text-sm text-[var(--app-muted)]">
        This collection is empty.
      </div>
    </div>
  </div>
</template>
