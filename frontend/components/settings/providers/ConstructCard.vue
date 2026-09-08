<script setup lang="ts">
/**
 * ConstructCard — platform-managed provider, session-authed.
 *
 * No API key field, no Base URL field, no setup steps. Just lists the
 * curated models served by my.construct.space/api/construct and lets
 * the user select one. Header status reads "Free models" so it never
 * looks like something the user needs to configure.
 *
 * Routing for selected models goes through the operator's `construct`
 * provider entry (registered in bootstrap_providers.go), which forwards
 * to /api/construct/chat/completions with the user's cat_* session
 * token.
 */

import { computed } from 'vue'
import { Badge, Card } from '@construct-space/ui'
import { ChevronDown } from 'lucide-vue-next'
import type { AIProvider } from '@/brain/types'
import { providerLogoSvg } from '@/lib/providerLogo'
import ProviderLogo from '@/components/common/ProviderLogo.vue'
import { useProviderCard } from '@/composables/useProviderCard'
import { useAIModel } from '@/composables/useAIModel'

const props = defineProps<{ provider: AIProvider }>()
const providerId = computed(() => props.provider.id)

const card = useProviderCard()
const { defaultModelId, setDefaultModel } = useAIModel()

const collapsed = computed(() => card.isCollapsed(providerId.value))
function toggleCollapsed() {
  card.toggleCollapsed(providerId.value)
}

function selectModel(modelId: string) {
  setDefaultModel(`${providerId.value}:${modelId}`)
}
function isSelected(modelId: string) {
  return defaultModelId.value === `${providerId.value}:${modelId}`
}
</script>

<template>
  <Card class="mb-4">
    <template #header>
      <div class="flex w-full items-start justify-between gap-3">
        <div class="flex min-w-0 items-start gap-3">
          <ProviderLogo
            v-if="providerLogoSvg(provider.id)"
            :id="provider.id"
            class="h-10 shrink-0 text-[var(--app-accent)]"
          />
          <div class="min-w-0 flex-1">
            <h3 class="text-sm tracking-[0.08em] uppercase font-normal text-[var(--app-foreground)] leading-tight after:content-['.'] after:text-[var(--app-accent)]">
              {{ provider.label }}
            </h3>
            <p class="text-sm text-[var(--app-muted)] mt-0.5">
              {{ provider.description || 'Free curated models — no setup needed' }}
            </p>
          </div>
        </div>
        <div class="flex shrink-0 items-center gap-2" @click.stop>
          <Badge color="success" size="xs">Ready</Badge>
          <button
            type="button"
            class="size-8 grid place-items-center rounded-sm border border-[var(--app-border)] bg-[color-mix(in_srgb,var(--app-background)_75%,var(--app-canvas-bg))] text-[var(--app-muted)] hover:text-[var(--app-foreground)] hover:border-[var(--app-accent)] transition-colors"
            :aria-label="collapsed ? `Expand ${provider.label}` : `Collapse ${provider.label}`"
            :title="collapsed ? `Expand ${provider.label}` : `Collapse ${provider.label}`"
            @click="toggleCollapsed"
          >
            <ChevronDown :class="['size-4 transition-transform', collapsed ? '' : 'rotate-180']" />
          </button>
        </div>
      </div>
    </template>

    <template v-if="!collapsed" #footer>
      <div v-if="!provider.models?.length" class="text-xs text-[var(--app-muted)]">
        No models published yet.
      </div>
      <details v-else open>
        <summary class="cursor-pointer text-[11px] tracking-[0.08em] uppercase text-[var(--app-muted)] hover:text-[var(--app-foreground)] flex items-center justify-between py-1">
          <span><strong class="text-[var(--app-foreground)]">{{ provider.models.length }} models</strong> available</span>
          <span>▾</span>
        </summary>
        <ul class="mt-2 space-y-0.5">
          <li
            v-for="m in provider.models"
            :key="m.id"
            class="text-xs flex items-center gap-2 px-2 py-1.5 rounded-sm cursor-pointer transition-colors"
            :class="isSelected(m.id) ? 'bg-[color-mix(in_srgb,var(--app-accent)_10%,transparent)]' : 'hover:bg-[color-mix(in_srgb,var(--app-muted)_8%,transparent)]'"
            @click="selectModel(m.id)"
          >
            <span class="text-[var(--app-foreground)]">{{ m.label }}</span>
            <span v-if="m.capabilities?.length" class="flex gap-1">
              <span
                v-for="cap in m.capabilities"
                :key="cap"
                class="text-[10px] tracking-[0.04em] uppercase text-[var(--app-muted)] border border-[var(--app-border)] rounded px-1 py-0.5"
              >
                {{ cap }}
              </span>
            </span>
            <span v-if="isSelected(m.id)" class="ml-auto text-[10px] text-[var(--app-accent)]">✓ selected</span>
          </li>
        </ul>
      </details>
    </template>
  </Card>
</template>
