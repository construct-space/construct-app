<script setup lang="ts">
/**
 * AutomationsSettings — natural-language, scheduled cross-space automations.
 *
 * A rule is an English instruction + an interval. A background reactor agent
 * runs it on schedule with the space-action tools (read mail, create calendar
 * events, etc.) — e.g. "when I get a meeting invite, add it to my calendar".
 */
import { ref, onMounted, onUnmounted } from 'vue'
import { useConductor, type Automation } from '@/composables/useConductor'
import { Button, Card, Empty, Modal, Switch } from '@construct-space/ui'
import { Zap, Loader2, Plus, Trash2, Play } from 'lucide-vue-next'

const conductor = useConductor()
const rules = ref<Automation[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const running = ref<Record<string, boolean>>({})

// New-rule form
const draft = ref('')
const draftInterval = ref(15)
const saving = ref(false)

const intervals = [5, 15, 30, 60, 180, 720, 1440]

// quiet = background poll: don't flash the spinner or surface transient errors,
// so executor runs (last_run / result) show up live without a manual refresh.
async function load(quiet = false) {
  if (!quiet) { loading.value = true; error.value = null }
  try {
    const res = await conductor.list()
    rules.value = res.automations || []
    if (quiet) error.value = null
  } catch (e) { if (!quiet) error.value = e instanceof Error ? e.message : String(e) }
  finally { if (!quiet) loading.value = false }
}

async function add() {
  if (!draft.value.trim()) return
  saving.value = true; error.value = null
  try {
    await conductor.save({ instruction: draft.value.trim(), interval_min: draftInterval.value, enabled: true })
    draft.value = ''
    await load()
  } catch (e) { error.value = e instanceof Error ? e.message : String(e) }
  finally { saving.value = false }
}

async function toggle(r: Automation) {
  try { await conductor.save({ ...r, enabled: !r.enabled }); await load() }
  catch (e) { error.value = e instanceof Error ? e.message : String(e) }
}

// Delete is confirmed via a Modal — window.confirm() is intercepted by Tauri
// and isn't available in the desktop webview.
const pendingDelete = ref<Automation | null>(null)
const deleting = ref(false)

function remove(r: Automation) { pendingDelete.value = r }

async function confirmRemove() {
  const r = pendingDelete.value
  if (!r) return
  deleting.value = true; error.value = null
  try { await conductor.remove(r.id); pendingDelete.value = null; await load() }
  catch (e) { error.value = e instanceof Error ? e.message : String(e) }
  finally { deleting.value = false }
}

async function runNow(r: Automation) {
  running.value = { ...running.value, [r.id]: true }
  try { await conductor.runNow(r.id); await load() }
  catch (e) { error.value = e instanceof Error ? e.message : String(e) }
  finally { running.value = { ...running.value, [r.id]: false } }
}

function intervalLabel(m: number): string {
  if (m % 1440 === 0) return `${m / 1440}d`
  if (m % 60 === 0) return `${m / 60}h`
  return `${m}m`
}
function ago(ts?: number): string {
  if (!ts) return 'never'
  const s = Math.floor(Date.now() / 1000) - ts
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

// Poll so background executor runs (last_run, result) appear without a reload.
let poll: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  load()
  poll = setInterval(() => load(true), 15000)
})
onUnmounted(() => { if (poll) clearInterval(poll) })
</script>

<template>
  <div class="space-y-4">
    <Card>
      <div class="flex items-start gap-3 p-4">
        <Zap class="size-5 text-[var(--app-muted)] mt-0.5 shrink-0" />
        <div class="min-w-0 flex-1">
          <h3 class="text-sm font-semibold text-[var(--app-foreground)]">Automations</h3>
          <p class="text-xs text-[var(--app-muted)] mt-0.5">
            Plain-English rules the agent runs on a schedule across your spaces — e.g. “when I get a meeting invite, add it to my calendar.” Stored in the cloud and run by your desktop whenever it’s online.
          </p>
        </div>
      </div>
    </Card>

    <!-- New rule -->
    <Card>
      <div class="p-4 space-y-3">
        <textarea
          v-model="draft"
          class="w-full h-20 rounded-lg border p-3 text-sm resize-y focus:outline-none focus:ring-2"
          style="border-color: var(--app-border); background: var(--app-background); color: var(--app-foreground); --tw-ring-color: color-mix(in srgb, var(--app-accent) 35%, transparent)"
          placeholder="When I get an email with a meeting invitation, create a matching event in my calendar."
        />
        <div class="flex items-center gap-3">
          <label class="text-xs text-[var(--app-muted)]">Every</label>
          <select v-model.number="draftInterval"
            class="rounded-md border px-2 py-1 text-sm"
            style="border-color: var(--app-border); background: var(--app-background); color: var(--app-foreground)">
            <option v-for="m in intervals" :key="m" :value="m">{{ intervalLabel(m) }}</option>
          </select>
          <Button :disabled="!draft.trim() || saving" @click="add">
            <Loader2 v-if="saving" class="size-4 animate-spin" /><Plus v-else class="size-4" />
            Add automation
          </Button>
          <span v-if="error" class="text-xs text-red-400">{{ error }}</span>
        </div>
      </div>
    </Card>

    <div v-if="loading" class="flex items-center gap-2 text-sm text-[var(--app-muted)] px-1">
      <Loader2 class="size-4 animate-spin" /> Loading…
    </div>
    <Empty v-else-if="rules.length === 0" title="No automations yet"
      description="Add a rule above to have the agent act on your spaces on a schedule." />

    <Card v-for="r in rules" :key="r.id">
      <div class="p-4 flex items-start gap-3">
        <div class="min-w-0 flex-1">
          <p class="text-sm text-[var(--app-foreground)]" :class="r.enabled ? '' : 'opacity-50'">{{ r.instruction }}</p>
          <div class="flex items-center gap-3 mt-1.5 text-xs text-[var(--app-muted)]">
            <span>every {{ intervalLabel(r.interval_min) }}</span>
            <span>· last run {{ ago(r.last_run_at) }}</span>
          </div>
          <p v-if="r.last_result" class="text-xs mt-1 text-[var(--app-muted)] italic line-clamp-2">↳ {{ r.last_result }}</p>
        </div>
        <div class="shrink-0 flex items-center gap-2">
          <Button size="sm" variant="ghost" :disabled="running[r.id]" title="Run now" @click="runNow(r)">
            <Loader2 v-if="running[r.id]" class="size-4 animate-spin" /><Play v-else class="size-4" />
          </Button>
          <button class="p-1.5 rounded text-[var(--app-muted)] hover:text-red-400" title="Delete" @click="remove(r)">
            <Trash2 class="size-4" />
          </button>
          <Switch :model-value="r.enabled" size="sm" @update:model-value="toggle(r)" />
        </div>
      </div>
    </Card>

    <Modal :open="!!pendingDelete" title="Delete automation?" @close="pendingDelete = null">
      <div class="space-y-4 p-1">
        <p class="text-sm text-[var(--app-muted)]">
          This will permanently remove the rule
          <span class="text-[var(--app-foreground)]">“{{ pendingDelete?.instruction }}”</span>.
        </p>
        <div class="flex justify-end gap-2">
          <Button variant="ghost" size="sm" label="Cancel" :disabled="deleting" @click="pendingDelete = null" />
          <Button color="error" size="sm" :disabled="deleting" @click="confirmRemove">
            <Loader2 v-if="deleting" class="size-4 animate-spin" /><Trash2 v-else class="size-4" />
            Delete
          </Button>
        </div>
      </div>
    </Modal>
  </div>
</template>
