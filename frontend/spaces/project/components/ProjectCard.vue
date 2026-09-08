<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { LocalProject } from '@/types/project'
import { shortenHomePath } from '@/utils/paths'
import { Folder, Pin, PinOff, Pencil, Rocket, X, Boxes, Wrench } from 'lucide-vue-next'
import { Badge, Card } from '@construct-space/ui'

const props = defineProps<{
  project: LocalProject
  pinned: boolean
  deployed?: boolean
  deployedUrl?: string | null
}>()

// Project kind — prefer the explicit `kind` from the manifest (set by
// New Project flow / scanned from .construct/project.json). Fall back
// to an FS probe (any `space-*/` dir ⇒ space) so legacy entries still
// render a sensible badge.
type ProjectKind = 'space' | 'builder' | 'unknown'
const kind = ref<ProjectKind>('unknown')

async function detectKindFromFs(): Promise<ProjectKind> {
  const path = props.project.path
  if (!path) return 'builder'
  try {
    const { readDir } = await import('@tauri-apps/plugin-fs')
    const entries = await readDir(path)
    const hasSpaceDir = entries.some(e => e.isDirectory && e.name.startsWith('space-'))
    return hasSpaceDir ? 'space' : 'builder'
  } catch {
    return 'builder'
  }
}

onMounted(async () => {
  if (props.project.kind === 'space-project') {
    kind.value = 'space'
    return
  }
  if (props.project.kind === 'project') {
    kind.value = 'builder'
    return
  }
  kind.value = await detectKindFromFs()
})

const emit = defineEmits<{
  open: [project: LocalProject]
  remove: [project: LocalProject]
  edit: [project: LocalProject]
  deploy: [project: LocalProject]
  togglePin: [project: LocalProject]
}>()

function shortPath(fullPath: string): string {
  return shortenHomePath(fullPath)
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
  <Card
    interactive
    class="group h-full"
    :class="deployed ? 'ring-1 ring-emerald-500/40' : ''"
    @click="emit('open', project)"
  >
    <template #header>
      <div class="flex items-start gap-3">
        <div
          class="flex size-10 shrink-0 items-center justify-center rounded-sm"
          :style="{ background: iconColor + '18' }"
        >
          <Folder class="size-5" :style="{ color: iconColor }" />
        </div>
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2 flex-wrap">
            <h4 class="text-sm tracking-[0.08em] uppercase font-normal text-[var(--app-foreground)] leading-tight after:content-['.'] after:text-[var(--app-accent)] truncate">{{ project.name }}</h4>
            <Badge v-if="kind === 'space'" color="info" size="xs">
              <Boxes class="size-2.5 mr-0.5" />Space
            </Badge>
            <Badge v-else-if="kind === 'builder'" color="primary" size="xs">
              <Wrench class="size-2.5 mr-0.5" />Builder
            </Badge>
          </div>
          <p class="mt-1 text-[10px] font-mono text-[var(--app-muted)] truncate">{{ shortPath(project.path) }}</p>
        </div>
      </div>
    </template>

    <template #footer>
      <div class="flex items-center gap-2 min-w-0 text-xs text-[var(--app-muted)]">
        <span v-if="project.last_opened_at" class="truncate">{{ timeAgo(project.last_opened_at) }}</span>
        <span
          v-if="deployed"
          class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm bg-emerald-500/10 text-emerald-400 text-[10px] tracking-[0.08em] uppercase"
        >
          <span class="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
          Live
        </span>
      </div>
    </template>

    <template #footer-end>
      <div class="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity" @click.stop>
        <button
          class="card-action"
          :title="pinned ? 'Unpin' : 'Pin'"
          @click="emit('togglePin', project)"
        >
          <PinOff v-if="pinned" class="size-3.5" />
          <Pin v-else class="size-3.5" />
        </button>
        <button class="card-action" title="Edit" @click="emit('edit', project)">
          <Pencil class="size-3.5" />
        </button>
        <button class="card-action text-emerald-500 hover:!bg-emerald-500/10" title="Deploy" @click="emit('deploy', project)">
          <Rocket class="size-3.5" />
        </button>
        <button class="card-action text-red-400 hover:!bg-red-500/10" title="Remove" @click="emit('remove', project)">
          <X class="size-3.5" />
        </button>
      </div>
    </template>
  </Card>
</template>

<style scoped>
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
