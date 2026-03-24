<script setup lang="ts">
import { Sun, Moon, Monitor } from 'lucide-vue-next'
import { useAppTheme } from '@/composables/useAppTheme'

const { themes, currentThemeId, setTheme } = useAppTheme()

const isAuto = computed(() => currentThemeId.value === 'auto')

async function selectTheme(themeId: string) {
  await setTheme(themeId)
}

async function toggleAuto() {
  if (isAuto.value) {
    // Turn off auto → set to current OS-resolved theme
    const isDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches
    await setTheme(isDark ? 'vs-dark' : 'vs')
  } else {
    await setTheme('auto')
  }
}
</script>

<template>
  <div class="space-y-6">
    <!-- Auto mode toggle -->
    <button
      class="w-full p-4 rounded-lg border-2 text-left transition-all flex items-center gap-3"
      :class="isAuto
        ? 'border-[var(--app-accent)] bg-[color-mix(in_srgb,var(--app-accent)_5%,transparent)]'
        : 'border-[var(--app-border)] hover:border-[var(--app-muted)]'"
      @click="toggleAuto"
    >
      <Monitor class="size-5 text-[var(--app-muted)]" />
      <div class="flex-1">
        <p class="text-sm font-medium text-[var(--app-foreground)]">Auto (System)</p>
        <p class="text-xs text-[var(--app-muted)]">Follow your OS light/dark setting</p>
      </div>
      <div v-if="isAuto" class="size-5 rounded-full bg-[var(--app-accent)] flex items-center justify-center">
        <svg class="w-3 h-3" viewBox="0 0 10 10" fill="none">
          <path d="M2 5l2.5 2.5L8 3" stroke="var(--app-accent-foreground)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </div>
    </button>

    <!-- Theme grid -->
    <div class="grid grid-cols-3 gap-3">
      <button
        v-for="theme in themes"
        :key="theme.id"
        class="relative rounded-lg border-2 overflow-hidden transition-all text-left focus:outline-none"
        :class="!isAuto && currentThemeId === theme.id
          ? 'border-[var(--app-accent)] ring-2 ring-[var(--app-accent)] ring-offset-2 ring-offset-[var(--app-background)]'
          : 'border-[var(--app-border)] hover:border-[var(--app-muted)]'"
        @click="selectTheme(theme.id)"
      >
        <!-- Color preview -->
        <div
          class="h-16 w-full relative"
          :style="{ backgroundColor: theme.colors.background }"
        >
          <div
            class="absolute bottom-0 left-0 right-0 h-1"
            :style="{ backgroundColor: theme.colors.accent }"
          />
          <div class="p-2 flex flex-col gap-1">
            <div
              class="h-1.5 rounded-full w-3/4"
              :style="{ backgroundColor: theme.colors.foreground, opacity: 0.7 }"
            />
            <div
              class="h-1.5 rounded-full w-1/2"
              :style="{ backgroundColor: theme.colors.muted, opacity: 0.5 }"
            />
            <div
              class="mt-1 h-3 rounded w-10"
              :style="{ backgroundColor: theme.colors.accent }"
            />
          </div>
        </div>

        <div
          class="px-2 py-1.5 flex items-center justify-between"
          :style="{ backgroundColor: theme.colors.background }"
        >
          <span
            class="text-xs font-medium truncate"
            :style="{ color: theme.colors.foreground }"
          >{{ theme.name }}</span>
          <component
            :is="theme.mode === 'light' ? Sun : Moon"
            class="w-3 h-3 shrink-0 ml-1"
            :style="{ color: theme.colors.muted }"
          />
        </div>

        <!-- Selected indicator -->
        <div
          v-if="!isAuto && currentThemeId === theme.id"
          class="absolute top-1.5 right-1.5 w-4 h-4 rounded-full flex items-center justify-center"
          :style="{ backgroundColor: theme.colors.accent }"
        >
          <svg class="w-2.5 h-2.5" viewBox="0 0 10 10" fill="none">
            <path d="M2 5l2.5 2.5L8 3" :stroke="theme.colors.accentForeground" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </div>
      </button>
    </div>
  </div>
</template>
