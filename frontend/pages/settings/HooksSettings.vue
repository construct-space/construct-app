<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useSkills } from '@/composables/useSkills'
import type { HookInfo } from '@/composables/useSkills'
import { Badge, Button, Card, Empty, Icon, Modal, Select, Switch } from '@construct-space/ui'
import { Loader2, Plus, RefreshCw, Wand2, Webhook } from 'lucide-vue-next'
import { useOrgStore } from '@/stores/org'
import { useBrain } from '@/brain'
import { useAIModel } from '@/composables/useAIModel'
import OrgManagedBadge from '@/components/common/OrgManagedBadge.vue'

const toast = useNotification()
const orgStore = useOrgStore()
const brain = useBrain()
const { defaultModelId } = useAIModel()
const { hooks, isLoading, enableHook, disableHook, saveHook, deleteHook, refresh } = useSkills()
const isSaving = ref(false)

const hookTypeFilter = ref('')
const hookTypes = [
  { label: 'All types', value: '' },
  { label: 'Pre-tool', value: 'pre_tool' },
  { label: 'Post-tool', value: 'post_tool' },
  { label: 'Session', value: 'session' },
  { label: 'File changed', value: 'file' },
]

const filteredHooks = computed(() => {
  if (!hookTypeFilter.value) return hooks.value
  return hooks.value.filter(h => h.type.startsWith(hookTypeFilter.value))
})

async function toggleHook(hook: HookInfo) {
  try {
    if (hook.enabled) {
      await disableHook(hook.id)
      toast.add({ title: `${hook.name} disabled`, color: 'warning' })
    } else {
      await enableHook(hook.id)
      toast.add({ title: `${hook.name} enabled`, color: 'success' })
    }
  } catch (e) {
    toast.add({ title: String(e), color: 'error' })
  }
}

// ───── Add-hook modal ─────

const showAddModal = ref(false)
const addMode = ref<'paste' | 'ai'>('ai')
const newHookJson = ref(`{
  "id": "my-hook",
  "name": "My hook",
  "type": "pre_tool",
  "priority": 10,
  "description": "What this hook checks",
  "tools": ["write_file", "edit_file"],
  "patterns": [],
  "command": "echo block=false",
  "timeout": 10
}`)
const aiPrompt = ref('')
const isGenerating = ref(false)

// Condensed hook-authoring guidance. Matches operator/internal/hook/hook.go
// Hook struct shape, so the generated JSON can be pasted straight into
// ~/Library/Application Support/Construct/hooks.json (under the `hooks`
// array).
const HOOK_CREATOR_SYSTEM_PROMPT = `You write Construct user hooks.

A hook is a JSON object that runs around tool executions. Output EXACTLY one fenced \`\`\`json\`\`\` code block containing the full hook object and nothing else. No commentary.

Schema:
- id (string, required): stable kebab-case identifier
- name (string): short display name
- type (string, required): "pre_tool" (runs BEFORE a tool, can block by exit ≠ 0) or "post_tool" (runs AFTER, cannot block)
- priority (int, default 10): lower runs first within a type
- description (string): what the hook does, surfaced in settings
- tools (array of string): exact tool names or globs. Empty array = all tools. Common names: read_file, write_file, edit_file, bash, glob, grep, list_dir.
- patterns (array of string, optional): path globs matched against TOOL_INPUT's parsed path/file_path
- command (string, required): shell snippet (sh -c on macOS/Linux, cmd /c on Windows). Available env vars: HOOK_TYPE, TOOL_NAME, TOOL_INPUT (pre), TOOL_OUTPUT (post), CONSTRUCT_PROJECT_ROOT.
- timeout (int seconds, default 10)

Blocking semantics:
- pre_tool: exit 0 = allow, non-zero = block. You can also print JSON like {"block":true,"message":"reason"} to structured-block.
- post_tool: never blocks; use for logging/formatting/metrics.

Writing rules:
- Keep commands POSIX-sh compatible unless the user says otherwise
- Prefer small single-purpose hooks
- For formatters, detect file extension via a case statement on "$TOOL_INPUT"
- Don't invent tool names; stick to the common ones above or the ones the user mentions

Example — run prettier after writes:
\`\`\`json
{
  "id": "prettier-on-write",
  "name": "Prettier on write",
  "type": "post_tool",
  "priority": 20,
  "description": "Format JS/TS/JSON/MD files after write_file or edit_file.",
  "tools": ["write_file", "edit_file"],
  "patterns": ["*.ts", "*.tsx", "*.js", "*.jsx", "*.json", "*.md"],
  "command": "path=$(printf '%s' \\"$TOOL_INPUT\\" | jq -r '.path // .file_path // empty'); [ -n \\"$path\\" ] && npx --yes prettier --write \\"$path\\" >/dev/null 2>&1 || true",
  "timeout": 15
}
\`\`\`

Now generate the hook the user requests.`

