<script setup lang="ts">
/**
 * TUIPage — Tabbed TUI workspace. Each tab runs its own PTY session with
 * a chosen preset (Claude Code, Codex, Shell, etc.). Tabs stay alive when
 * backgrounded — switch back and the session is exactly where you left it.
 */
import { ref, reactive, watch, onMounted, onBeforeUnmount, nextTick, computed } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { SearchAddon } from '@xterm/addon-search'
import '@xterm/xterm/css/xterm.css'
import { useProjectStore } from '@/stores/project'
import { useToolbar } from '@/composables/useToolbar'
import { TerminalSquare, RotateCw, Square, Play, Plus, X, Download, Loader2, Trash2 } from 'lucide-vue-next'
import ToolbarSlot from '@/components/common/ToolbarSlot.vue'

// ── Presets ──────────────────────────────────────────────────────────

interface TUIPreset {
  id: string
  label: string
  binary: string
  args: string[]
  description: string
}

const BUILTIN_PRESETS: TUIPreset[] = [
  { id: 'claude', label: 'Claude Code', binary: 'claude', args: [], description: 'Anthropic CLI' },
  { id: 'codex', label: 'Codex', binary: 'codex', args: [], description: 'OpenAI CLI' },
  { id: 'opencode', label: 'OpenCode', binary: 'opencode', args: [], description: 'Open-source coding agent' },
  { id: 'pi', label: 'Pi', binary: 'pi', args: [], description: 'Pi coding agent' },
  { id: 'aider', label: 'Aider', binary: 'aider', args: [], description: 'AI pair programming' },
  { id: 'lazygit', label: 'Lazygit', binary: 'lazygit', args: [], description: 'Git TUI' },
  { id: 'shell', label: 'Shell', binary: '/bin/zsh', args: [], description: 'Interactive shell' },
]

// ── Custom presets (persisted to localStorage) ──────────────────────

const CUSTOM_STORAGE_KEY = 'construct:tui-custom-presets'

