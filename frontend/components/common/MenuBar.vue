<script setup lang="ts">
/**
 * MenuBar — custom application menu bar for the frameless Windows & Linux
 * window. Hidden by default; revealed by tapping Alt (standard Windows
 * behaviour), then dismissed by Alt again, Escape, or clicking away. macOS
 * keeps its native top-of-screen menu bar, so this renders nothing there.
 *
 * Items run the same actions as the native menu: 'rust' items invoke
 * `trigger_menu_action` (shared handler in lib.rs); edit/window/quit items are
 * handled directly in the webview. See useMenuModel for the tree.
 */
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { usePlatform } from '@/composables/usePlatform'
import { useMenuModel, type MenuLeaf } from '@/composables/useMenuModel'

const { usesCustomChrome } = usePlatform()
const enabled = usesCustomChrome()
const { menus } = useMenuModel()

// Bar revealed (mnemonics shown, keyboard-focused). curTop is the highlighted
// top-level menu; dropdownOpen toggles its panel; curItem indexes the items.
const active = ref(false)
const curTop = ref(0)
const dropdownOpen = ref(false)
const curItem = ref(-1)

const rootEl = ref<HTMLElement | null>(null)

const openItems = computed<MenuLeaf[]>(() => menus.value[curTop.value]?.items ?? [])

/** Indices of selectable (non-separator) items in the open dropdown. */
const selectableIndexes = computed(() =>
  openItems.value.map((it, i) => (it.kind === 'separator' ? -1 : i)).filter(i => i >= 0))

function reset() {
  active.value = false
  dropdownOpen.value = false
  curItem.value = -1
}

// ── action execution ──────────────────────────────────────────────────────

async function runLeaf(leaf: MenuLeaf) {
  if (leaf.kind === 'separator') return
  reset()
  try {
    if (leaf.kind === 'rust' && leaf.id) {
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('trigger_menu_action', { id: leaf.id })
    } else if (leaf.kind === 'edit' && leaf.editCmd) {
      runEdit(leaf.editCmd)
    } else if (leaf.kind === 'window' && leaf.windowCmd) {
      await runWindow(leaf.windowCmd)
    }
  } catch { /* not in Tauri / command unavailable */ }
}

function runEdit(cmd: NonNullable<MenuLeaf['editCmd']>) {
  // execCommand is deprecated but still the simplest clipboard/undo bridge in
  // a WebView2 context. Keyboard shortcuts work regardless if it no-ops.
  const map: Record<string, string> = {
    undo: 'undo', redo: 'redo', cut: 'cut', copy: 'copy', paste: 'paste', selectAll: 'selectAll',
  }
  try { document.execCommand(map[cmd]) } catch { /* ignore */ }
}

async function runWindow(cmd: NonNullable<MenuLeaf['windowCmd']>) {
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  const w = getCurrentWindow()
  if (cmd === 'minimize') await w.minimize()
  else if (cmd === 'toggleMaximize') await w.toggleMaximize()
  else if (cmd === 'toggleFullscreen') await w.setFullscreen(!(await w.isFullscreen()))
  else if (cmd === 'quit') {
    try {
      const { exit } = await import('@tauri-apps/plugin-process')
      await exit(0)
    } catch { await w.close() }
  }
}

// ── mouse ─────────────────────────────────────────────────────────────────

function onTopClick(i: number) {
  if (active.value && dropdownOpen.value && curTop.value === i) {
    reset() // clicking the open menu again closes it
    return
  }
  active.value = true
  curTop.value = i
  dropdownOpen.value = true
  curItem.value = -1
}

function onTopEnter(i: number) {
  // Once a dropdown is open, hovering another top switches to it (Windows UX).
  if (active.value && dropdownOpen.value) {
    curTop.value = i
    curItem.value = -1
  }
}

// ── keyboard ──────────────────────────────────────────────────────────────

