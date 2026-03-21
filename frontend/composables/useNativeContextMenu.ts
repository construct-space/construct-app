import { Menu, MenuItem, Submenu, PredefinedMenuItem } from '@tauri-apps/api/menu'

export interface NativeMenuOption {
  label?: string
  type?: 'separator'
  disabled?: boolean
  shortcut?: string
  children?: NativeMenuOption[]
  action?: () => void | Promise<unknown>
  onSelect?: () => void | Promise<unknown>
}

export interface NativeMenuGroup {
  label?: string
  items: NativeMenuOption[]
}

async function buildItems(
  options: NativeMenuOption[],
): Promise<Array<MenuItem | Submenu | PredefinedMenuItem>> {
  return Promise.all(
    options.map(async (item) => {
      if (item.type === 'separator') {
        return PredefinedMenuItem.new({ item: 'Separator' })
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
          item.onSelect?.()
          item.action?.()
        },
      })
    }),
  )
}

/**
 * Show a native OS context menu at the current cursor position.
 *
 * Accepts either:
 *  - NativeMenuGroup[]      — object groups with `items`
 *  - NativeMenuOption[][]   — groups separated by auto-inserted separators
 *  - NativeMenuOption[]     — flat list of items (no auto separators)
 */
export async function showContextMenu(
  groups: NativeMenuGroup[] | NativeMenuOption[][] | NativeMenuOption[],
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
