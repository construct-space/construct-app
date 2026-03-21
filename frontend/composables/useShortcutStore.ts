import { ref, readonly } from 'vue'

// ─── Shortcut definition ──────────────────────────────────────────────────────

export type ShortcutSpace = 'design' | 'code' | 'git' | 'global'

export interface ShortcutDef {
  id: string            // e.g. 'design.rectangle'
  space: ShortcutSpace
  group: string         // e.g. 'Tools'
  label: string         // e.g. 'Rectangle tool'
  defaultKey: string    // e.g. 'r', 'cmd+z'
  /** When true the shortcut is managed externally (e.g. Monaco) and cannot be remapped here. */
  readonly?: boolean
}

// ─── Master registry ─────────────────────────────────────────────────────────
// Single source of truth for every remappable shortcut in the app.

export const SHORTCUT_REGISTRY: ShortcutDef[] = [
  // Design — Tools
  { id: 'design.select',    space: 'design', group: 'Tools',   label: 'Select tool',         defaultKey: 'v' },
  { id: 'design.rectangle', space: 'design', group: 'Tools',   label: 'Rectangle tool',      defaultKey: 'r' },
  { id: 'design.ellipse',   space: 'design', group: 'Tools',   label: 'Ellipse tool',        defaultKey: 'e' },
  { id: 'design.text',      space: 'design', group: 'Tools',   label: 'Text tool',           defaultKey: 't' },
  { id: 'design.hand',      space: 'design', group: 'Tools',   label: 'Hand (pan) tool',     defaultKey: 'h' },
  { id: 'design.frame',     space: 'design', group: 'Tools',   label: 'Frame tool',          defaultKey: 'f' },
  { id: 'design.pen',       space: 'design', group: 'Tools',   label: 'Pen tool',            defaultKey: 'p' },
  { id: 'design.line',      space: 'design', group: 'Tools',   label: 'Line tool',           defaultKey: 'l' },
  { id: 'design.comment',   space: 'design', group: 'Tools',   label: 'Toggle comment mode', defaultKey: 'c' },
  // Design — History
  { id: 'design.undo',      space: 'design', group: 'History', label: 'Undo',                defaultKey: 'cmd+z' },
  { id: 'design.redo',      space: 'design', group: 'History', label: 'Redo',                defaultKey: 'cmd+shift+z' },
  { id: 'design.redo2',     space: 'design', group: 'History', label: 'Redo (alternate)',     defaultKey: 'cmd+y' },
  // Design — View
  // Design — Arrange
  { id: 'design.bring-forward',  space: 'design', group: 'Arrange', label: 'Bring Forward',       defaultKey: 'cmd+]' },
  { id: 'design.send-backward',  space: 'design', group: 'Arrange', label: 'Send Backward',       defaultKey: 'cmd+[' },
  { id: 'design.bring-to-front', space: 'design', group: 'Arrange', label: 'Bring to Front',      defaultKey: 'cmd+shift+]' },
  { id: 'design.send-to-back',   space: 'design', group: 'Arrange', label: 'Send to Back',        defaultKey: 'cmd+shift+[' },
  { id: 'design.lock',           space: 'design', group: 'Arrange', label: 'Toggle lock',         defaultKey: 'cmd+shift+l' },
  { id: 'design.hide',           space: 'design', group: 'Arrange', label: 'Toggle visibility',   defaultKey: 'cmd+shift+h' },
  // Design — View
  { id: 'design.grid',      space: 'design', group: 'View',    label: 'Toggle grid',         defaultKey: "cmd+'" },
  { id: 'design.rulers',    space: 'design', group: 'View',    label: 'Toggle rulers',       defaultKey: 'cmd+shift+r' },
  { id: 'design.snap',      space: 'design', group: 'View',    label: 'Toggle snap',         defaultKey: 'cmd+shift+s' },
  // Design — File
  { id: 'design.export',    space: 'design', group: 'File',    label: 'Export',              defaultKey: 'cmd+e' },
  // Code — File
  { id: 'code.save',            space: 'code', group: 'File',   label: 'Save',                defaultKey: 'cmd+s' },
  // Code — Editor (Monaco built-ins — displayed only)
  { id: 'code.find',            space: 'code', group: 'Editor', label: 'Find',                defaultKey: 'cmd+f',       readonly: true },
  { id: 'code.goto-line',       space: 'code', group: 'Editor', label: 'Go to line',          defaultKey: 'cmd+g',       readonly: true },
  { id: 'code.command-palette', space: 'code', group: 'Editor', label: 'Command palette',     defaultKey: 'cmd+shift+p', readonly: true },
  // Code — AI
  { id: 'code.ai-edit',         space: 'code', group: 'AI',     label: 'AI edit selection',   defaultKey: 'cmd+k' },
  { id: 'code.ai-assistant',    space: 'code', group: 'AI',     label: 'AI assistant',        defaultKey: 'cmd+l' },
  // Code — View
  { id: 'code.toggle-terminal', space: 'code', group: 'View',   label: 'Toggle terminal',     defaultKey: 'cmd+`' },
  { id: 'code.toggle-sidebar',  space: 'code', group: 'View',   label: 'Toggle sidebar',      defaultKey: 'cmd+b' },
  { id: 'code.quick-open',      space: 'code', group: 'View',   label: 'Quick open file',     defaultKey: 'cmd+p' },
  // Code — Tabs
  { id: 'code.next-tab',        space: 'code', group: 'Tabs',   label: 'Next tab',            defaultKey: 'ctrl+tab' },
  { id: 'code.prev-tab',        space: 'code', group: 'Tabs',   label: 'Previous tab',        defaultKey: 'ctrl+shift+tab' },
  { id: 'code.close-tab',       space: 'code', group: 'Tabs',   label: 'Close tab',           defaultKey: 'cmd+w',       readonly: true },
  // Code — Run
  { id: 'code.hotreload',       space: 'code', group: 'Run',    label: 'Hot reload',          defaultKey: 'r' },
  // Git
  { id: 'git.stage-all',    space: 'git',    group: 'Git',     label: 'Stage all',           defaultKey: 's' },
  { id: 'git.unstage-all',  space: 'git',    group: 'Git',     label: 'Unstage all',         defaultKey: 'u' },
  { id: 'git.refresh',      space: 'git',    group: 'Git',     label: 'Refresh',             defaultKey: 'r' },
  // Global — system-wide shortcuts (registered via Tauri global-shortcut plugin)
  { id: 'global.toggle-app',       space: 'global', group: 'App',      label: 'Show / Hide Construct',   defaultKey: 'cmd+shift+space' },
  { id: 'global.quick-capture',    space: 'global', group: 'App',      label: 'Quick capture note',      defaultKey: 'cmd+shift+c' },
  { id: 'global.toggle-assistant', space: 'global', group: 'AI',       label: 'Open AI assistant',       defaultKey: 'cmd+shift+a' },
]