function extractHookJson(raw: string): string {
  const m = raw.match(/```(?:json)?\s*\n([\s\S]*?)\n```/)
  return (m ? m[1] : raw).trim()
}

async function handleGenerate() {
  const prompt = aiPrompt.value.trim()
  if (!prompt) {
    toast.add({ title: 'Describe what the hook should do', color: 'warning' })
    return
  }
  isGenerating.value = true
  try {
    const model = defaultModelId.value?.includes(':')
      ? defaultModelId.value.split(':').slice(1).join(':')
      : defaultModelId.value || undefined
    const task = `${HOOK_CREATOR_SYSTEM_PROMPT}\n\n---\n\nUser request:\n${prompt}`
    const result = await brain.dispatch('ask', task, model)
    const content = extractHookJson(result?.content || '')
    if (!content) {
      toast.add({ title: 'Generator returned nothing. Try again.', color: 'error' })
      return
    }
    // Sanity-check: must parse and have at least id + type + command
    try {
      const parsed = JSON.parse(content) as Record<string, unknown>
      if (!parsed.id || !parsed.type || !parsed.command) {
        toast.add({ title: 'Generated hook is missing required fields (id, type, command).', color: 'warning' })
      }
    } catch {
      toast.add({ title: 'Generated JSON did not parse cleanly — check and fix before copying.', color: 'warning' })
    }
    newHookJson.value = content
    addMode.value = 'paste'
    toast.add({ title: 'Hook generated — review then copy to hooks.json', color: 'success' })
  } catch (e) {
    toast.add({ title: `Generation failed: ${e}`, color: 'error' })
  } finally {
    isGenerating.value = false
  }
}

async function copyHookJson() {
  try {
    await navigator.clipboard.writeText(newHookJson.value)
    toast.add({ title: 'Hook JSON copied', color: 'success' })
  } catch (e) {
    toast.add({ title: `Copy failed: ${e}`, color: 'error' })
  }
}

async function handleSaveHook() {
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(newHookJson.value) as Record<string, unknown>
  } catch (e) {
    toast.add({ title: `Invalid JSON: ${e}`, color: 'error' })
    return
  }
  if (!parsed.id || !parsed.type || !parsed.command) {
    toast.add({ title: 'Hook needs id, type, and command.', color: 'warning' })
    return
  }
  isSaving.value = true
  try {
    const result = await saveHook(parsed)
    if (result) {
      toast.add({ title: `Hook "${result.name || result.id}" saved`, color: 'success' })
      showAddModal.value = false
      aiPrompt.value = ''
    } else {
      toast.add({ title: 'Failed to save hook', color: 'error' })
    }
  } catch (e) {
    toast.add({ title: String(e), color: 'error' })
  } finally {
    isSaving.value = false
  }
}

async function handleDeleteHook(hookId: string) {
  if (!hookId) return
  try {
    const ok = await deleteHook(hookId)
    if (ok) toast.add({ title: 'Hook deleted', color: 'info' })
    else toast.add({ title: 'Cannot delete — only user hooks can be removed from the UI', color: 'warning' })
  } catch (e) {
    toast.add({ title: String(e), color: 'error' })
  }
}

onMounted(() => { refresh() })
</script>