// Track whether Alt was pressed cleanly (no other key, no other modifier) so a
// plain Alt tap toggles the bar but Alt+Tab / Alt+F4 / Alt+mnemonic don't.
let altClean = false

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Alt' && !e.repeat && !e.ctrlKey && !e.shiftKey && !e.metaKey) {
    altClean = true
    e.preventDefault() // suppress the OS menu-activation chime on Windows
    return
  }

  // Alt+<letter> opens the matching top menu directly.
  if (e.altKey && e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
    altClean = false
    const idx = menus.value.findIndex(m => m.mnemonic.toLowerCase() === e.key.toLowerCase())
    if (idx >= 0) {
      e.preventDefault()
      active.value = true
      curTop.value = idx
      dropdownOpen.value = true
      curItem.value = -1
    }
    return
  }

  if (e.altKey) { altClean = false }

  if (!active.value) return

  switch (e.key) {
    case 'Escape':
      e.preventDefault()
      if (dropdownOpen.value) { dropdownOpen.value = false; curItem.value = -1 }
      else reset()
      break
    case 'ArrowLeft':
      e.preventDefault()
      curTop.value = (curTop.value - 1 + menus.value.length) % menus.value.length
      curItem.value = -1
      break
    case 'ArrowRight':
      e.preventDefault()
      curTop.value = (curTop.value + 1) % menus.value.length
      curItem.value = -1
      break
    case 'ArrowDown':
      e.preventDefault()
      dropdownOpen.value = true
      moveItem(1)
      break
    case 'ArrowUp':
      e.preventDefault()
      dropdownOpen.value = true
      moveItem(-1)
      break
    case 'Enter':
    case ' ': {
      e.preventDefault()
      if (dropdownOpen.value && curItem.value >= 0) runLeaf(openItems.value[curItem.value])
      else { dropdownOpen.value = true; moveItem(1) }
      break
    }
    default:
      // Letter → activate the matching item in the open dropdown.
      if (dropdownOpen.value && e.key.length === 1) {
        const hit = openItems.value.find(it =>
          it.kind !== 'separator' && it.mnemonic?.toLowerCase() === e.key.toLowerCase())
        if (hit) { e.preventDefault(); runLeaf(hit) }
      }
  }
}

function onKeyup(e: KeyboardEvent) {
  if (e.key === 'Alt' && altClean) {
    altClean = false
    e.preventDefault()
    if (active.value) reset()
    else { active.value = true; curTop.value = 0; dropdownOpen.value = false; curItem.value = -1 }
  }
}

function moveItem(dir: 1 | -1) {
  const sel = selectableIndexes.value
  if (!sel.length) return
  const pos = sel.indexOf(curItem.value)
  const next = pos < 0
    ? (dir === 1 ? 0 : sel.length - 1)
    : (pos + dir + sel.length) % sel.length
  curItem.value = sel[next]
}

function onWindowMousedown(e: MouseEvent) {
  if (!active.value) return
  if (rootEl.value && !rootEl.value.contains(e.target as Node)) reset()
}

// ── mnemonic underline ──────────────────────────────────────────────────────

function labelParts(label: string, mnemonic?: string) {
  if (!mnemonic) return { pre: label, hit: '', post: '' }
  const i = label.indexOf(mnemonic)
  if (i < 0) return { pre: label, hit: '', post: '' }
  return { pre: label.slice(0, i), hit: label.slice(i, i + 1), post: label.slice(i + 1) }
}

onMounted(() => {
  if (!enabled) return
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('keyup', onKeyup)
  window.addEventListener('mousedown', onWindowMousedown, true)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('keyup', onKeyup)
  window.removeEventListener('mousedown', onWindowMousedown, true)
})

function onItemEnter(i: number) { if (dropdownOpen.value) curItem.value = i }
</script>

