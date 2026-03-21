<script setup lang="ts">
import { allSettingsNavItems, settingsNavGroups } from '@/router/settingsNavigation'

const route = useRoute()
const settingsStore = useSettingsStore()

const navGroups = settingsNavGroups

const currentSection = computed(() =>
  allSettingsNavItems.find(item => route.path === item.path)?.label ?? ''
)

onMounted(() => {
  if (settingsStore.settings.length === 0) {
    settingsStore.fetchSettings().catch(() => undefined)
  }
})
</script>

<template>
  <div class="h-full flex">
    <!-- LEFT COLUMN (1/3) — branding + nav -->
    <div class="w-1/3 shrink-0 flex flex-col items-start px-6 py-10 overflow-y-auto">
      <!-- Branding — same pattern as ProjectSettingsPage -->
      <p class="text-lg tracking-wide select-none mb-1">
        <span class="text-app-muted font-normal">CONSTRUCT:</span><span
          class="font-bold text-app-foreground">SETTINGS</span>
      </p>
      <p class="text-xs text-app-muted uppercase tracking-widest mb-10">
        {{ currentSection }}
      </p>

      <!-- Nav -->
      <nav class="w-full space-y-6">
        <div v-for="group in navGroups" :key="group.label">
          <p class="text-[10px] font-semibold tracking-widest text-app-muted uppercase mb-1.5 px-1">
            {{ group.label }}
          </p>
          <div class="space-y-0.5">
            <RouterLink v-for="item in group.items" :key="item.path" :to="item.path"
              class="flex items-center gap-2.5 px-2 py-1.5 rounded text-sm transition-colors" :class="route.path === item.path
                ? 'text-app-accent bg-[color-mix(in_srgb,var(--app-accent)_10%,transparent)]'
                : 'text-app-foreground hover:bg-[color-mix(in_srgb,var(--app-muted)_8%,transparent)]'">
              <component :is="item.icon" class="w-4 h-4 shrink-0"
                :class="route.path === item.path ? 'text-app-accent' : 'text-app-muted'" />
              <span>{{ item.label }}</span>
            </RouterLink>
          </div>
        </div>
      </nav>
    </div>

    <!-- RIGHT COLUMN (2/3) — page content -->
    <div class="w-2/3 flex-1 overflow-y-auto py-10 px-10">
      <RouterView />
    </div>
  </div>
</template>
