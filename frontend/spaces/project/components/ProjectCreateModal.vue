<script setup lang="ts">
defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  create: [name: string, description?: string]
}>()

const name = ref('')
const description = ref('')

function handleCreate() {
  if (!name.value.trim()) return
  emit('create', name.value.trim(), description.value.trim() || undefined)
  name.value = ''
  description.value = ''
}

function close() {
  emit('update:open', false)
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-[200] flex items-center justify-center">
      <div class="absolute inset-0 bg-black/50" @click="close" />
      <div class="relative w-full max-w-md mx-4 rounded-xl border border-[var(--app-border)] bg-[var(--app-background)] shadow-2xl">
        <div class="p-6">
          <h2 class="text-lg font-semibold text-[var(--app-foreground)] mb-4">New Project</h2>
          <div class="space-y-4">
            <div>
              <label class="block text-xs font-medium text-[var(--app-muted)] mb-1.5">Name</label>
              <input
                v-model="name"
                type="text"
                placeholder="My Project"
                class="w-full px-3 py-2 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface)] text-sm text-[var(--app-foreground)] placeholder:text-[var(--app-muted)]/50 focus:outline-none focus:ring-2 focus:ring-[var(--app-accent)]/30 focus:border-[var(--app-accent)]"
                autofocus
                @keydown.enter="handleCreate"
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
                class="w-full px-3 py-2 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface)] text-sm text-[var(--app-foreground)] placeholder:text-[var(--app-muted)]/50 focus:outline-none focus:ring-2 focus:ring-[var(--app-accent)]/30 focus:border-[var(--app-accent)] resize-none"
              />
            </div>
          </div>
          <div class="flex justify-end gap-3 mt-6">
            <button
              class="px-4 py-2 rounded-lg border border-[var(--app-border)] text-sm text-[var(--app-foreground)] hover:bg-[var(--app-muted)]/5 transition-colors"
              @click="close"
            >
              Cancel
            </button>
            <button
              class="px-4 py-2 rounded-lg bg-[var(--app-accent)] text-white text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
              :disabled="!name.trim()"
              @click="handleCreate"
            >
              Create Project
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
