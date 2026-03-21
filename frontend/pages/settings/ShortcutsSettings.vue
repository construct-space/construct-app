<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useShortcutStore, SHORTCUT_REGISTRY, type ShortcutSpace } from '@/composables/useShortcutStore'
import { useGlobalShortcuts } from '@/composables/useGlobalShortcuts'

const store = useShortcutStore()

// Global shortcuts — the handler is only used in App.vue, but we need the
// enabled/setEnabled/refresh here for the settings toggle.
const globalShortcuts = useGlobalShortcuts((id) => {
  // This instance won't handle events — the root App.vue instance does.
  // We just need access to enabled state for the UI toggle.
  console.debug('[Settings] global shortcut fired:', id)
})

// ─── Group shortcuts by space then group ─────────────────────────────────────

const spaces: { id: ShortcutSpace; label: string; icon: string }[] = [
  { id: 'global', label: 'Global',  icon: 'i-lucide-globe' },
  { id: 'design', label: 'Design',  icon: 'i-lucide-pen-tool' },
  { id: 'code',   label: 'Code',    icon: 'i-lucide-code-2' },
  { id: 'git',    label: 'Git',     icon: 'i-lucide-git-branch' },
]

function shortcutsForSpace(space: ShortcutSpace) {
  const defs = SHORTCUT_REGISTRY.filter(s => s.space === space)
  const groups: Record<string, typeof defs> = {}
  for (const def of defs) {
    if (!groups[def.group]) groups[def.group] = []
    groups[def.group]!.push(def)
  }
  return groups
}

// ─── Active space tab ────────────────────────────────────────────────────────

const activeSpace = ref<ShortcutSpace>('global')

// ─── Key display formatting ──────────────────────────────────────────────────

const isMac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC')

function formatKey(keyStr: string): string[] {
  const parts = keyStr.split('+')
  return parts.map(p => {
    if (p === 'cmd')   return isMac ? '⌘' : 'Ctrl'
    if (p === 'shift') return '⇧'
    if (p === 'alt')   return isMac ? '⌥' : 'Alt'
    if (p === "'")     return "'"
    if (p === 'Escape')    return 'Esc'
    if (p === 'Delete')    return 'Del'
    if (p === 'Backspace') return '⌫'
    return p.toUpperCase()
  })
}

// ─── Remapping state ─────────────────────────────────────────────────────────

const remapping = ref<string | null>(null)  // shortcut id being remapped

function startRemap(id: string) {
  remapping.value = id
}

function cancelRemap() {
  remapping.value = null
}

// Conflict detection: returns id of conflicting shortcut in same space, or null
function findConflict(forId: string, key: string): string | null {
  const targetSpace = SHORTCUT_REGISTRY.find(s => s.id === forId)?.space
  if (!targetSpace) return null

  for (const def of SHORTCUT_REGISTRY) {
    if (def.id === forId) continue
    if (def.space !== targetSpace) continue
    const effectiveKey = store.getKey(def.id)
    if (effectiveKey === key) return def.id
  }
  return null
}

const conflictId = ref<string | null>(null)

function onRemapKeydown(e: KeyboardEvent) {
  if (!remapping.value) return
  e.preventDefault()
  e.stopPropagation()

  // Escape cancels
  if (e.key === 'Escape') {
    cancelRemap()
    return
  }

  // Build key string from event
  const parts: string[] = []
  const modKey = isMac ? e.metaKey : e.ctrlKey
  if (modKey) parts.push('cmd')
  if (e.shiftKey) parts.push('shift')
  if (e.altKey) parts.push('alt')

  // Ignore pure-modifier keypresses
  if (['Meta', 'Control', 'Shift', 'Alt'].includes(e.key)) return

  // Key part
  if (e.key === "'") {
    parts.push("'")
  } else if (e.key.length === 1) {
    parts.push(e.key.toLowerCase())
  } else {
    parts.push(e.key) // Escape, Delete, etc.
  }

  const key = parts.join('+')

  // Check for conflict
  const conflict = findConflict(remapping.value, key)
  if (conflict) {
    conflictId.value = conflict
    setTimeout(() => { conflictId.value = null }, 1500)
  }

  store.setKey(remapping.value, key)
  remapping.value = null
}

