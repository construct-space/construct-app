<script setup lang="ts">
import { Card, Button } from '@construct-space/ui'
import { Download, Star, Shield } from 'lucide-vue-next'
import type { RemoteSpace } from '@/composables/useSpaceMarketplace'

defineProps<{
  space: RemoteSpace
  scopes?: ('app' | 'org')[]
  projectAware?: boolean
  icon: string
  installed: boolean
  hasUpdate: boolean
  installing: boolean
}>()

const emit = defineEmits<{
  install: [id: string]
  update: [id: string]
  open: [id: string]
  'view-details': [id: string]
}>()

function formatDownloads(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}
</script>

<template>
  <Card
    hoverable
    interactive
    class="h-full"
    @click="emit('view-details', space.id)"
  >
    <template #header>
      <div class="flex items-start gap-3 min-w-0">
        <div class="size-10 rounded-lg bg-[color-mix(in_srgb,var(--app-accent)_10%,transparent)] flex items-center justify-center shrink-0">
          <Icon :name="icon" class="size-5 text-[var(--app-accent)]" />
        </div>
        <div class="min-w-0">
          <h3 class="text-sm font-semibold text-[var(--app-foreground)] truncate">{{ space.display_name }}</h3>
          <p class="text-[10px] text-[var(--app-muted)]">by {{ space.author }} &middot; v{{ space.version }}</p>
          <div class="flex gap-1 mt-1 flex-wrap">
            <span v-if="scopes?.includes('app')" class="text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-[color-mix(in_srgb,var(--app-muted)_8%,transparent)] text-[var(--app-muted)]">Personal</span>
            <span v-if="scopes?.includes('org')" class="text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-[color-mix(in_srgb,var(--app-accent)_12%,transparent)] text-[var(--app-accent)]">Org</span>
            <span v-if="projectAware" class="text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-[color-mix(in_srgb,var(--app-muted)_8%,transparent)] text-[var(--app-muted)]">Project</span>
          </div>
        </div>
      </div>
    </template>

    <p class="text-xs text-[var(--app-muted)] line-clamp-2 leading-relaxed">{{ space.description }}</p>

    <div
      v-if="space.permissions?.length"
      class="mt-3 flex items-center gap-1 text-[10px] text-[var(--app-muted)]"
    >
      <Shield class="size-3" />
      Requires {{ space.permissions.length }} permission{{ space.permissions.length > 1 ? 's' : '' }}
    </div>

    <template #footer>
      <div class="flex items-center gap-3 text-[10px] text-[var(--app-muted)]">
        <span class="flex items-center gap-0.5">
          <Star class="size-3" />
          {{ space.stars }}
        </span>
        <span class="flex items-center gap-0.5">
          <Download class="size-3" />
          {{ formatDownloads(space.downloads) }}
        </span>
      </div>
    </template>

    <template #footer-end>
      <Button
        v-if="hasUpdate"
        size="xs"
        color="warning"
        variant="soft"
        icon="lucide:refresh-cw"
        :loading="installing"
        label="Update"
        @click.stop="emit('update', space.id)"
      />
      <Button
        v-else-if="installed"
        size="xs"
        variant="soft"
        label="Open"
        @click.stop="emit('open', space.id)"
      />
      <Button
        v-else
        size="xs"
        icon="lucide:download"
        :loading="installing"
        label="Install"
        @click.stop="emit('install', space.id)"
      />
    </template>
  </Card>
</template>
