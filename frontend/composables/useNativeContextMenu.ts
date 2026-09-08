import { LogicalPosition } from '@tauri-apps/api/dpi'
import { Menu, MenuItem, Submenu, PredefinedMenuItem } from '@tauri-apps/api/menu'
import { getCurrentWindow } from '@tauri-apps/api/window'

export interface NativeMenuOption {
  label?: string
  type?: 'separator'
  predefinedItem?: 'Copy' | 'Cut' | 'Paste' | 'SelectAll' | 'Undo' | 'Redo'
  disabled?: boolean
  shortcut?: string
  children?: NativeMenuOption[]
  action?: () => void | Promise<unknown>
  onSelect?: () => void | Promise<unknown>
  // The SDK's ContextMenuItem type exposes `onClick`; accept it as an alias of
  // `onSelect` so space bundles written against the published type still fire.
  onClick?: () => void | Promise<unknown>
}

export interface NativeMenuGroup {
  label?: string
  items: NativeMenuOption[]
}

export interface NativeMenuAnchor {
  x: number
  y: number
}

async function buildItems(
  options: NativeMenuOption[],
): Promise<Array<MenuItem | Submenu | PredefinedMenuItem>> {
  return Promise.all(
    options.map(async (item) => {
      if (item.type === 'separator') {
        return PredefinedMenuItem.new({ item: 'Separator' })
      }

      if (item.predefinedItem) {
        return PredefinedMenuItem.new({
          item: item.predefinedItem,
          text: item.label,
        })
      }

      if (item.children && item.children.length > 0) {
        const subItems = await buildItems(item.children)
        return Submenu.new({
          text: item.label ?? '',
          items: subItems,
          enabled: !item.disabled,
        })
      }

      return MenuItem.new({
        text: item.label ?? '',
        enabled: !item.disabled,
        accelerator: item.shortcut,
        action: () => {
          // onSelect is canonical; onClick is the SDK-type alias. Fire whichever
          // the caller set (not both, to avoid double-invocation when equal).
          ;(item.onSelect ?? item.onClick)?.()
          item.action?.()
        },
      })
    }),
  )
}

/**
 * Show a native OS context menu at the current cursor position or an explicit
 * anchor point relative to the current window.
 *
 * Accepts either:
 *  - NativeMenuGroup[]      — object groups with `items`
 *  - NativeMenuOption[][]   — groups separated by auto-inserted separators
 *  - NativeMenuOption[]     — flat list of items (no auto separators)
 */
export async function showContextMenu(
  groups: NativeMenuGroup[] | NativeMenuOption[][] | NativeMenuOption[],
  anchor?: NativeMenuAnchor,
): Promise<void> {
  const normalized = normalizeNativeGroups(groups)
  if (normalized.length === 0) return

  const flat: NativeMenuOption[] = []
  normalized.forEach((group, index) => {
    if (index > 0) flat.push({ type: 'separator' })
    flat.push(...group)
  })

  const menuItems = await buildItems(flat)
  const menu = await Menu.new({ items: menuItems })
  if (anchor) {
    await menu.popup(
      new LogicalPosition(Math.round(anchor.x), Math.round(anchor.y)),
      getCurrentWindow(),
    )
    return
  }

  await menu.popup()
}

function normalizeNativeGroups(
  input: NativeMenuGroup[] | NativeMenuOption[][] | NativeMenuOption[],
): NativeMenuOption[][] {
  if (input.length === 0) return []

  const first = input[0]
  if (Array.isArray(first)) {
    return (input as NativeMenuOption[][]).filter(group => group.length > 0)
  }

  if (typeof first === 'object' && first !== null && Array.isArray((first as NativeMenuGroup).items)) {
    return (input as NativeMenuGroup[])
      .map(group => group.items)
      .filter(group => group.length > 0)
  }

  return [(input as NativeMenuOption[]).filter(Boolean)].filter(group => group.length > 0)
}
