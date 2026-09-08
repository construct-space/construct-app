<script setup lang="ts">
/**
 * ModelSwitcherModal — quick picker for the default AI model.
 *
 * Opened via double-right-shift from DefaultLayout. Lists every model from
 * every active provider (grouped), with a search box and arrow-key nav.
 * Clicking or pressing Enter on a row calls setDefaultModel and closes.
 */
import { computed, nextTick, ref, watch } from 'vue'
import { Modal, Input, Badge } from '@construct-space/ui'
import { Check, Cpu } from 'lucide-vue-next'
import { useAIModel, type AIModelOption } from '@/composables/useAIModel'
import { providerLogoSvg } from '@/lib/providerLogo'

const hasLogo = (providerId: string): boolean => providerLogoSvg(providerId) !== null

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{
  'update:open': [value: boolean]
  close: []
}>()

const { allModels, defaultModelId, setDefaultModel, loading, loadProviders } = useAIModel()

const query = ref('')
const highlight = ref(0)
const searchRef = ref<{ inputRef?: HTMLInputElement } | HTMLElement | null>(null)
const refreshing = ref(false)

interface Group {
  providerId: string
  providerLabel: string
  models: AIModelOption[]
}

// Only active providers (authenticated / keys configured). Inactive models
// would fail on dispatch, so surfacing them here would be a footgun.
const activeModels = computed(() => allModels.value.filter(m => m.active))

const filteredModels = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return activeModels.value
  return activeModels.value.filter(m =>
    m.label.toLowerCase().includes(q)
    || m.id.toLowerCase().includes(q)
    || m.providerLabel.toLowerCase().includes(q),
  )
})

const groups = computed<Group[]>(() => {
  const map = new Map<string, Group>()
  for (const m of filteredModels.value) {
    const g = map.get(m.providerId)
    if (g) { g.models.push(m); continue }
    map.set(m.providerId, {
      providerId: m.providerId,
      providerLabel: m.providerLabel,
      models: [m],
    })
  }
  return [...map.values()]
})

// Flat list mirrors the visible order so Arrow keys can step across groups.
const flatList = computed(() => groups.value.flatMap(g => g.models))

function close() {
  emit('update:open', false)
  emit('close')
}

function pick(m: AIModelOption) {
  setDefaultModel(m.id)
  close()
}

async function refreshProviders() {
  if (refreshing.value) return
  refreshing.value = true
  try {
    await loadProviders(5, undefined, { connect: true })
  } finally {
    refreshing.value = false
  }
}

function onKeydown(e: KeyboardEvent) {
  const list = flatList.value
  if (list.length === 0) return
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    highlight.value = (highlight.value + 1) % list.length
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    highlight.value = (highlight.value - 1 + list.length) % list.length
  } else if (e.key === 'Enter') {
    e.preventDefault()
    const pick_ = list[highlight.value]
    if (pick_) pick(pick_)
  }
}

// Clamp highlight into range whenever the filtered list shrinks (typing narrows results).
watch(flatList, (list) => {
  if (highlight.value >= list.length) highlight.value = Math.max(0, list.length - 1)
})

watch(
  () => props.open,
  async (isOpen) => {
    if (!isOpen) return
    query.value = ''
    void refreshProviders()
    // Default highlight to the currently-selected model so Enter is a no-op
    // for "I opened it by accident."
    const currentIdx = flatList.value.findIndex(m => m.id === defaultModelId.value)
    highlight.value = currentIdx >= 0 ? currentIdx : 0
    await nextTick()
    const el = searchRef.value as unknown as { inputRef?: HTMLInputElement } | null
    el?.inputRef?.focus?.()
  },
)
</script>

