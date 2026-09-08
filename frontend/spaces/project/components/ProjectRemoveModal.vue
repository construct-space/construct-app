<script setup lang="ts">
import type { LocalProject } from '@/types/project'

defineProps<{
  project: LocalProject | null
}>()

const emit = defineEmits<{
  close: []
  remove: [deleteFromDisk: boolean]
}>()
</script>

<template>
  <Teleport to="body">
    <div v-if="project" class="fixed inset-0 z-[200] flex items-center justify-center">
      <div class="absolute inset-0 bg-black/50" @click="emit('close')" />
      <div class="relative w-full max-w-sm mx-4 rounded-xl border border-[var(--app-border)] bg-[var(--app-background)] shadow-2xl">
        <div class="p-6">
          <div class="flex items-center gap-3 mb-4">
            <div class="size-10 rounded-full bg-red-500/10 flex items-center justify-center shrink-0">
              <i class="i-lucide-folder-minus size-5 text-red-500" />
            </div>
            <div>
              <h3 class="text-base font-semibold text-[var(--app-foreground)]">Remove Project</h3>
              <p class="text-sm text-[var(--app-muted)] mt-0.5">
                Remove <strong>{{ project.name }}</strong>?
              </p>
            </div>
          </div>
          <p class="text-xs text-[var(--app-muted)] mb-1 truncate">{{ project.path }}</p>
          <div class="flex flex-col gap-2 mt-4">
            <button
              class="flex items-center gap-2.5 w-full px-3 py-2.5 rounded-lg border border-[var(--app-border)] text-left hover:bg-[var(--app-muted)]/5 transition-colors"
              @click="emit('remove', false)"
            >
              <i class="i-lucide-eye-off size-4 text-[var(--app-muted)]" />
              <div>
                <div class="text-sm font-medium text-[var(--app-foreground)]">Remove from Construct</div>
                <div class="text-xs text-[var(--app-muted)]">Files on disk will not be touched</div>
              </div>
            </button>
            <button
              class="flex items-center gap-2.5 w-full px-3 py-2.5 rounded-lg border border-red-500/30 text-left hover:bg-red-500/5 transition-colors"
              @click="emit('remove', true)"
            >
              <i class="i-lucide-trash-2 size-4 text-red-400" />
              <div>
                <div class="text-sm font-medium text-red-400">Move to Trash</div>
                <div class="text-xs text-[var(--app-muted)]">Move project folder to Trash</div>
              </div>
            </button>
          </div>
          <div class="flex justify-end mt-4">
            <button
              class="px-4 py-2 rounded-lg border border-[var(--app-border)] text-sm text-[var(--app-foreground)] hover:bg-[var(--app-muted)]/5 transition-colors"
              @click="emit('close')"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
