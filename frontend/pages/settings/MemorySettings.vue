<script setup lang="ts">
/**
 * MemorySettings — view & edit the agent's self-curated memory.
 *
 * The agent persists durable knowledge across sessions (the "grows with you"
 * loop) and saves it here via the `memory` tool / background review. Scopes:
 *   user    — personal, follows you everywhere
 *   project — facts & conventions for the active project (lives with the repo)
 *   org     — shared across your org (server-side; coming soon)
 */
import { ref, computed, watch, onMounted } from 'vue'
import { useBrain } from '@/brain'
import { useProjectStore } from '@/stores/project'
import { Button, Card, Empty } from '@construct-space/ui'
import { BrainCircuit, Loader2, Save, FolderGit2, User, Building2 } from 'lucide-vue-next'

const brain = useBrain()
const projectStore = useProjectStore()

type Scope = 'user' | 'project' | 'org'
const scope = ref<Scope>('user')

const content = ref('')
const original = ref('')
const loading = ref(false)
const saving = ref(false)
const error = ref<string | null>(null)
const savedAt = ref<number | null>(null)

const projectDir = computed(() => projectStore.currentProject?.local_path || projectStore.currentProject?.path || '')
const dirty = computed(() => content.value !== original.value)

const tabs: { id: Scope; label: string; icon: typeof User }[] = [
  { id: 'user', label: 'Personal', icon: User },
  { id: 'project', label: 'Project', icon: FolderGit2 },
  { id: 'org', label: 'Organization', icon: Building2 },
]

async function load() {
  error.value = null
  savedAt.value = null
  if (scope.value === 'project' && !projectDir.value) {
    content.value = ''; original.value = ''
    return
  }
  loading.value = true
  try {
    const res = await brain.request<{ content: string }>('memory.get', {
      scope: scope.value,
      project_dir: scope.value === 'project' ? projectDir.value : '',
    })
    content.value = res.content || ''
    original.value = content.value
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

async function save() {
  if (!dirty.value) return
  saving.value = true
  error.value = null
  try {
    await brain.request('memory.set', {
      scope: scope.value,
      project_dir: scope.value === 'project' ? projectDir.value : '',
      content: content.value,
    })
    original.value = content.value
    savedAt.value = Date.now()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    saving.value = false
  }
}

watch(scope, load)
onMounted(load)

const placeholder = computed(() => {
  if (scope.value === 'user') return '# Nothing saved yet.\n\nThe agent writes durable facts about you here — preferences, working style, identity — as you work. You can edit this directly too.'
  if (scope.value === 'org') return '# Nothing saved yet.\n\nShared across your organization — team conventions, standards, and facts every member\'s agent should know. Edits here are visible to all members.'
  return '# Nothing saved yet.\n\nThe agent saves conventions & facts about this project here as it works. Lives with the repo in .construct/memory.md.'
})

const hint = computed(() => {
  if (scope.value === 'org') return 'Shared with everyone in your organization.'
  if (scope.value === 'project') return 'Stored in .construct/memory.md — travels with the repo.'
  return 'Personal — follows you across projects and orgs.'
})
</script>

<template>
  <div class="space-y-4">
    <Card>
      <div class="flex items-start gap-3 p-4">
        <BrainCircuit class="size-5 text-[var(--app-muted)] mt-0.5 shrink-0" />
        <div class="min-w-0 flex-1">
          <h3 class="text-sm font-semibold text-[var(--app-foreground)]">Memory</h3>
          <p class="text-xs text-[var(--app-muted)] mt-0.5">
            What the agent has learned and saved across sessions. It's injected into the agent's context each turn.
          </p>
        </div>
      </div>
    </Card>

    <!-- Scope tabs -->
    <div class="flex items-center gap-1 border-b" style="border-color: var(--app-border)">
      <button
        v-for="t in tabs" :key="t.id"
        class="flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 -mb-px transition-colors"
        :class="scope === t.id
          ? 'border-[var(--app-accent)] text-[var(--app-foreground)] font-medium'
          : 'border-transparent text-[var(--app-muted)] hover:text-[var(--app-foreground)]'"
        @click="scope = t.id"
      >
        <component :is="t.icon" class="size-3.5" />
        {{ t.label }}
      </button>
    </div>

    <p class="text-xs text-[var(--app-muted)] -mt-2">{{ hint }}</p>

    <!-- Project with no active project -->
    <Empty v-if="scope === 'project' && !projectDir"
      title="No active project"
      description="Open a project to view or edit its memory (stored in .construct/memory.md, travels with the repo)." />

    <template v-else>
      <div v-if="loading" class="flex items-center gap-2 text-sm text-[var(--app-muted)] px-1">
        <Loader2 class="size-4 animate-spin" /> Loading…
      </div>
      <template v-else>
        <textarea
          v-model="content"
          class="w-full h-[420px] rounded-lg border p-3 text-sm font-mono resize-y focus:outline-none focus:ring-2"
          style="border-color: var(--app-border); background: var(--app-background); color: var(--app-foreground); --tw-ring-color: color-mix(in srgb, var(--app-accent) 35%, transparent)"
          :placeholder="placeholder"
        />
        <div class="flex items-center gap-3">
          <Button :disabled="!dirty || saving" @click="save">
            <Loader2 v-if="saving" class="size-4 animate-spin" />
            <Save v-else class="size-4" />
            Save
          </Button>
          <span v-if="error" class="text-xs text-red-400">{{ error }}</span>
          <span v-else-if="savedAt" class="text-xs text-emerald-400">Saved</span>
          <span v-else-if="dirty" class="text-xs text-[var(--app-muted)]">Unsaved changes</span>
        </div>
      </template>
    </template>
  </div>
</template>
