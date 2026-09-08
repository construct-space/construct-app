<script setup lang="ts">
/**
 * MarketplaceSpaceDetail — single-space detail page in the Space Store.
 *
 * Fetches the full record from marketplace-api (description, manifest,
 * scopes, stats, publisher) and renders a hero + body. Install / Open /
 * Update buttons reuse the same useSpaceMarketplace flow as the grid.
 *
 * Route: /app/marketplace/spaces/:id
 */
import { Card, Button } from '@construct-space/ui'
import {
  fetchMarketplaceSpace,
  useSpaceMarketplace,
  type MarketplaceSpace,
} from '@/composables/useSpaceMarketplace'

const props = defineProps<{ id: string }>()
const router = useRouter()
const marketplace = useSpaceMarketplace()

const space = ref<MarketplaceSpace | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)
const installing = ref(false)

async function load() {
  loading.value = true
  error.value = null
  try {
    const data = await fetchMarketplaceSpace(props.id)
    if (!data) {
      error.value = 'Space not found, or it has no published version yet.'
      space.value = null
    } else {
      space.value = data
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

watch(() => props.id, () => void load(), { immediate: true })

const installed = computed(() => space.value ? marketplace.isInstalled(space.value.id) : false)
const hasUpdate = computed(() => space.value ? marketplace.hasUpdate(space.value.id) : false)

async function handleInstall() {
  if (!space.value) return
  installing.value = true
  try { await marketplace.install(space.value.id) }
  finally { installing.value = false }
}
async function handleUpdate() {
  if (!space.value) return
  installing.value = true
  try { await marketplace.update(space.value.id) }
  finally { installing.value = false }
}
function handleOpen() {
  if (!space.value) return
  router.push(`/app/${space.value.id}`)
}

// Best-effort manifest inspection — counts pages / tools so the
// "What's included" card can show real numbers without the user
// having to install first. The manifest is typed as `unknown` in
// MarketplaceSpace; we narrow defensively.
const manifestStats = computed(() => {
  const m = space.value?.manifest as Record<string, unknown> | undefined
  if (!m) return null
  const pages = Array.isArray(m.pages) ? m.pages.length : 0
  const tools = Array.isArray((m as { tools?: unknown }).tools)
    ? ((m as { tools: unknown[] }).tools.length)
    : 0
  const widgets = Array.isArray((m as { widgets?: unknown }).widgets)
    ? ((m as { widgets: unknown[] }).widgets.length)
    : 0
  return { pages, tools, widgets }
})

function formatNumber(n: number | undefined): string {
  if (!n) return '0'
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

function formatDate(iso: string | undefined): string {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) }
  catch { return iso }
}

const iconUrl = computed(() => {
  const icon = space.value?.icon
  if (!icon) return null
  if (icon.startsWith('i-') || icon.startsWith('lucide:')) return null
  if (/^https?:\/\//.test(icon) || icon.startsWith('data:')) return icon
  return null
})
const iconName = computed(() => {
  const icon = space.value?.icon
  if (!icon) return 'i-lucide-box'
  if (icon.startsWith('i-') || icon.startsWith('lucide:')) return icon
  return 'i-lucide-box'
})
</script>

<template>
  <div class="h-full overflow-y-auto px-6 py-6">
    <!-- Loading state -->
    <div v-if="loading" class="flex items-center justify-center py-20 text-sm text-[var(--app-muted)]">
      Loading…
    </div>

    <!-- Error -->
    <div v-else-if="error" class="max-w-2xl mx-auto py-20 text-center space-y-4">
      <p class="text-sm text-[var(--app-foreground)]">{{ error }}</p>
      <Button variant="soft" size="sm" label="Back to Space Store" @click="router.push('/app/marketplace')" />
    </div>

    <!-- Loaded -->
    <div v-else-if="space" class="max-w-4xl mx-auto space-y-4">
      <!-- Hero -->
      <Card variant="muted">
        <div class="flex items-start gap-5">
          <div class="size-16 rounded-lg bg-[color-mix(in_srgb,var(--app-accent)_10%,transparent)] flex items-center justify-center shrink-0">
            <img v-if="iconUrl" :src="iconUrl" :alt="`${space.name} icon`" class="size-10 object-contain" />
            <Icon v-else :name="iconName" class="size-8 text-[var(--app-accent)]" />
          </div>

          <div class="min-w-0 flex-1 space-y-1.5">
            <h1 class="text-2xl font-normal text-[var(--app-foreground)] leading-tight">
              {{ space.name }}<span class="text-app-accent">.</span>
            </h1>
            <p class="text-xs text-[var(--app-muted)]">
              by <span class="text-[var(--app-foreground)]">{{ space.publisher_name || space.publisher_slug || 'Construct' }}</span>
              · v{{ space.version }}
              <span v-if="space.host_api_version"> · host {{ space.host_api_version }}</span>
            </p>
            <div class="flex flex-wrap gap-1.5 pt-1">
              <span v-if="space.scopes?.includes('app')" class="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded bg-[color-mix(in_srgb,var(--app-muted)_8%,transparent)] text-[var(--app-muted)]">Personal</span>
              <span v-if="space.scopes?.includes('org')" class="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded bg-[color-mix(in_srgb,var(--app-accent)_12%,transparent)] text-[var(--app-accent)]">Org</span>
              <span v-if="space.project_aware" class="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded bg-[color-mix(in_srgb,var(--app-muted)_8%,transparent)] text-[var(--app-muted)]">Project</span>
              <span v-if="space.category" class="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded bg-[color-mix(in_srgb,var(--app-muted)_8%,transparent)] text-[var(--app-muted)]">{{ space.category }}</span>
            </div>
          </div>

          <div class="shrink-0">
            <Button
              v-if="hasUpdate"
              color="warning"
              variant="soft"
              icon="lucide:refresh-cw"
              :loading="installing"
              label="Update"
              @click="handleUpdate"
            />
            <Button
              v-else-if="installed"
              variant="soft"
              icon="lucide:arrow-up-right"
              label="Open"
              @click="handleOpen"
            />
            <Button
              v-else
              icon="lucide:download"
              :loading="installing"
              label="Install"
              @click="handleInstall"
            />
          </div>
        </div>
      </Card>

      <!-- Description -->
      <Card variant="muted" title="About">
        <p class="text-sm text-[var(--app-muted)] leading-relaxed whitespace-pre-line">
          {{ space.description || 'No description provided.' }}
        </p>
        <div v-if="space.tags?.length" class="flex flex-wrap gap-1.5 mt-4">
          <span
            v-for="t in space.tags"
            :key="t"
            class="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded bg-[color-mix(in_srgb,var(--app-muted)_8%,transparent)] text-[var(--app-muted)]"
          >
            {{ t }}
          </span>
        </div>
      </Card>

      <!-- Stats + manifest summary -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4 items-stretch">
        <Card variant="muted" title="Usage" class="h-full">
          <ul class="space-y-2 pt-1">
            <li class="flex items-baseline gap-2 text-xs">
              <span class="font-normal text-[var(--app-foreground)] w-32 shrink-0 after:content-['.'] after:text-app-accent">Downloads</span>
              <span class="text-[var(--app-muted)]">{{ formatNumber(space.downloads) }} total</span>
            </li>
            <li class="flex items-baseline gap-2 text-xs">
              <span class="font-normal text-[var(--app-foreground)] w-32 shrink-0 after:content-['.'] after:text-app-accent">Last 7 days</span>
              <span class="text-[var(--app-muted)]">{{ formatNumber(space.installs_7d) }} installs</span>
            </li>
            <li class="flex items-baseline gap-2 text-xs">
              <span class="font-normal text-[var(--app-foreground)] w-32 shrink-0 after:content-['.'] after:text-app-accent">Last 30 days</span>
              <span class="text-[var(--app-muted)]">{{ formatNumber(space.installs_30d) }} installs</span>
            </li>
            <li class="flex items-baseline gap-2 text-xs">
              <span class="font-normal text-[var(--app-foreground)] w-32 shrink-0 after:content-['.'] after:text-app-accent">Updated</span>
              <span class="text-[var(--app-muted)]">{{ formatDate(space.updated_at || space.promoted_at) }}</span>
            </li>
          </ul>
        </Card>

        <Card variant="muted" title="What's included" class="h-full">
          <ul v-if="manifestStats" class="space-y-2 pt-1">
            <li class="flex items-baseline gap-2 text-xs">
              <span class="font-normal text-[var(--app-foreground)] w-32 shrink-0 after:content-['.'] after:text-app-accent">Pages</span>
              <span class="text-[var(--app-muted)]">{{ manifestStats.pages }}</span>
            </li>
            <li class="flex items-baseline gap-2 text-xs">
              <span class="font-normal text-[var(--app-foreground)] w-32 shrink-0 after:content-['.'] after:text-app-accent">Agent tools</span>
              <span class="text-[var(--app-muted)]">{{ manifestStats.tools }}</span>
            </li>
            <li class="flex items-baseline gap-2 text-xs">
              <span class="font-normal text-[var(--app-foreground)] w-32 shrink-0 after:content-['.'] after:text-app-accent">Widgets</span>
              <span class="text-[var(--app-muted)]">{{ manifestStats.widgets }}</span>
            </li>
          </ul>
          <p v-else class="text-xs text-[var(--app-muted)]">
            Manifest details not available until you install this space.
          </p>
        </Card>
      </div>
    </div>
  </div>
</template>