<template>
  <div>
    <!-- Org-managed banner -->
    <div v-if="orgStore.isEnabled"
      class="mb-4 flex items-center gap-2 px-3 py-2 rounded-sm bg-amber-500/5 border border-amber-500/20">
      <OrgManagedBadge :org-name="orgStore.orgName" />
      <span class="text-xs text-[var(--app-muted)]">Hooks may be managed by your organization.</span>
    </div>

    <!-- Intro -->
    <Card variant="muted" class="mb-4">
      <template #header>
        <div class="flex items-start gap-3 min-w-0 flex-1">
          <Webhook class="size-5 text-[var(--app-muted)] mt-0.5 shrink-0" />
          <div class="min-w-0 flex-1">
            <h3
              class="text-sm tracking-[0.08em] uppercase font-normal text-[var(--app-foreground)] leading-tight after:content-['.'] after:text-[var(--app-accent)]">
              Hooks
</h3>
            <p class="text-sm text-[var(--app-muted)] mt-0.5">
Pre/post-tool hooks, safety guards, and lifecycle
              callbacks — registered by loaded skills.
</p>
          </div>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <Button variant="ghost" color="neutral" size="xs" :loading="isLoading" @click="refresh">
            <template #leading>
              <RefreshCw class="size-3.5" />
            </template>
          </Button>
          <Button size="xs" label="Add hook" @click="showAddModal = true">
            <template #leading>
              <Plus class="size-3.5" />
            </template>
          </Button>
        </div>
      </template>
    </Card>

    <!-- Loading -->
    <div v-if="isLoading && !hooks.length" class="flex items-center justify-center py-12">
      <Loader2 class="size-5 animate-spin text-[var(--app-muted)]" />
    </div>

    <template v-else>
      <!-- Filter row -->
      <div v-if="hooks.length > 0" class="mb-4 flex items-center gap-3">
        <span class="text-[11px] tracking-[0.12em] uppercase font-medium text-[var(--app-muted)]">Filter</span>
        <div class="w-48">
          <Select v-model="hookTypeFilter" :options="hookTypes" />
        </div>
        <span class="text-xs text-[var(--app-muted)]">{{ filteredHooks.length }} of {{ hooks.length }}</span>
      </div>

      <!-- Empty state -->
      <Card v-if="filteredHooks.length === 0">
        <Empty icon="i-lucide-webhook" title="No hooks"
          description="Hooks are registered by loaded skills. Enable a skill that contributes hooks, or add your own below.">
          <Button size="sm" label="Add hook" @click="showAddModal = true">
            <template #leading>
              <Plus class="size-3.5" />
            </template>
          </Button>
        </Empty>
      </Card>

      <!-- Hook list -->
      <div v-else class="space-y-3">
        <Card v-for="hook in filteredHooks" :key="hook.id" :class="hook.enabled ? '' : 'opacity-60'">
          <template #header>
            <div class="flex items-start gap-3 min-w-0 flex-1">
              <Webhook class="size-5 shrink-0 text-[var(--app-muted)] mt-0.5" />
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2 flex-wrap">
                  <h4
                    class="text-sm tracking-[0.08em] uppercase font-normal text-[var(--app-foreground)] leading-tight after:content-['.'] after:text-[var(--app-accent)]">
                    {{ hook.name }}
</h4>
                  <Badge color="neutral" size="xs">{{ hook.type }}</Badge>
                  <Badge :color="hook.enabled ? 'success' : 'warning'" size="xs">
{{ hook.enabled ? 'enabled' :
                    'disabled' }}
</Badge>
                </div>
                <p v-if="hook.description" class="text-xs text-[var(--app-muted)] mt-1 line-clamp-2">
{{ hook.description
                  }}
