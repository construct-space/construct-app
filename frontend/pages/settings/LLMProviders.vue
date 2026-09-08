<script setup lang="ts">
/**
 * Settings → LLM providers.
 */
import { computed, ref } from 'vue'
import { Alert, Button, Card, Input } from '@construct-space/ui'
import { Cpu, RefreshCw, Search } from 'lucide-vue-next'
import { useRouter } from 'vue-router'
import { useAIModel } from '@/composables/useAIModel'
import { useOrgStore } from '@/stores/org'
import LLMProvidersPanel from '@/components/settings/LLMProvidersPanel.vue'
import OrgManagedBadge from '@/components/common/OrgManagedBadge.vue'

const router = useRouter()
const orgStore = useOrgStore()

const { defaultModelId, allModels, resolveModelId } = useAIModel()

const providersPanelRef = ref<{ refresh: () => Promise<void>; refreshing: boolean } | null>(null)
const refreshingProviders = computed(() => !!providersPanelRef.value?.refreshing)

type FilterValue = 'all' | 'configured' | 'not_configured'
const filter = ref<FilterValue>('all')
const search = ref('')

const currentDefault = computed(() => {
  const explicit = defaultModelId.value
  // When nothing is explicitly picked, fall back to the effective
  // auto-routed model (e.g. Construct's source-medium) — the agent already
  // uses it, so "Selected Model" should reflect that rather than claim
  // "Not set". Only when nothing resolves at all (no connected provider)
  // do we show the empty state.
  const id = explicit || resolveModelId('', { allowAuto: false })
  if (!id) return null
  const [providerId = '', modelId = ''] = id.split(':')
  const hit = allModels.value.find((m) => m.id === id)
  return {
    label: hit?.label || modelId || id,
    providerLabel: hit?.providerLabel || providerId || '',
    providerId: hit?.providerId || providerId,
    isAuto: !explicit,
  }
})

function goChangeDefault() {
  document.getElementById('providers-list')?.scrollIntoView({ behavior: 'smooth' })
}

function refreshProviders() {
  void providersPanelRef.value?.refresh()
}

const isOrgManaged = computed(() => orgStore.isEnabled)
const hasSharedKeys = computed(
  () => isOrgManaged.value && (orgStore.managedProviders?.length ?? 0) > 0,
)

const filters: { value: FilterValue; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'configured', label: 'Configured' },
  { value: 'not_configured', label: 'Not set up' },
]
</script>

<template>
  <div class="space-y-4">
    <!-- Intro -->
    <Card variant="muted">
      <template #header>
        <div class="flex items-start gap-3">
          <Cpu class="size-5 text-[var(--app-muted)] mt-0.5 shrink-0" />
          <div class="min-w-0 flex-1">
            <h3 class="text-sm tracking-[0.08em] uppercase font-normal text-[var(--app-foreground)] leading-tight after:content-['.'] after:text-[var(--app-accent)]">LLM Providers</h3>
            <p class="text-sm text-[var(--app-muted)] mt-0.5">
              Connect the AI models Construct calls on your behalf. Providers that offer both a monthly subscription and a pay-per-token API — Anthropic, OpenAI, MiMo — let you pick which one to use per provider.
            </p>
          </div>
        </div>
      </template>
      <template #accessory>
        <Button
          size="sm"
          variant="soft"
          color="neutral"
          label="Refresh"
          :disabled="refreshingProviders"
          @click="refreshProviders"
        >
          <template #leading>
            <RefreshCw class="size-3.5" :class="refreshingProviders ? 'animate-spin' : ''" />
          </template>
        </Button>
      </template>
    </Card>

    <!-- Default model -->
    <Card title="Selected Model">
      <template #accessory>
        <Button size="sm" variant="soft" color="neutral" label="Change" @click="goChangeDefault" />
      </template>
      <div v-if="currentDefault" class="flex items-center gap-2 text-sm flex-wrap">
        <span class="font-normal text-[var(--app-foreground)]">{{ currentDefault.label }}</span>
        <span
          v-if="currentDefault.providerLabel"
          class="text-[10px] tracking-[0.08em] uppercase px-1.5 py-0.5 rounded-sm bg-[color-mix(in_srgb,var(--app-muted)_10%,transparent)] text-[var(--app-muted)]"
        >
          {{ currentDefault.providerLabel }}
        </span>
        <span
          v-if="currentDefault.isAuto"
          class="text-[10px] tracking-[0.08em] uppercase px-1.5 py-0.5 rounded-sm bg-[color-mix(in_srgb,var(--app-accent)_12%,transparent)] text-[var(--app-accent)]"
          title="Auto-selected because you haven't picked a model. Click Change to choose one."
        >
          Auto
        </span>
      </div>
      <div v-else class="text-sm text-[var(--app-muted)]">
        Not set — configure a provider below to pick one.
      </div>
    </Card>

    <!-- Search + filter -->
    <div class="flex items-center gap-3 flex-wrap">
      <div class="flex-1 min-w-[200px] relative">
        <Search class="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-[var(--app-muted)] pointer-events-none z-10" />
        <Input v-model="search" placeholder="Search providers or models…" size="sm" class="!pl-9" />
      </div>
      <div class="inline-flex rounded-sm border border-[var(--app-border)] overflow-hidden">
        <button
          v-for="opt in filters"
          :key="opt.value"
          class="h-7 px-3 text-[10px] tracking-[0.08em] uppercase font-normal transition-colors cursor-pointer"
          :class="filter === opt.value
            ? 'bg-[var(--app-accent)] text-[var(--app-accent-foreground)]'
            : 'text-[var(--app-muted)] hover:text-[var(--app-foreground)]'"
          @click="filter = opt.value"
        >
          {{ opt.label }}
        </button>
      </div>
    </div>

    <!-- Provider cards -->
    <div id="providers-list">
      <LLMProvidersPanel ref="providersPanelRef" :filter="filter" :search="search" />
    </div>

    <!-- Org-shared-key callout -->
    <Alert v-if="hasSharedKeys" color="info">
      <template #title>
        <div class="flex items-center gap-2">
          Your org has shared provider keys
          <OrgManagedBadge :org-name="orgStore.orgName" />
        </div>
      </template>
      <p class="text-xs text-[var(--app-muted)]">
        <strong class="text-[var(--app-foreground)]">{{ orgStore.orgName }}</strong> provides shared API keys that bill back to the org account. Your personal keys above override them — unless an admin has marked the shared key as
        <em class="text-[var(--app-accent)] not-italic">enforced</em>, in which case your personal key is silently replaced at runtime.
        <a
          class="text-[var(--app-accent)] hover:underline ml-1"
          href="#"
          @click.prevent="router.push('/app/settings/organization')"
        >View shared keys →</a>
      </p>
    </Alert>
  </div>
</template>