function loadCustomPresets(): TUIPreset[] {
  try {
    const raw = localStorage.getItem(CUSTOM_STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

function saveCustomPresets(presets: TUIPreset[]) {
  localStorage.setItem(CUSTOM_STORAGE_KEY, JSON.stringify(presets))
}

const customPresets = reactive<TUIPreset[]>(loadCustomPresets())

const PRESETS = computed<TUIPreset[]>(() => [...BUILTIN_PRESETS, ...customPresets])

function addCustomPreset(preset: TUIPreset) {
  customPresets.push(preset)
  saveCustomPresets(customPresets)
}

function removeCustomPreset(id: string) {
  const idx = customPresets.findIndex(p => p.id === id)
  if (idx >= 0) {
    customPresets.splice(idx, 1)
    saveCustomPresets(customPresets)
  }
}

// ── Add custom modal ────────────────────────────────────────────────

const showAddModal = ref(false)
const addForm = reactive({ npmPackage: '', binary: '', label: '' })
const addInstalling = ref(false)
const addError = ref('')

function openAddModal() {
  showPresetMenu.value = false
  addForm.npmPackage = ''
  addForm.binary = ''
  addForm.label = ''
  addError.value = ''
  showAddModal.value = true
}

function guessFromPackage() {
  const pkg = addForm.npmPackage.trim()
  if (!pkg) return
  // Guess binary name from package: @scope/name → name, plain-name → plain-name
  const name = pkg.includes('/') ? pkg.split('/').pop()! : pkg
  if (!addForm.binary) addForm.binary = name
  if (!addForm.label) addForm.label = name.charAt(0).toUpperCase() + name.slice(1)
}

async function submitAddCustom() {
  const pkg = addForm.npmPackage.trim()
  const binary = addForm.binary.trim()
  const label = addForm.label.trim()

  if (!pkg && !binary) {
    addError.value = 'Enter a package name or binary'
    return
  }

  addError.value = ''
  addInstalling.value = true

  try {
    // Install globally via bun if package specified
    if (pkg) {
      const result = await invoke<{ success: boolean; stderr: string }>('run_shell_command', {
        command: 'bun',
        args: ['install', '-g', pkg],
        cwd: '/',
      })
      if (!result.success) {
        addError.value = `Install failed: ${result.stderr?.slice(0, 200) || 'unknown error'}`
        return
      }
    }

    const id = `custom-${binary || pkg}-${Date.now()}`
    const preset: TUIPreset = {
      id,
      label: label || binary || pkg,
      binary: binary || pkg,
      args: [],
      description: pkg ? `bun install -g ${pkg}` : 'Custom CLI',
    }

    addCustomPreset(preset)
    showAddModal.value = false

    // Auto-launch in new tab
    await createSession(preset)
  } catch (e) {
    addError.value = String(e)
  } finally {
    addInstalling.value = false
  }
}

// ── Session state ────────────────────────────────────────────────────

interface TUISession {
  id: string
  preset: TUIPreset
  ptyId: string
  isReady: boolean
  isExited: boolean
  terminal: Terminal | null
  fitAddon: FitAddon | null
  unlistenOutput: UnlistenFn | null
  unlistenExit: UnlistenFn | null
  resizeObserver: ResizeObserver | null
}

const sessions = reactive<TUISession[]>([])
const activeId = ref<string | null>(null)
let counter = 0

const activeSession = computed(() => sessions.find(s => s.id === activeId.value) || null)

const projectStore = useProjectStore()
const { setBreadcrumbs } = useToolbar()
const projectPath = computed(() =>
  projectStore.currentProject?.local_path || projectStore.currentProject?.path || '',
)

// Preset picker
const showPresetMenu = ref(false)
const menuAnchor = ref({ top: 0, right: 0 })

function getAppColor(prop: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(prop).trim() || fallback
}

// ── Session lifecycle ────────────────────────────────────────────────

function genId() { return `tui-${++counter}-${Date.now()}` }

async function createSession(preset: TUIPreset) {
  const session: TUISession = reactive({
    id: genId(),
    preset,
    ptyId: `tui-pty-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    isReady: false,
    isExited: false,
    terminal: null,
    fitAddon: null,
    unlistenOutput: null,
    unlistenExit: null,
    resizeObserver: null,
  })
  sessions.push(session)
  activeId.value = session.id

  // Wait for DOM to render the container
  await nextTick()
  await nextTick()
  await spawnTerminal(session)
}

async function spawnTerminal(session: TUISession) {
  const el = document.getElementById(`tui-term-${session.id}`)
  if (!el || !projectPath.value) return

  const bg = getAppColor('--app-background', '#0a0a0f')

  session.terminal = new Terminal({
    fontSize: 14,
    fontFamily: "'SF Mono', 'Fira Code', 'JetBrains Mono', Menlo, monospace",
    lineHeight: 1.35,
    letterSpacing: 0.3,
    cursorBlink: true,
    cursorStyle: 'bar',
    cursorWidth: 2,
    allowProposedApi: true,
    scrollback: 10000,
    theme: {
      background: bg,
      foreground: getAppColor('--app-foreground', '#d4d4d8'),
      cursor: getAppColor('--app-accent', '#a1a1aa'),
      selectionBackground: getAppColor('--app-accent', '#6366f1') + '33',
      black: '#18181b', red: '#f87171', green: '#4ade80', yellow: '#facc15',
      blue: '#60a5fa', magenta: '#c084fc', cyan: '#22d3ee', white: '#d4d4d8',
      brightBlack: '#52525b', brightRed: '#fca5a5', brightGreen: '#86efac', brightYellow: '#fde68a',
      brightBlue: '#93c5fd', brightMagenta: '#d8b4fe', brightCyan: '#67e8f9', brightWhite: '#fafafa',
    },
  })

  session.fitAddon = new FitAddon()
  session.terminal.loadAddon(session.fitAddon)
  session.terminal.loadAddon(new WebLinksAddon())
  session.terminal.loadAddon(new SearchAddon())
  session.terminal.open(el)

  await nextTick()
  session.fitAddon.fit()

  const dims = session.fitAddon.proposeDimensions()
  const cols = dims?.cols || 120
  const rows = dims?.rows || 30

  session.unlistenOutput = await listen<{ session_id: string; data: string }>('pty-output', (e) => {
    if (e.payload.session_id === session.ptyId && session.terminal) {
      session.terminal.write(e.payload.data)
    }
  })

  session.unlistenExit = await listen<{ session_id: string; code: number }>('pty-exit', (e) => {
    if (e.payload.session_id === session.ptyId) {
      session.isExited = true
      session.terminal?.write('\r\n\x1b[2m[exited]\x1b[0m\r\n')
    }
  })

  session.terminal.onData((data) => {
    if (!session.isExited) invoke('pty_write', { sessionId: session.ptyId, data }).catch(() => {})
  })

  const shell = session.preset.id === 'shell' ? session.preset.binary : '/bin/zsh'
  const shellArgs = session.preset.id === 'shell'
    ? ['-l']
    : ['-lc', [session.preset.binary, ...session.preset.args].join(' ')]

  try {
    await invoke('pty_spawn', { sessionId: session.ptyId, shell, args: shellArgs, cwd: projectPath.value, cols, rows })
    session.isReady = true
  } catch {
    session.terminal.write(`\x1b[31m${session.preset.label} not found\x1b[0m\r\n`)
    session.terminal.write(`\x1b[2mInstall: check that \x1b[0m${session.preset.binary}\x1b[2m is on your PATH\x1b[0m\r\n`)
    session.isExited = true
  }

  session.resizeObserver = new ResizeObserver(() => {
    if (!session.fitAddon || !session.terminal || !session.isReady || session.isExited) return
    session.fitAddon.fit()
    const d = session.fitAddon.proposeDimensions()
    if (d?.cols && d?.rows) invoke('pty_resize', { sessionId: session.ptyId, cols: d.cols, rows: d.rows }).catch(() => {})
  })
  session.resizeObserver.observe(el)
}

async function destroySession(session: TUISession) {
  session.resizeObserver?.disconnect()
  session.unlistenOutput?.()
  session.unlistenExit?.()
  if (session.ptyId && !session.isExited) {
    try { await invoke('pty_kill', { sessionId: session.ptyId }) } catch { /* dead */ }
  }
  // xterm throws if an addon was registered but its underlying state was
  // already torn down (e.g. when the container element was unmounted first).
  // Swallow — the terminal instance is being discarded anyway.
  try { session.terminal?.dispose() } catch { /* already disposed */ }
  session.terminal = null
  session.fitAddon = null
}

async function closeSession(id: string) {
  const idx = sessions.findIndex(s => s.id === id)
  if (idx < 0) return
  await destroySession(sessions[idx])
  sessions.splice(idx, 1)
  if (activeId.value === id) {
    activeId.value = sessions[idx]?.id || sessions[idx - 1]?.id || null
    await nextTick()
    refitActive()
  }
}

async function restartSession() {
  const s = activeSession.value
  if (!s) return
  await destroySession(s)
  s.isReady = false
  s.isExited = false
  s.ptyId = `tui-pty-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  await nextTick()
  await spawnTerminal(s)
}

async function stopSession() {
  const s = activeSession.value
  if (!s || s.isExited) return
  try { await invoke('pty_kill', { sessionId: s.ptyId }) } catch { /* ignore */ }
}

function switchTab(id: string) {
  activeId.value = id
  nextTick(() => refitActive())
}

function refitActive() {
  const s = activeSession.value
  if (s?.fitAddon && s?.terminal) {
    s.fitAddon.fit()
  }
}

// ── Preset picker ────────────────────────────────────────────────────

function togglePresetMenu(e: Event) {
  e.stopPropagation()
  if (!showPresetMenu.value) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    menuAnchor.value = { top: rect.bottom + 4, right: window.innerWidth - rect.right }
  }
  showPresetMenu.value = !showPresetMenu.value
}
function pickPreset(p: TUIPreset) { showPresetMenu.value = false; createSession(p) }
function closeMenu() { showPresetMenu.value = false }

// ── Breadcrumbs ──────────────────────────────────────────────────────

const route = useRoute()
const isProjectRoute = computed(() => /^\/app\/projects\//.test(route.path))

watch(() => projectStore.currentProject?.name, (name) => {
  if (isProjectRoute.value || !name) setBreadcrumbs([])
  else setBreadcrumbs([
    { label: 'PROJECTS', to: '/app/projects' },
    { label: name.toUpperCase(), to: `/app/projects/${projectStore.currentProject?.id}` },
    { label: 'TUI' },
  ])
}, { immediate: true })

// ── Lifecycle ────────────────────────────────────────────────────────

onMounted(async () => {
  window.addEventListener('click', closeMenu)
  await nextTick()
  if (projectPath.value && sessions.length === 0) {
    createSession(PRESETS.value[0])
  }
})

onBeforeUnmount(async () => {
  window.removeEventListener('click', closeMenu)
  for (const s of sessions) await destroySession(s)
  sessions.length = 0
})
</script>

<template>
  <div class="h-full flex flex-col bg-[var(--app-background)] overflow-hidden">
<!-- Tab bar -->
    <div class="flex items-center border-b border-[var(--app-border)] bg-[var(--app-background)] shrink-0 min-h-[32px]">
      <div
        v-for="s in sessions" :key="s.id"
        role="tab"
        tabindex="0"
        :aria-selected="s.id === activeId"
        class="group flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium border-r border-[var(--app-border)] transition max-w-[180px] cursor-pointer select-none focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--app-accent)]"
        :class="s.id === activeId
          ? 'text-[var(--app-foreground)] bg-[var(--app-background)]'
          : 'text-[var(--app-muted)] hover:text-[var(--app-foreground)] bg-[color-mix(in_srgb,var(--app-background)_90%,black)]'"
        @click="switchTab(s.id)"
        @keydown.enter.prevent="switchTab(s.id)"
        @keydown.space.prevent="switchTab(s.id)"
      >
        <TerminalSquare class="size-3 shrink-0 opacity-60" />
        <span class="truncate">{{ s.preset.label }}</span>
        <span v-if="s.isExited" class="size-1.5 rounded-full bg-red-400 shrink-0" title="exited" />
        <button
          type="button"
          class="ml-auto p-0.5 rounded opacity-0 group-hover:opacity-60 hover:!opacity-100 hover:bg-[var(--app-muted)]/10 transition shrink-0"
          title="Close tab"
          @click.stop="closeSession(s.id)"
        >
          <X class="size-2.5" />
        </button>
      </div>

      <div class="flex-1" />
    </div>

    <!-- Terminal containers (all mounted, v-show for active) -->
    <div class="flex-1 min-h-0 relative">
      <div
        v-for="s in sessions" :key="s.id"
        :id="`tui-term-${s.id}`"
        class="absolute inset-0"
        :style="{ visibility: s.id === activeId ? 'visible' : 'hidden', zIndex: s.id === activeId ? 1 : 0 }"
      />

      <!-- No project fallback -->
      <div v-if="!projectPath" class="absolute inset-0 flex flex-col items-center justify-center text-[var(--app-muted)]">
        <TerminalSquare class="size-12 opacity-20 mb-3" />
        <p class="text-sm">Open a project to start</p>
      </div>
    </div>

    <!-- Toolbar controls -->
    <ToolbarSlot v-if="projectPath" name="right">
      <div class="flex items-center gap-1">
        <!-- New tab (opens preset picker) -->
        <button class="rounded-md p-1 text-[var(--app-muted)] hover:text-[var(--app-accent)] transition" title="New tab" @click="togglePresetMenu">
          <Plus class="size-3.5" />
        </button>

        <button v-if="activeSession?.isReady && !activeSession?.isExited" class="rounded-md p-1 text-[var(--app-muted)] hover:text-[var(--app-foreground)] transition" title="Restart" @click="restartSession">
          <RotateCw class="size-3" />
        </button>
        <button v-if="activeSession?.isReady && !activeSession?.isExited" class="rounded-md p-1 text-red-400/70 hover:text-red-400 transition" title="Stop" @click="stopSession">
          <Square class="size-3 fill-current" />
        </button>
        <button v-if="activeSession?.isExited" class="flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-medium text-[var(--app-accent)] hover:bg-[var(--app-accent)]/10 transition" @click="restartSession">
          <Play class="size-3 fill-current" />
          Relaunch
        </button>
      </div>
    </ToolbarSlot>

    <!-- Preset picker menu -->
    <Teleport to="body">
      <div
        v-if="showPresetMenu"
        class="fixed min-w-[220px] max-h-[400px] overflow-y-auto rounded-lg border border-[var(--app-border)] bg-[var(--app-background)] shadow-2xl py-1 z-[99999]"
        :style="{ top: menuAnchor.top + 'px', right: menuAnchor.right + 'px' }"
        @click.stop
      >
        <!-- Built-in presets -->
        <button
          v-for="p in BUILTIN_PRESETS" :key="p.id"
          class="w-full text-left px-3 py-2 flex items-center gap-3 text-[var(--app-foreground)] hover:bg-[var(--app-accent)]/5 transition"
          @click="pickPreset(p)"
        >
          <TerminalSquare class="size-3.5 shrink-0 opacity-50" />
          <div class="min-w-0">
            <div class="text-xs font-medium">{{ p.label }}</div>
            <div class="text-[10px] text-[var(--app-muted)] leading-tight">{{ p.description }}</div>
          </div>
        </button>

        <!-- Custom presets -->
        <template v-if="customPresets.length > 0">
          <div class="border-t border-[var(--app-border)] my-1" />
          <div class="px-3 py-1 text-[9px] font-medium text-[var(--app-muted)] uppercase tracking-wider">Custom</div>
          <div
            v-for="p in customPresets" :key="p.id"
            class="group w-full text-left px-3 py-2 flex items-center gap-3 text-[var(--app-foreground)] hover:bg-[var(--app-accent)]/5 transition cursor-pointer"
            @click="pickPreset(p)"
          >
            <TerminalSquare class="size-3.5 shrink-0 opacity-50" />
            <div class="min-w-0 flex-1">
              <div class="text-xs font-medium">{{ p.label }}</div>
              <div class="text-[10px] text-[var(--app-muted)] leading-tight">{{ p.description }}</div>
            </div>
            <button
              class="p-0.5 rounded opacity-0 group-hover:opacity-60 hover:!opacity-100 hover:text-red-400 transition shrink-0"
              title="Remove"
              @click.stop="removeCustomPreset(p.id)"
            >
              <Trash2 class="size-3" />
            </button>
          </div>
        </template>

        <!-- Add custom -->
        <div class="border-t border-[var(--app-border)] my-1" />
        <button
          class="w-full text-left px-3 py-2 flex items-center gap-3 text-[var(--app-accent)] hover:bg-[var(--app-accent)]/5 transition"
          @click="openAddModal"
        >
          <Plus class="size-3.5 shrink-0" />
          <span class="text-xs font-medium">Add custom TUI...</span>
        </button>
      </div>
    </Teleport>

    <!-- Add custom modal -->
    <Teleport to="body">
      <div
        v-if="showAddModal"
        class="fixed inset-0 z-[99999] flex items-center justify-center bg-black/50"
        @click.self="showAddModal = false"
      >
        <div class="w-[420px] rounded-xl border border-[var(--app-border)] bg-[var(--app-background)] p-5 shadow-2xl">
          <h3 class="text-sm font-semibold text-[var(--app-foreground)] mb-1">Add custom TUI</h3>
          <p class="text-xs text-[var(--app-muted)] mb-4">Install an npm package globally and launch it as a TUI tab.</p>

          <div class="space-y-3">
            <div>
              <label class="text-[10px] text-[var(--app-muted)] uppercase tracking-wider block mb-1">npm package</label>
              <input
                v-model="addForm.npmPackage"
                type="text"
                placeholder="e.g. @anthropic-ai/claude-code"
                class="w-full rounded-md border border-[var(--app-border)] bg-[var(--app-background)] px-3 py-2 text-sm text-[var(--app-foreground)] placeholder:text-[var(--app-muted)]/40 focus:border-[var(--app-accent)] outline-none"
                @blur="guessFromPackage"
              />
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="text-[10px] text-[var(--app-muted)] uppercase tracking-wider block mb-1">Binary name</label>
                <input
                  v-model="addForm.binary"
                  type="text"
                  placeholder="e.g. claude"
                  class="w-full rounded-md border border-[var(--app-border)] bg-[var(--app-background)] px-3 py-2 text-sm text-[var(--app-foreground)] placeholder:text-[var(--app-muted)]/40 focus:border-[var(--app-accent)] outline-none"
                />
              </div>
              <div>
                <label class="text-[10px] text-[var(--app-muted)] uppercase tracking-wider block mb-1">Label</label>
                <input
                  v-model="addForm.label"
                  type="text"
                  placeholder="e.g. Claude Code"
                  class="w-full rounded-md border border-[var(--app-border)] bg-[var(--app-background)] px-3 py-2 text-sm text-[var(--app-foreground)] placeholder:text-[var(--app-muted)]/40 focus:border-[var(--app-accent)] outline-none"
                />
              </div>
            </div>

            <div v-if="addError" class="text-xs text-red-400 bg-red-500/5 border border-red-500/20 rounded-md px-3 py-2">
              {{ addError }}
            </div>
          </div>

          <div class="flex items-center justify-end gap-2 mt-5">
            <button
              class="rounded-md px-3 py-1.5 text-xs text-[var(--app-muted)] hover:text-[var(--app-foreground)] transition"
              :disabled="addInstalling"
              @click="showAddModal = false"
            >
              Cancel
            </button>
            <button
              class="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-white bg-[var(--app-accent)] hover:opacity-90 disabled:opacity-50 transition"
              :disabled="addInstalling || (!addForm.npmPackage.trim() && !addForm.binary.trim())"
              @click="submitAddCustom"
            >
              <Loader2 v-if="addInstalling" class="size-3 animate-spin" />
              <Download v-else class="size-3" />
              {{ addInstalling ? 'Installing...' : 'Install & Launch' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
:deep(.xterm) {
  padding: 8px 12px;
}
:deep(.xterm-viewport) {
  overflow-y: auto !important;
}
:deep(.xterm-screen) {
  padding-right: 4px;
}
</style>
