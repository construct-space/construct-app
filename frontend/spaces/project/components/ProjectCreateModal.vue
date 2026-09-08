<script setup lang="ts">
/**
 * ProjectCreateModal — name + description + kind picker.
 *
 * The `kind` tells callers which space to open this project in:
 *   - "project"        → Builder (general dev: web apps, scripts, landing pages)
 *   - "space-project"  → Space Developer (scaffolds + builds Construct Spaces)
 *
 * Mirrors the flow already used by `spaces/org-project` detail page.
 */
import { Button, Input, Modal } from '@construct-space/ui'
import { Wrench, Boxes } from 'lucide-vue-next'

export type ProjectKind = 'project' | 'space-project'

// initialName/initialDescription let callers prefill the form when opening
// — used by the bridge-triggered flow (architect-driven project setup) to
// carry the suggested_name through. Keeps the page-level usage, which
// doesn't set them, working unchanged.
//
// forcedKind lets a caller skip the kind picker entirely. Passed by the
// Builder (forces 'project') and Space Developer (forces 'space-project')
// pages — the kind is implied by where the user is, so asking again is
// noise. The flat Projects index leaves it unset and shows the picker.
const props = defineProps<{
  open: boolean
  initialName?: string
  initialDescription?: string
  forcedKind?: ProjectKind
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  create: [name: string, description?: string, kind?: ProjectKind]
}>()

const name = ref('')
const description = ref('')
const kind = ref<ProjectKind>('project')

// When the modal transitions to open, copy prefill values in. Don't react
// to subsequent prop changes — once open, the form belongs to the user.
watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      name.value = props.initialName ?? ''
      description.value = props.initialDescription ?? ''
      kind.value = props.forcedKind ?? 'project'
    }
  },
)

function handleCreate() {
  if (!name.value.trim()) return
  emit('create', name.value.trim(), description.value.trim() || undefined, kind.value)
  name.value = ''
  description.value = ''
  kind.value = props.forcedKind ?? 'project'
}

function close() {
  emit('update:open', false)
}
</script>

<template>
  <Modal :open="open" title="New project" @close="close">
    <div class="space-y-4">
      <p v-if="!forcedKind" class="text-xs text-[var(--app-muted)]">
        Pick a kind so Construct knows which space to open this project in.
      </p>

      <div>
        <label class="block text-[10px] tracking-[0.08em] uppercase text-[var(--app-muted)] mb-1">Name</label>
        <Input
          v-model="name"
          placeholder="My Project"
          size="sm"
          @keydown.enter="handleCreate"
        />
      </div>

      <div>
        <label class="block text-[10px] tracking-[0.08em] uppercase text-[var(--app-muted)] mb-1">Description <span class="normal-case tracking-normal">(optional)</span></label>
        <textarea
          v-model="description"
          rows="3"
          placeholder="What's this project about?"
          class="w-full rounded-sm border border-[var(--app-border)] bg-[var(--app-background)] text-[var(--app-foreground)] text-sm p-3 focus:outline-none focus:ring-1 focus:ring-[var(--app-accent)] resize-y"
        />
      </div>

      <div v-if="!forcedKind">
        <label class="block text-[10px] tracking-[0.08em] uppercase text-[var(--app-muted)] mb-2">Kind</label>
        <div class="grid grid-cols-2 gap-2">
          <button
            type="button"
            class="p-3 rounded-sm border text-left transition-colors"
            :class="kind === 'project'
              ? 'border-[var(--app-accent)] bg-[color-mix(in_srgb,var(--app-accent)_8%,transparent)]'
              : 'border-[var(--app-border)] hover:border-[var(--app-accent)]/50'"
            @click="kind = 'project'"
          >
            <div class="flex items-center gap-1.5">
              <Wrench class="size-3.5 text-[var(--app-muted)]" />
              <div class="text-xs font-medium text-[var(--app-foreground)]">Default project</div>
            </div>
            <div class="text-[10px] text-[var(--app-muted)] mt-1 leading-snug">
              General dev — opens in Builder. Web apps, scripts, landing pages.
            </div>
          </button>
          <button
            type="button"
            class="p-3 rounded-sm border text-left transition-colors"
            :class="kind === 'space-project'
              ? 'border-[var(--app-accent)] bg-[color-mix(in_srgb,var(--app-accent)_8%,transparent)]'
              : 'border-[var(--app-border)] hover:border-[var(--app-accent)]/50'"
            @click="kind = 'space-project'"
          >
            <div class="flex items-center gap-1.5">
              <Boxes class="size-3.5 text-[var(--app-muted)]" />
              <div class="text-xs font-medium text-[var(--app-foreground)]">Space</div>
            </div>
            <div class="text-[10px] text-[var(--app-muted)] mt-1 leading-snug">
              Construct Space — opens in Space Developer. Scaffolds + builds spaces.
            </div>
          </button>
        </div>
      </div>

      <div class="flex justify-end gap-2">
        <Button variant="ghost" size="sm" label="Cancel" @click="close" />
        <Button
          size="sm"
          label="Create project"
          :disabled="!name.trim()"
          @click="handleCreate"
        />
      </div>
    </div>
  </Modal>
</template>
