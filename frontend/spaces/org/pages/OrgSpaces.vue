<script setup lang="ts">
/**
 * OrgSpaces — admin-curated list of marketplace spaces pinned to the
 * organization. Members of the org auto-install these spaces on next
 * login (handled elsewhere). Removing a pin does not uninstall from
 * existing members; it only stops the auto-sync.
 */
import { ref, computed, onMounted } from 'vue'
import { Boxes, Plus, Search, Trash2, Loader2 } from 'lucide-vue-next'
import { Badge, Button, Card, Empty, Input, Modal } from '@construct-space/ui'
import { useSource } from '@/composables/useSource'
import { appConfig } from '@/utils/config'
import type { MarketplaceSpace } from '@/composables/useSpaceMarketplace'
import ToolbarSlot from '@/components/common/ToolbarSlot.vue'

interface OrgSpacePin {
  id: string
  org_id: string
  space_id: string
  pinned_by: string
  created_at: string
}

const api = useSource()
const pins = ref<OrgSpacePin[]>([])
const loadingPins = ref(false)
const error = ref('')

// Marketplace lookup — pin row decoration + picker.
const marketplaceById = ref<Record<string, MarketplaceSpace>>({})

async function loadPins() {
  loadingPins.value = true
  error.value = ''
  try {
    const res = await api.get<OrgSpacePin[]>('/org/spaces')
    pins.value = Array.isArray(res) ? res : []
    // Hydrate marketplace details for any pin we don't already know
    const missing = pins.value.filter(p => !marketplaceById.value[p.space_id])
    await Promise.all(missing.map(p => fetchSpace(p.space_id)))
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load org spaces'
  } finally {
    loadingPins.value = false
  }
}

async function fetchSpace(id: string): Promise<MarketplaceSpace | null> {
  try {
    const r = await fetch(`${appConfig.marketplaceUrl}/spaces/${encodeURIComponent(id)}`)
    if (!r.ok) return null
    const data = await r.json() as MarketplaceSpace
    marketplaceById.value[id] = data
    return data
  } catch { return null }
}

// --- Picker modal ---
const showPicker = ref(false)
const pickerQuery = ref('')
const pickerResults = ref<MarketplaceSpace[]>([])
const pickerLoading = ref(false)

async function searchMarketplace() {
  pickerLoading.value = true
  try {
    const params = new URLSearchParams({ pageSize: '50' })
    if (pickerQuery.value.trim()) params.set('q', pickerQuery.value.trim())
    const r = await fetch(`${appConfig.marketplaceUrl}/spaces?${params}`)
    if (!r.ok) { pickerResults.value = []; return }
    const data = await r.json() as { spaces?: MarketplaceSpace[] }
    pickerResults.value = data.spaces ?? []
    for (const s of pickerResults.value) marketplaceById.value[s.id] = s
  } finally {
    pickerLoading.value = false
  }
}

function openPicker() {
  showPicker.value = true
  if (pickerResults.value.length === 0) searchMarketplace()
}

const pinnedIds = computed(() => new Set(pins.value.map(p => p.space_id)))