// ─── Persistence ──────────────────────────────────────────────────────────────

const STORAGE_KEY = 'construct_shortcuts'

// Module-level reactive overrides: id → custom key string
const _overrides = ref<Record<string, string>>({})

function _load() {
  if (typeof localStorage === 'undefined') return
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) _overrides.value = JSON.parse(raw)
  } catch {
    // Corrupt data — start fresh
    _overrides.value = {}
  }
}

function _save() {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(_overrides.value))
}

// Initialize once at module load
_load()

// ─── Public API ───────────────────────────────────────────────────────────────

/** Returns the effective key for a shortcut ID (override → default → null). */
export function getKey(id: string): string {
  return _overrides.value[id] ?? SHORTCUT_REGISTRY.find(s => s.id === id)?.defaultKey ?? ''
}

/** Returns true if the shortcut has been overridden from its default. */
export function hasOverride(id: string): boolean {
  return id in _overrides.value
}

/** Saves a custom key for a shortcut ID. */
export function setKey(id: string, key: string) {
  _overrides.value = { ..._overrides.value, [id]: key }
  _save()
  // Notify global shortcuts composable to re-register if a global shortcut changed
  if (id.startsWith('global.')) {
    window.dispatchEvent(new CustomEvent('construct:global-shortcuts-changed'))
  }
}

/** Resets a shortcut to its default. */
export function resetKey(id: string) {
  const { [id]: _removed, ...rest } = _overrides.value
  _overrides.value = rest
  _save()
  if (id.startsWith('global.')) {
    window.dispatchEvent(new CustomEvent('construct:global-shortcuts-changed'))
  }
}

/** Resets all shortcuts to defaults. */
export function resetAll() {
  _overrides.value = {}
  _save()
}

/** Serialises ALL shortcuts (defaults + overrides) as shortcuts.json.
 *  Importing this file back restores only the non-default entries as overrides. */
export function exportJson(): string {
  const result: Record<string, string> = {}
  for (const def of SHORTCUT_REGISTRY) {
    result[def.id] = getKey(def.id)
  }
  return JSON.stringify(result, null, 2)
}

/** Loads a shortcuts.json string. Entries that match their default are ignored
 *  (no unnecessary overrides); only genuine customisations are stored.
 *  Returns an error message or null on success. */
export function importJson(json: string): string | null {
  try {
    const parsed = JSON.parse(json)
    if (typeof parsed !== 'object' || Array.isArray(parsed)) return 'Invalid format'

    // Only keep entries that differ from the default
    const overrides: Record<string, string> = {}
    for (const [id, key] of Object.entries(parsed)) {
      if (typeof key !== 'string') continue
      const def = SHORTCUT_REGISTRY.find(s => s.id === id)
      if (!def) continue           // unknown id — skip
      if (key !== def.defaultKey) overrides[id] = key
    }

    _overrides.value = overrides
    _save()
    return null
  } catch {
    return 'Invalid JSON'
  }
}

// ─── Composable wrapper ───────────────────────────────────────────────────────

export function useShortcutStore() {
  return {
    registry: SHORTCUT_REGISTRY,
    overrides: readonly(_overrides),
    getKey,
    hasOverride,
    setKey,
    resetKey,
    resetAll,
    exportJson,
    importJson,
  }
}
