<script setup lang="ts">
import type { LocalProject } from '@/types/project'

const props = defineProps<{
  project: LocalProject | null
}>()

const emit = defineEmits<{
  close: []
  save: [name: string, description?: string]
}>()

const name = ref('')
const description = ref('')

watch(() => props.project, (p) => {
  if (p) {
    name.value = p.name
    description.value = p.description || ''
  }
}, { immediate: true })

function handleSave() {
  if (!name.value.trim()) return
  emit('save', name.value.trim(), description.value.trim() || undefined)
}
</script>

<template>
  <Teleport to="body">
    <div v-if="project" class="fixed inset-0 z-[200] flex items-center justify-center">
      <div class="absolute inset-0 bg-black/50" @click="emit('close')" />
      <div class="relative w-full max-w-md mx-4 rounded-xl border border-[var(--app-border)] bg-[var(--app-background)] shadow-2xl">
        <div class="p-6">
          <h2 class="text-lg font-semibold text-[var(--app-foreground)] mb-4">Edit Project</h2>
          <div class="space-y-4">
            <div>
              <label class="block text-xs font-medium text-[var(--app-muted)] mb-1.5">Name</label>
              <input
                v-model="name"
                type="text"
                class="w-full px-3 py-2 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface)] text-sm text-[var(--app-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--app-accent)]/30 focus:border-[var(--app-accent)]"
                autofocus
                @keydown.enter="handleSave"
              />
            </div>
            <div>
              <label class="block text-xs font-medium text-[var(--app-muted)] mb-1.5">
                Description <span class="text-[var(--app-muted)]/50">(optional)</span>
              </label>
              <textarea
                v-model="description"
                rows="3"
                placeholder="What's this project about?"
                class="w-full px-3 py-2 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface)] text-sm text-[var(--app-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--app-accent)]/30 focus:border-[var(--app-accent)] resize-none"
              />
            </div>
            <div>
              <label class="block text-xs font-medium text-[var(--app-muted)] mb-1.5">Location</label>
              <div class="px-3 py-2 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface)] text-xs text-[var(--app-muted)] truncate">
                {{ project.path }}
              </div>
            </div>
          </div>
          <div class="flex justify-end gap-3 mt-6">
            <button
              class="px-4 py-2 rounded-lg border border-[var(--app-border)] text-sm text-[var(--app-foreground)] hover:bg-[var(--app-muted)]/5 transition-colors"
              @click="emit('close')"
            >
              Cancel
            </button>
            <button
              class="px-4 py-2 rounded-lg bg-[var(--app-accent)] text-white text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
              :disabled="!name.trim()"
              @click="handleSave"
            >
              Save Changes
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