async function pinSpace(spaceId: string) {
  try {
    const created = await api.post<OrgSpacePin>('/org/spaces', { space_id: spaceId })
    if (created?.id && !pinnedIds.value.has(spaceId)) {
      pins.value.push(created)
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to pin space'
  }
}

async function unpinSpace(spaceId: string) {
  try {
    await api.delete(`/org/spaces/${encodeURIComponent(spaceId)}`)
    pins.value = pins.value.filter(p => p.space_id !== spaceId)
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to unpin'
  }
}

onMounted(loadPins)
</script>

<template>
  <div class="p-6 space-y-4">
    <ToolbarSlot name="right">
      <Button size="sm" label="Add space" @click="openPicker">
        <template #leading><Plus class="size-3.5" /></template>
      </Button>
    </ToolbarSlot>
    <!-- Header -->
    <Card variant="muted">
      <template #header>
        <div class="flex items-start gap-3 min-w-0 flex-1">
          <Boxes class="size-5 text-[var(--app-muted)] mt-1 shrink-0" />
          <div class="min-w-0 flex-1">
            <p class="text-[11px] tracking-[0.18em] uppercase font-medium text-[var(--app-muted)] leading-tight">
              Org spaces<span class="text-[var(--app-accent)]">.</span>
            </p>
            <h2 class="text-[22px] font-semibold tracking-[-0.015em] leading-none text-[var(--app-foreground)] mt-2">
              {{ pins.length }} pinned<span class="text-[var(--app-accent)]">.</span>
            </h2>
            <p class="text-sm text-[var(--app-muted)] mt-2 max-w-xl">
              Pinned spaces auto-install for every member of this organization on their next sign-in. Always tracks the latest published version.
            </p>
          </div>
        </div>
      </template>
    </Card>

    <div v-if="error" class="px-3 py-2 text-xs text-red-500 bg-red-500/10 rounded">{{ error }}</div>

    <!-- Pinned list -->
    <Card v-if="pins.length === 0 && !loadingPins">
      <Empty
        icon="i-lucide-boxes"
        title="No spaces pinned yet"
        description="Pick spaces from the marketplace to install for the whole org."
      >
        <Button size="sm" label="Browse marketplace" @click="openPicker">
          <template #leading><Plus class="size-3.5" /></template>
        </Button>
      </Empty>
    </Card>

    <Card v-else>
      <div class="divide-y divide-[var(--app-border)] -mx-5 -my-5">
        <div v-if="loadingPins" class="px-5 py-6 flex items-center gap-2 text-sm text-[var(--app-muted)]">
          <Loader2 class="size-4 animate-spin" /> Loading…
        </div>
        <div
          v-for="pin in pins"
          :key="pin.id"
          class="px-5 py-3 flex items-center gap-3"
        >
          <div class="size-9 rounded-md bg-[color-mix(in_srgb,var(--app-accent)_10%,transparent)] flex items-center justify-center text-[var(--app-accent)] shrink-0">
            <Boxes class="size-4" />
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <div class="text-sm font-medium text-[var(--app-foreground)] truncate">
                {{ marketplaceById[pin.space_id]?.name || pin.space_id }}
              </div>
              <Badge v-if="marketplaceById[pin.space_id]?.version" color="neutral" size="xs">v{{ marketplaceById[pin.space_id]?.version }}</Badge>
            </div>
            <div class="text-xs text-[var(--app-muted)] truncate">
              {{ marketplaceById[pin.space_id]?.description || pin.space_id }}
            </div>
          </div>
          <Button variant="ghost" size="xs" color="error" @click="unpinSpace(pin.space_id)">
            <template #leading><Trash2 class="size-3.5" /></template>
            Unpin
          </Button>
        </div>
      </div>
    </Card>

    <!-- Picker modal -->
    <Modal v-model:open="showPicker" title="Pin a marketplace space" :ui="{ content: 'w-full max-w-2xl max-h-[85vh]' }">
      <div class="space-y-3">
        <div class="relative">
          <Search class="size-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--app-muted)] z-10" />
          <Input
            v-model="pickerQuery"
            placeholder="Search marketplace…"
            size="sm"
            class="pl-8"
            @keydown.enter="searchMarketplace"
          />
        </div>

        <div class="min-h-[280px] max-h-[420px] overflow-y-auto -mx-2 px-2">
          <div v-if="pickerLoading" class="flex items-center justify-center py-12 text-sm text-[var(--app-muted)]">
            <Loader2 class="size-4 animate-spin mr-2" /> Searching…
          </div>
          <div v-else-if="pickerResults.length === 0" class="text-center text-sm text-[var(--app-muted)] py-12">
            No matches. Try a different search.
          </div>
          <div v-else class="grid grid-cols-1 gap-1">
            <button
              v-for="space in pickerResults"
              :key="space.id"
              type="button"
              class="w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-left transition-colors hover:bg-[color-mix(in_srgb,var(--app-muted)_8%,transparent)]"
              :disabled="pinnedIds.has(space.id)"
              @click="pinSpace(space.id)"
            >
              <div class="size-9 rounded-md bg-[color-mix(in_srgb,var(--app-accent)_10%,transparent)] flex items-center justify-center text-[var(--app-accent)] shrink-0">
                <Boxes class="size-4" />
              </div>
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2">
                  <div class="text-sm font-medium text-[var(--app-foreground)] truncate">{{ space.name }}</div>
                  <Badge v-if="space.version" color="neutral" size="xs">v{{ space.version }}</Badge>
                </div>
                <div class="text-xs text-[var(--app-muted)] truncate">{{ space.description }}</div>
              </div>
              <Badge v-if="pinnedIds.has(space.id)" color="success" size="xs">Pinned</Badge>
              <Plus v-else class="size-4 text-[var(--app-muted)]" />
            </button>
          </div>
        </div>
      </div>
    </Modal>
  </div>
</template>