<template>
  <Modal
    :open="open"
    title="Switch model"
    :ui="{ content: 'w-full max-w-xl max-h-[75vh]' }"
    @close="close"
  >
    <div class="flex flex-col gap-3 min-h-0" @keydown="onKeydown">
      <Input
        ref="searchRef"
        v-model="query"
        placeholder="Search models or providers…"
        size="sm"
      />

      <div
        v-if="loading || refreshing"
        class="text-xs text-center py-6"
        style="color: var(--app-muted)"
      >
        Loading providers…
      </div>
      <div
        v-else-if="flatList.length === 0"
        class="text-xs text-center py-6"
        style="color: var(--app-muted)"
      >
        <template v-if="activeModels.length === 0">
          No active providers. Add keys in Settings → AI Providers.
        </template>
        <template v-else>
          No matches for "{{ query }}".
        </template>
      </div>

      <div
        v-else
        class="flex-1 overflow-y-auto -mx-1 px-1 space-y-4"
      >
        <div v-for="g in groups" :key="g.providerId">
          <div
            class="flex items-center gap-2 px-2 mb-1.5"
            style="color: var(--app-muted)"
          >
            <span class="flex items-center justify-center h-3.5 w-3.5 shrink-0">
              <ProviderLogo
                v-if="hasLogo(g.providerId)"
                :id="g.providerId"
                class="h-3.5"
                style="color: var(--app-foreground)"
              />
              <Cpu v-else :size="13" />
            </span>
            <span class="text-[11px] tracking-[0.08em] uppercase font-semibold">{{ g.providerLabel }}</span>
            <span
              class="text-[10px] px-1.5 py-px rounded-full font-medium tabular-nums"
              style="background: color-mix(in srgb, var(--app-muted) 12%, transparent)"
            >{{ g.models.length }}</span>
          </div>
          <ul class="space-y-1">
            <li
              v-for="m in g.models"
              :key="m.id"
              class="group/row relative flex items-center gap-3 pl-3 pr-2.5 py-2 rounded-lg cursor-pointer border transition-colors"
              :class="[
                m.id === defaultModelId
                  ? 'border-[color-mix(in_srgb,var(--app-accent)_45%,transparent)] bg-[color-mix(in_srgb,var(--app-accent)_8%,transparent)]'
                  : 'border-transparent',
                flatList[highlight]?.id === m.id && m.id !== defaultModelId
                  ? 'bg-[color-mix(in_srgb,var(--app-muted)_9%,transparent)]'
                  : '',
                flatList[highlight]?.id === m.id
                  ? 'ring-1 ring-[color-mix(in_srgb,var(--app-accent)_35%,transparent)]'
                  : '',
              ]"
              @mouseenter="highlight = flatList.findIndex(x => x.id === m.id)"
              @click="pick(m)"
            >
              <!-- Selected: filled accent dot with check; else hollow ring -->
              <span
                class="shrink-0 flex items-center justify-center h-5 w-5 rounded-full transition-colors"
                :style="m.id === defaultModelId
                  ? 'background: var(--app-accent); color: #fff'
                  : 'border: 1.5px solid color-mix(in srgb, var(--app-muted) 35%, transparent)'"
              >
                <Check v-if="m.id === defaultModelId" :size="13" :stroke-width="3" />
              </span>

              <div class="min-w-0 flex-1">
                <div
                  class="text-[13px] font-medium leading-tight truncate"
                  style="color: var(--app-foreground)"
                >
{{ m.label }}
</div>
                <div
                  class="text-[10px] font-mono leading-tight truncate"
                  style="color: var(--app-muted)"
                >
{{ m.id.split(':').slice(1).join(':') }}
</div>
              </div>

              <Badge
                v-if="m.capabilities?.includes('vision')"
                color="primary"
                size="xs"
                label="vision"
              />
              <span
                v-if="m.id === defaultModelId"
                class="text-[9px] tracking-[0.1em] uppercase font-semibold shrink-0"
                style="color: var(--app-accent)"
              >Active</span>
            </li>
          </ul>
        </div>
      </div>

      <div
        class="flex items-center justify-between text-[10px] pt-2 border-t"
        style="border-color: var(--app-border); color: var(--app-muted)"
      >
        <span>↑↓ navigate · ↵ select · esc close</span>
        <span>Double right-shift to toggle</span>
      </div>
    </div>
  </Modal>
</template>