onMounted(() => window.addEventListener('keydown', onRemapKeydown, true))
onUnmounted(() => window.removeEventListener('keydown', onRemapKeydown, true))

// ─── Import / Export ─────────────────────────────────────────────────────────

const importError = ref<string | null>(null)

function handleExport() {
  const json = store.exportJson()
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'shortcuts.json'
  a.click()
  URL.revokeObjectURL(url)
}

function handleImport() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.json,application/json'
  input.onchange = async () => {
    const file = input.files?.[0]
    if (!file) return
    const text = await file.text()
    const err = store.importJson(text)
    importError.value = err
    if (err) setTimeout(() => { importError.value = null }, 3000)
  }
  input.click()
}

const hasAnyOverride = computed(() => Object.keys(store.overrides.value).length > 0)

// Static examples shown in the explainer callout
const spaceExamples = [
  {
    space: 'Design',
    icon: 'i-lucide-pen-tool',
    rows: [
      { key: 'R', action: 'Rectangle tool' },
      { key: 'E', action: 'Ellipse tool' },
      { key: 'T', action: 'Text tool' },
    ],
  },
  {
    space: 'Code',
    icon: 'i-lucide-code-2',
    rows: [
      { key: 'R', action: 'Hot reload' },
    ],
  },
  {
    space: 'Git',
    icon: 'i-lucide-git-branch',
    rows: [
      { key: 'R', action: 'Refresh status' },
      { key: 'S', action: 'Stage all' },
      { key: 'U', action: 'Unstage all' },
    ],
  },
]
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-4">
      <p class="text-xs text-[var(--app-muted)]">Click <span class="font-medium text-[var(--app-foreground)]">Remap</span> then press a key combination.</p>

      <!-- Actions -->
      <div class="flex items-center gap-2 shrink-0">
        <button
          v-if="hasAnyOverride"
          class="text-xs px-3 py-1.5 rounded border border-[var(--app-border)] text-[var(--app-muted)] hover:text-[var(--app-foreground)] hover:border-[var(--app-muted)] transition-colors"
          @click="store.resetAll()"
        >
          Reset all
        </button>
        <button
          class="text-xs px-3 py-1.5 rounded border border-[var(--app-border)] text-[var(--app-muted)] hover:text-[var(--app-foreground)] hover:border-[var(--app-muted)] transition-colors flex items-center gap-1.5"
          @click="handleImport"
        >
          <Icon name="i-lucide-upload" class="size-3" />
          Import
        </button>
        <button
          class="text-xs px-3 py-1.5 rounded border border-[var(--app-border)] text-[var(--app-muted)] hover:text-[var(--app-foreground)] hover:border-[var(--app-muted)] transition-colors flex items-center gap-1.5"
          @click="handleExport"
        >
          <Icon name="i-lucide-download" class="size-3" />
          shortcuts.json
        </button>
      </div>
    </div>

    <!-- Space-aware explainer -->
    <div class="mb-6 rounded-lg border border-[var(--app-border)] bg-[color-mix(in_srgb,var(--app-muted)_5%,transparent)] p-4">
      <div class="flex items-start gap-3">
        <Icon name="i-lucide-layers" class="size-4 text-app-accent mt-0.5 shrink-0" />
        <div class="space-y-2 min-w-0">
          <p class="text-sm font-medium text-[var(--app-foreground)]">Space-aware shortcuts</p>
          <p class="text-sm text-[var(--app-muted)] leading-relaxed">
            Shortcuts are scoped to the active space — only the current space's bindings are registered at any time.
            This means the <strong class="text-[var(--app-foreground)] font-medium">same key can do different things</strong> depending on which space you're in.
          </p>
          <!-- Example table -->
          <div class="mt-3 grid grid-cols-3 gap-2">
            <div
              v-for="example in spaceExamples"
              :key="example.space"
              class="rounded-md border border-[var(--app-border)] px-3 py-2 bg-[color-mix(in_srgb,var(--app-muted)_4%,transparent)]"
            >
              <div class="flex items-center gap-1.5 mb-1.5">
                <Icon :name="example.icon" class="size-3 text-app-accent" />
                <span class="text-[11px] font-semibold tracking-wide text-[var(--app-muted)] uppercase">{{ example.space }}</span>
              </div>
              <div v-for="row in example.rows" :key="row.key" class="flex items-center justify-between gap-2 py-0.5">
                <span class="text-xs text-[var(--app-muted)]">{{ row.action }}</span>
                <kbd class="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded text-[10px] font-mono font-medium border border-[var(--app-border)] bg-[color-mix(in_srgb,var(--app-muted)_10%,transparent)] text-[var(--app-foreground)] shrink-0">{{ row.key }}</kbd>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Import error -->
    <div v-if="importError" class="mb-4 px-3 py-2 rounded bg-red-500/10 border border-red-500/30 text-sm text-red-500">
      {{ importError }}
    </div>

    <!-- Remapping banner -->
    <div
      v-if="remapping"
      class="mb-4 px-4 py-3 rounded-lg bg-[color-mix(in_srgb,var(--app-accent)_12%,transparent)] border border-[var(--app-accent)]/40 flex items-center justify-between"
    >
      <div class="flex items-center gap-2">
        <Icon name="i-lucide-keyboard" class="size-4 text-app-accent" />
        <span class="text-sm text-[var(--app-foreground)]">
          Press any key combination — <span class="font-medium">Escape</span> to cancel
        </span>
      </div>
      <button class="text-xs text-[var(--app-muted)] hover:text-[var(--app-foreground)]" @click="cancelRemap">Cancel</button>
    </div>

    <!-- Space tabs -->
    <div class="flex gap-1 mb-6 border-b border-[var(--app-border)]">
      <button
        v-for="space in spaces"
        :key="space.id"
        class="flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors"
        :class="activeSpace === space.id
          ? 'border-[var(--app-accent)] text-app-accent'
          : 'border-transparent text-[var(--app-muted)] hover:text-[var(--app-foreground)]'"
        @click="activeSpace = space.id"
      >
        <Icon :name="space.icon" class="size-4" />
        {{ space.label }}
      </button>
    </div>

    <!-- Global shortcuts toggle -->
    <div v-if="activeSpace === 'global'" class="mb-6 space-y-3">
      <div class="rounded-lg border border-[var(--app-border)] p-4 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <Icon name="i-lucide-globe" class="size-4 text-app-accent shrink-0" />
          <div>
            <p class="text-sm font-medium text-[var(--app-foreground)]">System-wide global shortcuts</p>
            <p class="text-xs text-[var(--app-muted)] mt-0.5">These shortcuts work even when Construct is not focused.</p>
          </div>
        </div>
        <button
          class="relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none"
          :class="globalShortcuts.enabled.value ? 'bg-[var(--app-accent)]' : 'bg-[color-mix(in_srgb,var(--app-muted)_30%,transparent)]'"
          @click="globalShortcuts.setEnabled(!globalShortcuts.enabled.value)"
        >
          <span
            class="pointer-events-none inline-block size-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out"
            :class="globalShortcuts.enabled.value ? 'translate-x-4' : 'translate-x-0'"
          />
        </button>
      </div>

      <!-- Accessibility permission notice (macOS) -->
      <div
        v-if="globalShortcuts.enabled.value && globalShortcuts.accessibilityGranted.value === false"
        class="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 flex items-start gap-3"
      >
        <Icon name="i-lucide-shield-alert" class="size-4 text-amber-500 mt-0.5 shrink-0" />
        <div>
          <p class="text-sm font-medium text-amber-500">Accessibility permission required</p>
          <p class="text-xs text-[var(--app-muted)] mt-1 leading-relaxed">
            Global shortcuts need accessibility access on macOS. Open
            <strong class="text-[var(--app-foreground)]">System Settings → Privacy & Security → Accessibility</strong>
            and enable Construct. You may need to restart the app after granting access.
          </p>
        </div>
      </div>
    </div>

    <!-- Shortcut groups for active space -->
    <div class="space-y-8">
      <div
        v-for="(defs, group) in shortcutsForSpace(activeSpace)"
        :key="group"
      >
        <h3 class="text-xs font-semibold tracking-wider text-[var(--app-muted)] uppercase mb-3">
          {{ group }}
        </h3>

        <div class="rounded-lg border border-[var(--app-border)] divide-y divide-[var(--app-border)] overflow-hidden">
          <div
            v-for="def in defs"
            :key="def.id"
            class="flex items-center justify-between px-4 py-3 transition-colors"
            :class="{
              'bg-[color-mix(in_srgb,var(--app-accent)_8%,transparent)]': remapping === def.id,
              'bg-red-500/5': conflictId === def.id,
            }"
          >
            <!-- Label -->
            <div class="flex items-center gap-3">
              <span class="text-sm text-[var(--app-foreground)]">{{ def.label }}</span>
              <span
                v-if="store.hasOverride(def.id)"
                class="text-[10px] px-1.5 py-0.5 rounded bg-[color-mix(in_srgb,var(--app-accent)_15%,transparent)] text-app-accent font-medium"
              >
                custom
              </span>
              <span
                v-if="conflictId === def.id"
                class="text-[10px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-500 font-medium"
              >
                conflict
              </span>
            </div>

            <!-- Right side: key badge + actions -->
            <div class="flex items-center gap-3">
              <!-- Key badge(s) -->
              <div v-if="remapping !== def.id" class="flex items-center gap-1">
                <kbd
                  v-for="(part, i) in formatKey(store.getKey(def.id))"
                  :key="i"
                  class="inline-flex items-center justify-center min-w-[1.5rem] h-6 px-1.5 rounded text-[11px] font-mono font-medium border border-[var(--app-border)] bg-[color-mix(in_srgb,var(--app-muted)_8%,transparent)] text-[var(--app-foreground)]"
                >
                  {{ part }}
                </kbd>
              </div>
              <div v-else class="text-xs text-app-accent italic">listening…</div>

              <!-- Monaco badge — readonly shortcuts managed by the editor -->
              <span
                v-if="def.readonly"
                class="text-[10px] px-1.5 py-0.5 rounded border border-[var(--app-border)] text-[var(--app-muted)] font-medium"
                title="Managed by Monaco editor — configure via Monaco keybindings"
              >
                Monaco
              </span>

              <!-- Remap + reset — remappable shortcuts only -->
              <template v-else>
                <button
                  v-if="remapping !== def.id"
                  class="text-xs text-[var(--app-muted)] hover:text-[var(--app-foreground)] px-2 py-1 rounded hover:bg-[color-mix(in_srgb,var(--app-muted)_10%,transparent)] transition-colors"
                  @click="startRemap(def.id)"
                >
                  Remap
                </button>
                <button
                  v-if="store.hasOverride(def.id) && remapping !== def.id"
                  class="text-xs text-[var(--app-muted)] hover:text-red-500 px-2 py-1 rounded hover:bg-red-500/10 transition-colors"
                  :title="`Reset to default: ${def.defaultKey}`"
                  @click="store.resetKey(def.id)"
                >
                  <Icon name="i-lucide-rotate-ccw" class="size-3" />
                </button>
              </template>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
