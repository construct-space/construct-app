<script setup lang="ts">
import type { LocalProject } from '@/types/project'
import { Folder, Pin, PinOff, Pencil, Rocket, X } from 'lucide-vue-next'

const props = defineProps<{
  project: LocalProject
  pinned: boolean
  deployed?: boolean
  deployedUrl?: string | null
}>()

const emit = defineEmits<{
  open: [project: LocalProject]
  remove: [project: LocalProject]
  edit: [project: LocalProject]
  deploy: [project: LocalProject]
  togglePin: [project: LocalProject]
}>()

function shortPath(fullPath: string): string {
  if (!fullPath) return ''
  const home = '/Users/' + fullPath.split('/')[2]
  if (fullPath.startsWith(home + '/')) {
    return '~/' + fullPath.slice(home.length + 1)
  }
  return fullPath
}

function timeAgo(dateStr: string): string {
  if (!dateStr) return 'Never'
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(dateStr).toLocaleDateString()
}

const PALETTE = ['#3b82f6', '#8b5cf6', '#ec4899', '#f97316', '#14b8a6', '#eab308', '#ef4444', '#06b6d4', '#84cc16', '#6366f1']

const iconColor = computed(() => {
  if (props.project.color) return props.project.color
  let hash = 0
  for (const ch of props.project.name) hash = ((hash << 5) - hash + ch.charCodeAt(0)) | 0
  return PALETTE[Math.abs(hash) % PALETTE.length]
})
</script>

<template>
  <div
    class="group project-card relative flex h-full min-w-0 flex-col rounded-xl border p-4 text-left transition-all duration-200 cursor-pointer"
    :class="deployed ? 'border-emerald-500/40 hover:border-emerald-400/60' : 'border-[var(--app-border)] hover:border-[var(--app-accent)]/40'"
    @click="emit('open', project)"
  >
    <!-- Header: icon + name -->
    <div class="mb-3 flex items-start gap-3">
      <div class="flex size-10 shrink-0 items-center justify-center rounded-lg" :style="{ background: iconColor + '18' }">
        <Folder class="size-5" :style="{ color: iconColor }" />
      </div>
      <div class="min-w-0 flex-1">
        <h3 class="truncate text-sm font-semibold leading-tight text-[var(--app-foreground)]">{{ project.name }}</h3>
        <p class="project-path mt-1 text-[10px] leading-4 font-mono text-[var(--app-muted)]/60">{{ shortPath(project.path) }}</p>
      </div>
    </div>

    <!-- Footer: time + actions -->
    <div class="mt-auto flex items-center justify-between gap-2 text-xs text-[var(--app-muted)]">
      <div class="flex items-center gap-2 min-w-0">
        <span class="truncate" v-if="project.last_opened_at">{{ timeAgo(project.last_opened_at) }}</span>
        <span
          v-if="deployed"
          class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 text-[10px] font-medium"
        >
          <span class="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
          Live
        </span>
      </div>

      <!-- Action icons — visible on hover -->
      <div class="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          class="card-action"
          :title="pinned ? 'Unpin' : 'Pin'"
          @click.stop="emit('togglePin', project)"
        >
          <PinOff v-if="pinned" class="size-3.5" />
          <Pin v-else class="size-3.5" />
        </button>
        <button
          class="card-action"
          title="Edit"
          @click.stop="emit('edit', project)"
        >
          <Pencil class="size-3.5" />
        </button>
        <button
          class="card-action text-emerald-500 hover:!bg-emerald-500/10"
          title="Deploy"
          @click.stop="emit('deploy', project)"
        >
          <Rocket class="size-3.5" />
        </button>
        <button
          class="card-action text-red-400 hover:!bg-red-500/10"
          title="Remove"
          @click.stop="emit('remove', project)"
        >
          <X class="size-3.5" />
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.project-card {
  background-color: var(--app-background);
}
.project-card:hover {
  box-shadow: 0 2px 12px color-mix(in srgb, var(--app-foreground) 6%, transparent);
}

.project-path {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow-wrap: anywhere;
}

.card-action {
  padding: 0.25rem;
  border-radius: 0.375rem;
  color: var(--app-muted);
  transition: background 0.15s, color 0.15s;
  cursor: pointer;
}
.card-action:hover {
  color: var(--app-foreground);
  background: color-mix(in srgb, var(--app-muted) 10%, transparent);
}
</style>
