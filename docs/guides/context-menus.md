# Context Menus

Construct provides a shared context menu system that renders **native OS menus** via Tauri. Both built-in spaces and marketplace spaces use the same API.

## Architecture

```
showContextMenu()          — Simple native OS menus (most spaces use this)
        ↓
useNativeContextMenu.ts    — Builds Tauri Menu items from option arrays
        ↓
@tauri-apps/api/menu       — Native MenuItem, Submenu, PredefinedMenuItem

openContextMenu()          — Rich menus with cross-space contributors
        ↓
useContextMenus.ts         — Resolves items from manifest + contributors + inline
        ↓
showContextMenu()          — Renders the final merged menu natively
```

## Quick Start

```ts
import { showContextMenu } from '@construct-space/sdk'

// Right-click handler
function onContextMenu(e: MouseEvent) {
  e.preventDefault()
  showContextMenu([
    [
      { label: 'Edit', onSelect: () => edit() },
      { label: 'Duplicate', onSelect: () => duplicate() },
    ],
    [
      { label: 'Delete', onSelect: () => remove() },
    ],
  ])
}
```

```vue
<template>
  <div @contextmenu.prevent="onContextMenu">
    Right-click me
  </div>
</template>
```

## API Reference

### `showContextMenu(groups)`

Show a native OS context menu at the current cursor position.

**Input formats:**

```ts
// Groups (most common) — each array is a group separated by a divider
showContextMenu([
  [{ label: 'Cut' }, { label: 'Copy' }, { label: 'Paste' }],
  [{ label: 'Delete' }],
])

// Named groups
showContextMenu([
  { label: 'Edit', items: [{ label: 'Cut' }, { label: 'Copy' }] },
  { label: 'Danger', items: [{ label: 'Delete' }] },
])

// Flat list (no separators)
showContextMenu([
  { label: 'Option A' },
  { label: 'Option B' },
])
```

**Menu item options:**

```ts
interface NativeMenuOption {
  label?: string              // Display text
  type?: 'separator'          // Render as separator line
  disabled?: boolean          // Greyed out, not clickable
  shortcut?: string           // Accelerator key (e.g. 'CmdOrCtrl+C')
  children?: NativeMenuOption[] // Submenu
  onSelect?: () => void       // Click handler
  action?: () => void         // Alias for onSelect
}
```

### `openContextMenu(request)`

Show a context menu that other spaces can contribute items to.

```ts
import { openContextMenu } from '@construct-space/sdk'

await openContextMenu({
  sourceSpace: 'editor',          // Which space triggered the menu
  projectId: 123,                 // Optional project context
  target: {                       // What was right-clicked
    kind: 'file',                 // file | folder | document | task | space-root | custom
    path: '/path/to/file.ts',
    name: 'file.ts',
  },
  items: [                        // Your items (other spaces can add more)
    [{ label: 'Open', onSelect: () => open() }],
    [{ label: 'Delete', onSelect: () => remove() }],
  ],
})
```

### `registerContextMenuContributor(spaceId, contributor)`

Add items to other spaces' context menus.

```ts
import { registerContextMenuContributor } from '@construct-space/sdk'

// Contribute to all spaces' file context menus
const unregister = registerContextMenuContributor('*', async (request) => {
  if (request.target.kind !== 'file') return []
  return [
    [{ label: 'Analyze with My Tool', onSelect: () => analyze(request.target.path) }],
  ]
})

// Contribute only to the editor space
registerContextMenuContributor('editor', async (request) => {
  return [
    [{ label: 'Run Linter', onSelect: () => lint(request.target.path) }],
  ]
})
```

## Manifest Declaration

Spaces can declare static context menu items in `space.manifest.json`. These are resolved automatically when `openContextMenu()` is called.

```json
{
  "contextMenus": {
    "file": [
      [
        {
          "label": "Open in My Space",
          "icon": "i-lucide-external-link",
          "action": {
            "type": "space.open",
            "spaceId": "myapp",
            "page": "viewer",
            "query": { "file": "{{target.path}}" }
          }
        }
      ]
    ],
    "folder": [
      [
        {
          "label": "Index Folder",
          "action": {
            "type": "space.request",
            "requestType": "index_folder",
            "params": { "path": "{{target.path}}" }
          }
        }
      ]
    ]
  }
}
```

**Target kinds:** `file`, `folder`, `document`, `task`, `space-root`, `custom`

**Action types:**
- `host.navigate` — Navigate to a route
- `space.open` — Open a specific space page
- `space.request` — Send a request to the space's operator handler

## Patterns

### File Explorer (like the Editor space)

```ts
function onFileRightClick(node: TreeNode, e: MouseEvent) {
  e.preventDefault()
  if (node.isDir) {
    showContextMenu([
      [
        { label: 'New File', onSelect: () => createFile(node.path) },
        { label: 'New Folder', onSelect: () => createFolder(node.path) },
      ],
      [
        { label: 'Rename', onSelect: () => rename(node.path, node.name) },
        { label: 'Delete', onSelect: () => remove(node.path) },
      ],
      [
        { label: 'Copy Path', onSelect: () => navigator.clipboard.writeText(node.path) },
        { label: 'Reveal in Finder', onSelect: () => reveal(node.path) },
      ],
    ])
  } else {
    showContextMenu([
      [
        { label: 'Rename', onSelect: () => rename(node.path, node.name) },
        { label: 'Duplicate', onSelect: () => duplicate(node.path) },
        { label: 'Delete', onSelect: () => remove(node.path) },
      ],
      [
        { label: 'Copy Path', onSelect: () => navigator.clipboard.writeText(node.path) },
      ],
    ])
  }
}
```

### Empty Area Fallback

```vue
<div @contextmenu.prevent="onEmptyAreaRightClick">
  <!-- Tree items handle their own @contextmenu.prevent.stop -->
  <TreeItem v-for="item in items" ... @contextmenu.prevent.stop="onItemRightClick(item, $event)" />
</div>
```

Use `.stop` on child items so the parent's handler only fires for empty space.

### Submenus

```ts
showContextMenu([
  [
    {
      label: 'Sort By',
      children: [
        { label: 'Name', onSelect: () => sortBy('name') },
        { label: 'Date Modified', onSelect: () => sortBy('date') },
        { label: 'Size', onSelect: () => sortBy('size') },
        { type: 'separator' },
        { label: 'Ascending', onSelect: () => setOrder('asc') },
        { label: 'Descending', onSelect: () => setOrder('desc') },
      ],
    },
  ],
])
```

## Key Files

| File | Purpose |
|------|---------|
| `frontend/composables/useNativeContextMenu.ts` | `showContextMenu()` — native Tauri menus |
| `frontend/composables/useContextMenus.ts` | `openContextMenu()` — rich menus with contributors |
| `frontend/lib/contextMenuTypes.ts` | Types for targets, actions, items |
| `frontend/lib/constructSdk.ts` | SDK exports for spaces |
| `frontend/lib/spaceHost.ts` | Host bridge that exposes APIs to dynamic spaces |
