/**
 * useMenuModel — the menu tree for the custom Windows/Linux menu bar.
 *
 * Mirrors the native menu (desktop/src/menu.rs) but reorganised for Windows
 * convention: there's no app-name menu, Exit lives in File, and About / Check
 * for Updates live in Help. Most items carry the SAME id as the native menu so
 * `trigger_menu_action` runs the identical handler; edit/window/quit items are
 * handled directly in the webview.
 *
 * macOS keeps its native top-of-screen menu bar — this model is only consumed
 * by MenuBar.vue, which renders nothing off Windows/Linux.
 */
import { computed, ref, watch, onMounted } from 'vue'
import { useRoute } from 'vue-router'

export type LeafKind = 'rust' | 'edit' | 'window' | 'separator'
export type EditCmd = 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll'
export type WindowCmd = 'minimize' | 'toggleMaximize' | 'toggleFullscreen' | 'quit'

export interface MenuLeaf {
  kind: LeafKind
  label?: string
  /** Single character in `label` to underline as the access key. */
  mnemonic?: string
  /** Display-only shortcut hint, e.g. "Ctrl+N". */
  accelerator?: string
  /** Native menu id — used when kind === 'rust'. */
  id?: string
  editCmd?: EditCmd
  windowCmd?: WindowCmd
}

export interface MenuTop {
  label: string
  mnemonic: string
  items: MenuLeaf[]
}

const sep: MenuLeaf = { kind: 'separator' }

/** Map a route path to a space id — mirrors useAppMenu.activeSpace. */
function spaceFromPath(path: string): string {
  if (path.includes('/editor')) return 'editor'
  if (path.includes('/builder')) return 'builder'
  if (path.includes('/space-developer')) return 'space-developer'
  if (path.includes('/ask')) return 'ask'
  if (path.includes('/code')) return 'code'
  if (path.includes('/ui')) return 'ui'
  if (path.includes('/kanban')) return 'kanban'
  const dynamic = path.match(/\/app\/spaces\/([^/]+)/)
  if (dynamic) return dynamic[1]
  return 'default'
}

/** Hardcoded space submenus for the legacy built-in spaces (match menu.rs). */
const LEGACY_SPACE_MENUS: Record<string, MenuTop> = {
  code: {
    label: 'Code', mnemonic: 'C', items: [
      { kind: 'rust', id: 'go_to_file', label: 'Go to File…', mnemonic: 'G', accelerator: 'Ctrl+P' },
      { kind: 'rust', id: 'go_to_symbol', label: 'Go to Symbol…', mnemonic: 'S', accelerator: 'Ctrl+Shift+O' },
      sep,
      { kind: 'rust', id: 'find_in_files', label: 'Find in Files…', mnemonic: 'F', accelerator: 'Ctrl+Shift+F' },
      { kind: 'rust', id: 'replace_in_files', label: 'Replace in Files…', mnemonic: 'R', accelerator: 'Ctrl+Shift+H' },
      sep,
      { kind: 'rust', id: 'format_document', label: 'Format Document', mnemonic: 'o', accelerator: 'Ctrl+Shift+I' },
    ],
  },
  ui: {
    label: 'Design', mnemonic: 'D', items: [
      { kind: 'rust', id: 'add_frame', label: 'Add Frame', mnemonic: 'F', accelerator: 'F' },
      { kind: 'rust', id: 'add_text', label: 'Add Text', mnemonic: 'T', accelerator: 'T' },
      { kind: 'rust', id: 'add_rectangle', label: 'Add Rectangle', mnemonic: 'R', accelerator: 'R' },
      sep,
      { kind: 'rust', id: 'align_left', label: 'Align Left', mnemonic: 'L' },
      { kind: 'rust', id: 'align_center', label: 'Align Center', mnemonic: 'C' },
      { kind: 'rust', id: 'align_right', label: 'Align Right', mnemonic: 'i' },
      sep,
      { kind: 'rust', id: 'export_selection', label: 'Export Selection…', mnemonic: 'E', accelerator: 'Ctrl+Shift+E' },
    ],
  },
  kanban: {
    label: 'Board', mnemonic: 'B', items: [
      { kind: 'rust', id: 'new_column', label: 'New Column', mnemonic: 'C' },
      { kind: 'rust', id: 'new_card', label: 'New Card', mnemonic: 'N', accelerator: 'Ctrl+Enter' },
      sep,
      { kind: 'rust', id: 'filter_cards', label: 'Filter Cards…', mnemonic: 'F', accelerator: 'Ctrl+F' },
    ],
  },
}

/** Read a dynamic space's submenu from its manifest (best-effort). */
async function loadManifestSpaceMenu(space: string): Promise<MenuTop | null> {
  const builtin: Record<string, () => Promise<Record<string, unknown>>> = {
    builder: () => import('@/spaces/builder/manifest.json').then(m => m.default as Record<string, unknown>),
    'space-developer': () => import('@/spaces/space-developer/manifest.json').then(m => m.default as Record<string, unknown>),
    ask: () => import('~/spaces/ask/manifest.json').then(m => m.default as Record<string, unknown>),
    project: () => import('@/spaces/project/manifest.json').then(m => m.default as Record<string, unknown>),
  }

  type RawMenu = { label?: string; items?: Array<{ id: string; label: string; accelerator?: string; separator?: boolean }> }
  const toTop = (raw: RawMenu): MenuTop | null => {
    if (!raw?.label || !Array.isArray(raw.items)) return null
    return {
      label: raw.label,
      mnemonic: raw.label.charAt(0),
      items: raw.items.map(it => it.separator
        ? sep
        : { kind: 'rust' as const, id: it.id, label: it.label, accelerator: it.accelerator }),
    }
  }

  try {
    const loader = builtin[space]
    if (loader) {
      const manifest = await loader()
      if (manifest.menu && typeof manifest.menu === 'object') return toTop(manifest.menu as RawMenu)
    }
    // Dynamic spaces installed on disk
    const { readTextFile } = await import('@tauri-apps/plugin-fs')
    const { homeDir } = await import('@tauri-apps/api/path')
    const { getSpaceDirPath } = await import('@/lib/appPaths')
    const home = await homeDir()
    const raw = JSON.parse(await readTextFile(`${getSpaceDirPath(home, space)}/manifest.json`))
    if (raw.menu) return toTop(raw.menu)
  } catch { /* no manifest menu */ }
  return null
}