<template>
  <div v-if="enabled && active" ref="rootEl" class="menubar" role="menubar" aria-label="Application menu">
    <template v-for="(top, ti) in menus" :key="top.label">
      <div class="menubar__top-wrap">
        <button
          class="menubar__top"
          :class="{ 'menubar__top--active': dropdownOpen && curTop === ti }"
          type="button"
          :aria-haspopup="true"
          :aria-expanded="dropdownOpen && curTop === ti"
          @click="onTopClick(ti)"
          @mouseenter="onTopEnter(ti)"
        >
          <template v-if="labelParts(top.label, top.mnemonic).hit">
            {{ labelParts(top.label, top.mnemonic).pre }}<u>{{ labelParts(top.label, top.mnemonic).hit }}</u>{{ labelParts(top.label, top.mnemonic).post }}
          </template>
          <template v-else>{{ top.label }}</template>
        </button>

        <!-- Dropdown -->
        <div
          v-if="dropdownOpen && curTop === ti"
          class="menubar__dropdown"
          role="menu"
        >
          <template v-for="(item, ii) in top.items" :key="ii">
            <div v-if="item.kind === 'separator'" class="menubar__sep" role="separator" />
            <button
              v-else
              class="menubar__item"
              :class="{ 'menubar__item--hover': curItem === ii }"
              type="button"
              role="menuitem"
              @click="runLeaf(item)"
              @mouseenter="onItemEnter(ii)"
            >
              <span class="menubar__label">
                <template v-if="labelParts(item.label || '', item.mnemonic).hit">
                  {{ labelParts(item.label || '', item.mnemonic).pre }}<u>{{ labelParts(item.label || '', item.mnemonic).hit }}</u>{{ labelParts(item.label || '', item.mnemonic).post }}
                </template>
                <template v-else>{{ item.label }}</template>
              </span>
              <span v-if="item.accelerator" class="menubar__accel">{{ item.accelerator }}</span>
            </button>
          </template>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.menubar {
  display: flex;
  align-items: stretch;
  height: 28px;
  padding: 0 4px;
  background: var(--app-background);
  border-bottom: 1px solid var(--app-border, rgba(255, 255, 255, 0.06));
  user-select: none;
  position: relative;
  z-index: 50;
  font-size: 13px;
}

.menubar__top-wrap {
  position: relative;
  display: flex;
}

.menubar__top {
  display: inline-flex;
  align-items: center;
  height: 100%;
  padding: 0 8px;
  border: none;
  background: transparent;
  color: var(--app-foreground);
  cursor: pointer;
  border-radius: 4px;
  white-space: nowrap;
}

.menubar__top:hover,
.menubar__top--active {
  background: color-mix(in srgb, var(--app-foreground) 10%, transparent);
}

.menubar__top u {
  text-decoration-thickness: 1px;
  text-underline-offset: 2px;
}

.menubar__dropdown {
  position: absolute;
  top: calc(100% + 2px);
  left: 0;
  min-width: 220px;
  max-height: calc(100vh - 80px);
  overflow-y: auto;
  padding: 4px;
  background: var(--app-input-bg, var(--app-background));
  border: 1px solid var(--app-border, rgba(255, 255, 255, 0.1));
  border-radius: 8px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.35);
  z-index: 60;
}

.menubar__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  width: 100%;
  height: 28px;
  padding: 0 10px;
  border: none;
  background: transparent;
  color: var(--app-foreground);
  cursor: pointer;
  border-radius: 5px;
  text-align: left;
}

.menubar__item--hover,
.menubar__item:hover {
  background: var(--app-accent, #6366f1);
  color: #fff;
}

.menubar__label {
  white-space: nowrap;
}

.menubar__label u {
  text-decoration-thickness: 1px;
  text-underline-offset: 2px;
}

.menubar__accel {
  font-size: 11px;
  opacity: 0.6;
  font-variant-numeric: tabular-nums;
}

.menubar__item--hover .menubar__accel,
.menubar__item:hover .menubar__accel {
  opacity: 0.85;
}

.menubar__sep {
  height: 1px;
  margin: 4px 6px;
  background: var(--app-border, rgba(255, 255, 255, 0.08));
}
</style>