</p>
              </div>
            </div>
            <div class="shrink-0" @click.stop>
              <Switch :model-value="hook.enabled" size="sm" @update:model-value="toggleHook(hook)" />
            </div>
          </template>

          <div class="flex items-center gap-3 text-xs text-[var(--app-muted)] flex-wrap">
            <span>Priority {{ hook.priority }}</span>
            <span v-if="hook.source"
              class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm bg-[color-mix(in_srgb,var(--app-muted)_10%,transparent)] uppercase tracking-[0.08em] text-[10px]">
              {{ hook.source }}
            </span>
            <span v-if="hook.skillId"
              class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm bg-[color-mix(in_srgb,var(--app-accent)_8%,transparent)] text-[var(--app-accent)]/70">
              <Icon name="i-lucide-sparkles" class="size-3" />
              {{ hook.skillId }}
            </span>
          </div>

          <template v-if="hook.source === 'user'" #footer-end>
            <Button variant="ghost" color="error" size="xs" label="Delete" @click="handleDeleteHook(hook.id)" />
          </template>
        </Card>
      </div>
    </template>

    <!-- Add Hook Modal -->
    <Modal :open="showAddModal" title="Add Hook" @close="showAddModal = false">
      <div class="space-y-4">
        <!-- Mode toggle -->
        <div class="flex gap-2 flex-wrap">
          <button v-for="m in (['ai', 'paste'] as const)" :key="m"
            class="px-3 py-1.5 text-xs rounded-sm border transition-colors cursor-pointer inline-flex items-center gap-1.5"
            :class="addMode === m
              ? 'border-[var(--app-accent)] bg-[color-mix(in_srgb,var(--app-accent)_10%,transparent)] text-[var(--app-accent)]'
              : 'border-[var(--app-border)] text-[var(--app-muted)] hover:text-[var(--app-foreground)]'"
            @click="addMode = m">
            <Wand2 v-if="m === 'ai'" class="size-3" />
            {{ m === 'ai' ? 'Generate with AI' : 'Paste JSON' }}
          </button>
        </div>

        <!-- AI mode -->
        <template v-if="addMode === 'ai'">
          <div>
            <label class="block text-xs font-medium text-[var(--app-muted)] mb-1">Describe the hook</label>
            <textarea v-model="aiPrompt" rows="5"
              class="w-full rounded-sm border border-[var(--app-border)] bg-[var(--app-background)] text-[var(--app-foreground)] text-sm p-3 focus:outline-none focus:ring-1 focus:ring-[var(--app-accent)] resize-y"
              placeholder="e.g. A pre_tool hook that blocks bash commands containing 'rm -rf' unless the path starts with /tmp." />
            <p class="text-xs text-[var(--app-muted)] mt-1">
              Generates a JSON hook you can paste into <code class="font-mono">hooks.json</code>. Pick <strong>Paste
                JSON</strong> after generation to review and copy.
            </p>
            <p v-if="defaultModelId" class="text-[10px] tracking-[0.08em] uppercase text-[var(--app-muted)] mt-1">
              Model · <strong class="text-[var(--app-foreground)]">{{ defaultModelId }}</strong>
            </p>
            <p v-else class="text-xs text-amber-500 mt-1">
              No default model set. Pick one in Settings → Providers first.
            </p>
          </div>
        </template>

        <!-- Paste / review mode -->
        <template v-else>
          <div>
            <label class="block text-xs font-medium text-[var(--app-muted)] mb-1">Hook JSON</label>
            <textarea v-model="newHookJson" rows="16" spellcheck="false"
              class="w-full rounded-sm border border-[var(--app-border)] bg-[var(--app-background)] text-[var(--app-foreground)] text-sm font-mono p-3 focus:outline-none focus:ring-1 focus:ring-[var(--app-accent)] resize-y" />
            <p class="text-xs text-[var(--app-muted)] mt-2 leading-relaxed">
              Saves to your active profile at <code
                class="font-mono">~/Library/Application Support/Construct/profiles/&lt;profile&gt;/hooks.json</code> and
              registers with the running operator — no restart needed.
            </p>
          </div>
        </template>

        <div class="flex justify-end gap-2">
          <Button variant="soft" label="Close" @click="showAddModal = false" />
          <Button v-if="addMode === 'ai'" label="Generate" :loading="isGenerating"
            :disabled="!aiPrompt.trim() || !defaultModelId" @click="handleGenerate">
            <template #leading>
              <Wand2 class="size-3.5" />
            </template>
          </Button>
          <template v-else>
            <Button variant="ghost" label="Copy JSON" :disabled="!newHookJson.trim()" @click="copyHookJson" />
            <Button label="Save hook" :loading="isSaving" :disabled="!newHookJson.trim()" @click="handleSaveHook" />
          </template>
        </div>
      </div>
    </Modal>
  </div>
</template>
