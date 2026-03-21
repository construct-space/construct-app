<script setup lang="ts">
/**
 * DynamicSpacePage — Generic renderer for marketplace-installed (non-built-in) spaces
 *
 * Reads space manifest from installed data and renders a header bar
 * with space icon/name and a chat-style content area driven by the
 * space's agent (similar to architect space).
 *
 * Future (Phase 6): will load pre-compiled Vue bundles from the space package.
 */

import { useSpaces } from '@/composables/useSpaces'
import { getSpace as getSpaceConfig } from '@/config/spaces'
import { ArrowLeft, MessageSquare } from 'lucide-vue-next'

const props = defineProps<{
  spaceName: string
}>()

const router = useRouter()
const { spaces, loadSpaces } = useSpaces()

const spaceConfig = computed(() => {
  return spaces.value.find(s => s.name === props.spaceName)
})

const uiConfig = computed(() => {
  return getSpaceConfig(props.spaceName)
})

onMounted(async () => {
  if (spaces.value.length === 0) {
    await loadSpaces()
  }
})
</script>

<template>
  <div class="h-screen flex flex-col">
<!-- Header bar -->
    <div class="shrink-0 h-12 flex items-center gap-3 px-4 border-b border-[var(--app-border)]">
      <button
        class="p-1.5 rounded-md hover:bg-[color-mix(in_srgb,var(--app-muted)_8%,transparent)] transition-colors"
        @click="router.push('/app/spaces')"
      >
        <ArrowLeft class="size-4 text-[var(--app-muted)]" />
      </button>

      <div class="flex items-center gap-2">
        <div
          class="size-6 rounded flex items-center justify-center"
          :class="uiConfig.bg"
        >
          <Icon :name="uiConfig.icon" class="size-3.5" :class="uiConfig.color" />
        </div>
        <span class="text-sm font-semibold text-[var(--app-foreground)]">
          {{ spaceConfig?.displayName || spaceName }}
        </span>
        <span
          v-if="spaceConfig?.version"
          class="text-[10px] text-[var(--app-muted)] bg-[color-mix(in_srgb,var(--app-muted)_8%,transparent)] px-1.5 py-0.5 rounded"
        >
          v{{ spaceConfig.version }}
        </span>
      </div>
    </div>

    <!-- Content area -->
    <div class="flex-1 flex items-center justify-center">
      <div v-if="spaceConfig" class="text-center max-w-sm">
        <div
          class="size-16 rounded-2xl flex items-center justify-center mx-auto mb-4"
          :class="uiConfig.bg"
        >
          <Icon :name="uiConfig.icon" class="size-8" :class="uiConfig.color" />
        </div>
        <h2 class="text-lg font-semibold text-[var(--app-foreground)] mb-2">
          {{ spaceConfig.displayName }}
        </h2>
        <p class="text-sm text-[var(--app-muted)] mb-6">
          {{ spaceConfig.description }}
        </p>

        <!-- Chat-style interaction placeholder -->
        <div class="flex items-center gap-2 text-sm text-[var(--app-muted)]">
          <MessageSquare class="size-4" />
          <span>Agent-powered interaction coming in Phase 6</span>
        </div>
      </div>

      <div v-else class="text-center">
        <p class="text-sm text-[var(--app-muted)]">Space "{{ spaceName }}" not found.</p>
        <button
          class="mt-4 px-4 py-2 rounded-lg border border-[var(--app-border)] text-sm text-[var(--app-foreground)] hover:bg-[color-mix(in_srgb,var(--app-muted)_5%,transparent)] transition-colors"
          @click="router.push('/app/spaces')"
        >
          Browse All Spaces
        </button>
      </div>
    </div>
</div>
</template>