export function useMenuModel() {
  const route = useRoute()
  const isDev = import.meta.env.DEV
  const spaceMenu = ref<MenuTop | null>(null)

  const activeSpace = computed(() => spaceFromPath(route.path))

  async function refreshSpaceMenu(space: string) {
    if (LEGACY_SPACE_MENUS[space]) { spaceMenu.value = LEGACY_SPACE_MENUS[space]; return }
    if (space === 'default') { spaceMenu.value = null; return }
    spaceMenu.value = await loadManifestSpaceMenu(space)
  }

  onMounted(() => {
    refreshSpaceMenu(activeSpace.value)
    watch(activeSpace, refreshSpaceMenu)
  })

  const menus = computed<MenuTop[]>(() => {
    const file: MenuTop = {
      label: 'File', mnemonic: 'F', items: [
        { kind: 'rust', id: 'new_construct_window', label: 'New Window', mnemonic: 'N', accelerator: 'Ctrl+N' },
        { kind: 'rust', id: 'new_browser_window', label: 'New Browser Window', mnemonic: 'B' },
        sep,
        { kind: 'rust', id: 'new_project', label: 'New Project', mnemonic: 'P', accelerator: 'Ctrl+Shift+N' },
        { kind: 'rust', id: 'open_project', label: 'Open Project…', mnemonic: 'O', accelerator: 'Ctrl+O' },
        sep,
        { kind: 'rust', id: 'save', label: 'Save', mnemonic: 'S', accelerator: 'Ctrl+S' },
        { kind: 'rust', id: 'save_as', label: 'Save As…', mnemonic: 'A', accelerator: 'Ctrl+Shift+S' },
        sep,
        { kind: 'rust', id: 'settings', label: 'Settings…', mnemonic: 't', accelerator: 'Ctrl+,' },
        sep,
        { kind: 'window', windowCmd: 'quit', label: 'Exit', mnemonic: 'x', accelerator: 'Alt+F4' },
      ],
    }

    const edit: MenuTop = {
      label: 'Edit', mnemonic: 'E', items: [
        { kind: 'edit', editCmd: 'undo', label: 'Undo', mnemonic: 'U', accelerator: 'Ctrl+Z' },
        { kind: 'edit', editCmd: 'redo', label: 'Redo', mnemonic: 'R', accelerator: 'Ctrl+Y' },
        sep,
        { kind: 'edit', editCmd: 'cut', label: 'Cut', mnemonic: 't', accelerator: 'Ctrl+X' },
        { kind: 'edit', editCmd: 'copy', label: 'Copy', mnemonic: 'C', accelerator: 'Ctrl+C' },
        { kind: 'edit', editCmd: 'paste', label: 'Paste', mnemonic: 'P', accelerator: 'Ctrl+V' },
        { kind: 'edit', editCmd: 'selectAll', label: 'Select All', mnemonic: 'A', accelerator: 'Ctrl+A' },
      ],
    }

    const viewItems: MenuLeaf[] = [
      { kind: 'rust', id: 'toggle_sidebar', label: 'Toggle Sidebar', mnemonic: 'S', accelerator: 'Ctrl+B' },
      { kind: 'rust', id: 'toggle_assistant', label: 'Toggle Assistant', mnemonic: 'A', accelerator: 'Ctrl+\\' },
      sep,
      { kind: 'window', windowCmd: 'toggleFullscreen', label: 'Toggle Full Screen', mnemonic: 'F', accelerator: 'F11' },
    ]
    if (isDev) {
      viewItems.push(sep, { kind: 'rust', id: 'dev_tools', label: 'Developer Tools', mnemonic: 'D', accelerator: 'Ctrl+Alt+I' })
    }
    const view: MenuTop = { label: 'View', mnemonic: 'V', items: viewItems }

    const windowMenu: MenuTop = {
      label: 'Window', mnemonic: 'W', items: [
        { kind: 'window', windowCmd: 'minimize', label: 'Minimize', mnemonic: 'M' },
        { kind: 'window', windowCmd: 'toggleMaximize', label: 'Maximize / Restore', mnemonic: 'x' },
        sep,
        { kind: 'rust', id: 'projects', label: 'Projects', mnemonic: 'P', accelerator: 'Ctrl+1' },
      ],
    }

    const help: MenuTop = {
      label: 'Help', mnemonic: 'H', items: [
        { kind: 'rust', id: 'documentation', label: 'Documentation', mnemonic: 'D' },
        { kind: 'rust', id: 'keyboard_shortcuts', label: 'Keyboard Shortcuts', mnemonic: 'K', accelerator: 'Ctrl+Shift+/' },
        sep,
        { kind: 'rust', id: 'report_issue', label: 'Report Issue…', mnemonic: 'R' },
        { kind: 'rust', id: 'check_updates', label: 'Check for Updates…', mnemonic: 'U' },
      ],
    }

    const tops = [file, edit, view]
    if (spaceMenu.value) tops.push(spaceMenu.value)
    tops.push(windowMenu, help)
    return tops
  })

  return { menus }
}
