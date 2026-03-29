<script setup lang="ts">
import { computed } from 'vue'
import { Plus, Pencil, Eye } from 'lucide-vue-next'
import type { ToolActivity } from '@/operator/useStreamStatus'

const props = defineProps<{
  toolHistory: readonly ToolActivity[]
  isRunning: boolean
}>()

interface FileEntry {
  path: string
  short: string
  action: 'created' | 'modified' | 'read' | 'checked'
  state: 'done' | 'error' | 'running'
}

const files = computed<FileEntry[]>(() => {
  const seen = new Map<string, FileEntry>()

  for (const tc of props.toolHistory) {
    let path = ''
    let action: FileEntry['action'] = 'read'

    if (!tc.input) continue
    try {
      const parsed = typeof tc.input === 'string' ? JSON.parse(tc.input) : tc.input
      path = parsed?.path || ''
    } catch { continue }

    if (!path || path.includes('node_modules')) continue

    switch (tc.tool) {
      case 'write_file':
        action = 'created'
        break
      case 'edit_file':
        action = 'modified'
        break
      case 'read_file':
      case 'list_dir':
        action = 'read'
        break
      case 'space_check':
      case 'space_validate':
      case 'space_build':
      case 'space_install':
        action = 'checked'
        path = path || tc.tool
        break
      default:
        continue
    }

    // Upgrade action: read → modified → created
    const existing = seen.get(path)
    const priority = { read: 0, checked: 1, modified: 2, created: 3 }
    if (!existing || priority[action] > priority[existing.action]) {
      const parts = path.split('/')
      const short = parts.length > 2
        ? parts.slice(-2).join('/')
        : parts[parts.length - 1]
      seen.set(path, { path, short, action, state: tc.state })
    }
  }

  // Sort: created first, then modified, then checked, then read
  const order = { created: 0, modified: 1, checked: 2, read: 3 }
  return [...seen.values()].sort((a, b) => order[a.action] - order[b.action])
})

const created = computed(() => files.value.filter(f => f.action === 'created'))
const modified = computed(() => files.value.filter(f => f.action === 'modified'))
const read = computed(() => files.value.filter(f => f.action === 'read' || f.action === 'checked'))
</script>

<template>
  <div class="flex flex-col h-full">
    <div class="shrink-0 px-3 py-2 border-b border-app flex items-center justify-between">
      <span class="text-[10px] uppercase tracking-[0.16em] text-app-muted/60 font-medium">Files</span>
      <span class="text-[10px] text-app-muted/50 font-mono">{{ files.length }}</span>
    </div>
    <div class="flex-1 overflow-y-auto px-3 py-2 space-y-3">
      <template v-if="files.length === 0">
        <div v-if="isRunning" class="flex items-center gap-2 py-4 justify-center">
          <span class="size-2 rounded-full bg-[var(--app-accent)] animate-pulse" />
          <p class="text-xs text-app-muted/50">Waiting...</p>
        </div>
        <p v-else class="text-xs text-app-muted/50 py-4 text-center">Files touched by Coder will appear here.</p>
      </template>

      <!-- Created -->
      <div v-if="created.length" class="space-y-0.5">
        <p class="text-[10px] uppercase tracking-[0.12em] text-emerald-400/70 font-medium mb-1">Created</p>
        <div v-for="f in created" :key="f.path" class="flex items-center gap-2 py-0.5 font-mono text-xs" :title="f.path">
          <Plus class="size-3 shrink-0 text-emerald-400" />
          <span class="text-emerald-300/80 truncate">{{ f.short }}</span>
        </div>
      </div>

      <!-- Modified -->
      <div v-if="modified.length" class="space-y-0.5">
        <p class="text-[10px] uppercase tracking-[0.12em] text-amber-400/70 font-medium mb-1">Modified</p>
        <div v-for="f in modified" :key="f.path" class="flex items-center gap-2 py-0.5 font-mono text-xs" :title="f.path">
          <Pencil class="size-3 shrink-0 text-amber-400" />
          <span class="text-amber-300/80 truncate">{{ f.short }}</span>
        </div>
      </div>

      <!-- Read -->
      <div v-if="read.length" class="space-y-0.5">
        <p class="text-[10px] uppercase tracking-[0.12em] text-app-muted/40 font-medium mb-1">Read</p>
        <div v-for="f in read" :key="f.path" class="flex items-center gap-2 py-0.5 font-mono text-xs" :title="f.path">
          <Eye class="size-3 shrink-0 text-app-muted/40" />
          <span class="text-app-muted/50 truncate">{{ f.short }}</span>
        </div>
      </div>
    </div>
    <div v-if="isRunning" class="shrink-0 px-3 py-1.5 border-t border-app">
      <div class="flex items-center gap-2">
        <span class="size-1.5 rounded-full bg-[var(--app-accent)] animate-pulse" />
        <span class="text-[10px] text-app-muted/60">Running</span>
      </div>
    </div>
  </div>
</template>
