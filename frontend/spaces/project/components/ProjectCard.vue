<script setup lang="ts">
import type { LocalProject } from '@/types/project'

defineProps<{
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

const openMenu = ref(false)

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
</script>

<template>
  <div
    class="group card relative text-left p-4 rounded-xl border transition-all duration-200 cursor-pointer bg-[var(--app-surface)] hover:bg-[var(--app-muted)]/5"
    :class="deployed ? 'border-emerald-500/40 hover:border-emerald-400/60' : 'border-[var(--app-border)] hover:border-[var(--app-accent)]/40'"
    @click="emit('open', project)"
    @mouseleave="openMenu = false"
  >
    <!-- Hover actions -->
    <div
      class="absolute top-3 right-3 z-10 hidden items-center gap-0.5 group-hover:flex"
      :class="{ '!flex': openMenu }"
    >
      <button
        class="p-1.5 rounded-md text-[var(--app-muted)] hover:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
        title="Remove project"
        @click.stop="emit('remove', project)"
      >
        <Icon name="i-lucide-x" class="size-4" />
      </button>
      <button
        class="p-1.5 rounded-md text-[var(--app-muted)] hover:text-[var(--app-foreground)] hover:bg-[var(--app-muted)]/10 transition-colors cursor-pointer"
        :class="{ 'bg-[var(--app-muted)]/10': openMenu }"
        @click.stop="openMenu = !openMenu"
      >
        <Icon name="i-lucide-ellipsis-vertical" class="size-4" />
      </button>

      <!-- Context menu -->
      <div
        v-if="openMenu"
        class="absolute top-8 right-0 w-48 py-1 rounded-lg border border-[var(--app-border)] bg-[var(--app-background)] shadow-xl z-20"
        @click.stop
      >
        <button
          class="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-[var(--app-foreground)] hover:bg-[color-mix(in_srgb,var(--app-muted)_8%,transparent)] transition-colors"
          @click.stop="emit('togglePin', project); openMenu = false"
        >
          <Icon :name="pinned ? 'i-lucide-pin-off' : 'i-lucide-pin'" class="size-3.5" />
          {{ pinned ? 'Unpin from sidebar' : 'Pin to sidebar' }}
        </button>
        <button
          class="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-[var(--app-foreground)] hover:bg-[color-mix(in_srgb,var(--app-muted)_8%,transparent)] transition-colors"
          @click.stop="emit('edit', project); openMenu = false"
        >
          <Icon name="i-lucide-pencil" class="size-3.5" />
          Edit project
        </button>
        <button
          class="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-emerald-400 hover:bg-emerald-500/10 transition-colors"
          @click.stop="emit('deploy', project); openMenu = false"
        >
          <Icon name="i-lucide-rocket" class="size-3.5" />
          {{ deployed ? 'Re-Deploy' : 'Deploy' }}
        </button>
        <div class="my-1 h-px bg-[var(--app-border)]" />
        <button
          class="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10 transition-colors"
          @click.stop="emit('remove', project); openMenu = false"
        >
          <Icon name="i-lucide-folder-minus" class="size-3.5" />
          Remove from Construct
        </button>
      </div>
    </div>

    <div class="flex items-start gap-3 mb-3">
      <div class="size-10 rounded-lg bg-[var(--app-accent)]/10 flex items-center justify-center shrink-0">
        <Icon name="i-lucide-folder" class="size-5 text-[var(--app-accent)]" />
      </div>
      <div class="min-w-0 flex-1 pr-6">
        <h3 class="text-sm font-semibold text-[var(--app-foreground)] truncate">{{ project.name }}</h3>
        <p v-if="project.description" class="text-xs text-[var(--app-muted)] truncate mt-0.5">
          {{ project.description }}
        </p>
      </div>
    </div>
    <div class="flex items-center justify-between text-xs text-[var(--app-muted)]">
      <span>{{ timeAgo(project.last_opened_at) }}</span>
      <div class="flex items-center gap-2">
        <span
          v-if="deployed"
          class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 text-[10px] font-medium"
        >
          <span class="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
          Live
        </span>
        <div class="flex items-center gap-1">
          <Icon v-if="project.is_external" name="i-lucide-external-link" class="size-3 opacity-60" />
          <span>{{ (project.spaces || []).length }} spaces</span>
        </div>
      </div>
    </div>
  </div>
</template>
