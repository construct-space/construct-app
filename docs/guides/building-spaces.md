# Building a Space

## Quick Start

1. Scaffold the space:

```bash
construct scaffold space-myapp
cd space-myapp
```

2. Start dev mode:

```bash
construct dev
```

3. Build the installable bundle:

```bash
construct build
```

The output is `dist/myapp.space/`. Construct installs and publishes the
`.space` directory, not loose JS/CSS files.

## Bundle Layout

```text
dist/myapp.space/
  manifest.json
  app.iife.js
  style.css
  checksums.json
  SKILL.md
  agent/config.md
  widgets/
  assets/
  tools/<platform>/myapp-tools
  lib/<platform>/...
```

Every dynamic space ships its own `style.css`; do not rely on host Tailwind
utilities for page, widget, toolbar, or teleported UI styling.

`SKILL.md`, `scripts/`, `references/`, and `assets/` follow the agentskills.io
skill anatomy at the space root. `agent/config.md` is the Construct agent
prompt and tool whitelist.

Native tools are optional. If you add a root `tools.go`, `construct build`
compiles it to `tools/<platform>/<space-id>-tools`. Put third-party helpers
such as ffmpeg in `lib/<platform>/`; Construct sets `SPACE_DIR`, `SPACE_TOOLS`,
`SPACE_LIB`, `SPACE_LIB_ROOT`, `CONSTRUCT_SPACE_ID`, `CONSTRUCT_PLATFORM`, and
prefixes PATH with the selected `lib/` and `tools/` directories before running
the tool.

## Manifest

Scaffold creates `space.manifest.json`:

```json
{
  "id": "myapp",
  "name": "My App",
  "version": "0.1.0",
  "description": "My custom space",
  "icon": "i-lucide-star",
  "scopes": ["app"],
  "projectAware": false,
  "agent": "agent/config.md",
  "skills": ["SKILL.md"],
  "actions": "src/actions.ts",
  "navigation": {
    "label": "My App",
    "icon": "i-lucide-star",
    "to": "myapp",
    "order": 50
  },
  "pages": [
    {
      "path": "",
      "label": "Home",
      "default": true,
      "toolbar": [
        { "id": "myapp-action", "icon": "i-lucide-plus", "label": "Add", "action": "add" }
      ]
    }
  ],
  "theme": {
    "color": "text-blue-400",
    "bg": "bg-blue-400/10"
  }
}
```

## Page UI

Create your page:

```vue
<!-- pages/HomePage.vue -->
<script setup lang="ts">
import { Button, Card, Notification, useNotification } from '@construct-space/ui'
import { useToolbar } from '@construct-space/sdk'

const { add } = useNotification()
const { setPageItems } = useToolbar()

function handleAdd() {
  add({
    title: 'Added!',
    description: 'Your item was created.',
    color: 'success',
  })
}
</script>

<template>
  <div class="p-6">
    <Card title="My Space">
      <template #body>
        <p>Welcome to my custom space.</p>
        <Button label="Add Item" @click="handleAdd" />
      </template>
    </Card>
    <Notification />
  </div>
</template>
```

## Shared UI And Host APIs

Import shared UI from `@construct-space/ui`:

```ts
// UI Components
import { Button, Modal, Input, Select, Card, Badge, Tabs, Notification, ConfirmationModal, SplitPane } from '@construct-space/ui'

// UI composables
import { useNotification } from '@construct-space/ui'
```

Import host/runtime APIs from `@construct-space/sdk`:

```ts
// Host composables
import { useToolbar, useSpaces, useAuth, useStorage, useConstructConfig, getConstructRuntime } from '@construct-space/sdk'

// Stores
import { useProjectStore, useAuthStore, usePinnedStore } from '@construct-space/sdk'

// Types
import type { SpaceInfo, ToolbarItem, Turn, RequestBlock } from '@construct-space/sdk'
```

## Org-scoped spaces

Spaces declaring `scope: "org"` (or `"company"`) in their manifest can
read the roster and org structure through focused composables —
assignee pickers, mentions, filter-by-team, permission-aware UI.

```ts
import {
  useOrg, useOrgMembers, useOrgTeams, useOrgDepartments, useOrgRoles,
} from '@construct-space/sdk'

// Basic context — every org-scoped space needs these
const { orgId, orgName, isOrg, isAdmin } = useOrg()

// Roster for an assignee picker
const { members, byUserId } = useOrgMembers()
const assignee = computed(() => byUserId(card.assignee_user_id))

// Team + department slicing
const { teams, membersOf } = useOrgTeams()
const { departments, ofMember } = useOrgDepartments()

// Role-aware UI — .can() checks the active user's roles
const { can } = useOrgRoles()
// <button v-if="can('cards.delete')" @click="remove">Delete</button>
```

Each composable is a focused read slice: reactive `ComputedRef` getters,
typed lookups (`byId` / `byUserId` / `membersOf`), plus `refresh()` for
explicit re-fetches. No write methods — those stay on the admin surface.
All five share one underlying Pinia store, so a PM space + a docs space
+ a notifications space in the same session make one
`/org/members` + `/org/teams` + `/org/departments` + `/org/roles`
round-trip total.

First call anywhere auto-fires the fetch — you can `const { members } =
useOrgMembers()` at the top of a component and render directly, using
`loading` for the skeleton state.

## Adding an AI Agent

Create `agent/config.md`:

```markdown
---
id: myapp
name: My App Agent
category: specialized
maxIterations: 10
blockedTools:
  - create_ui_screen
  - git_commit
---

You are an assistant for the My App space.
Help users manage their items.

{{#if context.project}}
Project: **{{context.project.name}}**
{{/if}}
```

### Custom Tools

Create `agent/tools/add-item.md`:

```markdown
---
id: add_item
name: Add Item
description: Add a new item to the list
parameters:
  - name: title
    type: string
    description: Item title
    required: true
  - name: priority
    type: string
    enum: [low, medium, high]
command: |
  echo '{"title": "{{title}}", "priority": "{{priority}}"}'
timeout: 10
---

Use this tool to add items when the user asks.
```

### Safety Hooks

Create `agent/hooks/safety.json`:

```json
{
  "hooks": [
    {
      "id": "myapp-no-delete-all",
      "type": "pre_tool",
      "tools": ["bash"],
      "command": "if echo \"$TOOL_INPUT\" | grep -q 'delete.*all'; then echo '{\"block\":true,\"message\":\"Cannot delete all items\"}'; fi"
    }
  ]
}
```

## Context Menus

Spaces can show native OS context menus using `showContextMenu()` from the SDK. Menus appear at the cursor position and support groups, separators, submenus, and keyboard shortcuts.

### Basic Usage

```ts
import { showContextMenu } from '@construct-space/sdk'

async function onRightClick(e: MouseEvent) {
  e.preventDefault()
  await showContextMenu([
    [
      { label: 'New File', onSelect: () => createFile() },
      { label: 'New Folder', onSelect: () => createFolder() },
    ],
    [
      { label: 'Copy Path', onSelect: () => navigator.clipboard.writeText(path) },
      { label: 'Reveal in Finder', onSelect: () => revealInFinder(path) },
    ],
    [
      { label: 'Delete', onSelect: () => deleteItem(path) },
    ],
  ])
}
```

Each inner array is a **group** separated by a native divider line.

### Menu Item Options

```ts
interface NativeMenuOption {
  label?: string           // Display text
  type?: 'separator'       // Explicit separator
  disabled?: boolean       // Greyed out
  shortcut?: string        // Keyboard shortcut display (e.g. 'CmdOrCtrl+S')
  children?: NativeMenuOption[]  // Submenu items
  onSelect?: () => void    // Handler when clicked
}
```

### Submenus

```ts
showContextMenu([
  [
    {
      label: 'Sort By',
      children: [
        { label: 'Name', onSelect: () => sortBy('name') },
        { label: 'Date', onSelect: () => sortBy('date') },
        { label: 'Size', onSelect: () => sortBy('size') },
      ],
    },
  ],
])
```

### Rich Context Menus (Cross-Space)

For menus that other spaces can extend, use `openContextMenu()`:

```ts
import { openContextMenu } from '@construct-space/sdk'

await openContextMenu({
  sourceSpace: 'myapp',
  target: { kind: 'file', path: '/path/to/file.ts', name: 'file.ts' },
  items: [
    [{ label: 'Open', onSelect: () => openFile(path) }],
    [{ label: 'Delete', onSelect: () => deleteFile(path) }],
  ],
})
```

Other spaces can contribute items to your menus via `registerContextMenuContributor()`.

### Declaring Context Menus in Manifest

Spaces can declare static context menu items in `space.manifest.json`:

```json
{
  "contextMenus": {
    "file": [
      [
        { "label": "Open in My App", "action": { "type": "space.open", "spaceId": "myapp", "page": "viewer" } }
      ]
    ],
    "folder": [
      [
        { "label": "Scan Folder", "action": { "type": "space.request", "requestType": "scan", "params": {} } }
      ]
    ]
  }
}
```

Target kinds: `file`, `folder`, `document`, `task`, `space-root`, `custom`.

## Actions (Agent Tools)

Spaces can expose actions that agents invoke via `space_run_action`. Declare action metadata in the manifest for lazy loading (the bundle is only loaded when an action is first called):

```json
{
  "actions": {
    "add_item": {
      "description": "Add a new item to the list",
      "params": {
        "title": { "type": "string", "description": "Item title", "required": true },
        "priority": { "type": "string", "description": "Priority level" }
      }
    }
  }
}
```

Implement the `run` function in `src/actions.ts`:

```ts
export const actions = {
  add_item: {
    description: 'Add a new item to the list',
    params: {
      title: { type: 'string', description: 'Item title', required: true },
      priority: { type: 'string', description: 'Priority level' },
    },
    run: async (p: { title: string; priority?: string }) => {
      // Your logic here
      return { success: true, id: 'new-item-123' }
    },
  },
}
```

At build time, `construct build` extracts the metadata into `dist/manifest.json` so the host app can register tool definitions without loading your bundle.

## Distribution

### Public (Marketplace)

Publish to the Spaces Portal for anyone to install.

### Private (Organization)

Install directly into your Construct data directory:

```
~/Library/Application Support/space.construct.personal/spaces/space-myapp/
```

### Scopes

| Scope | Where it shows | Data keyed by | When to use |
|-------|----------------|---------------|-------------|
| `app` | App sidebar | `user_id` | Standalone tools (brainstorm, notes) |
| `project` | Inside project | `project_id` | Dev tools (coder, editor, architect) |
| `org` | App sidebar | `org_id` | Shared team tools (kanban, wiki). Requires org enabled. |
| `any` | Both locations | Adapts to context | Utility spaces that work anywhere |

### File-Based Page Routing

Space pages use Nuxt-style filesystem conventions. The CLI auto-generates `entry.ts` from your `src/pages/` directory:

```
src/pages/
  index.vue              → path: ""
  members.vue            → path: "members"
  members/[id].vue       → path: "members/:id"
  settings.vue           → path: "settings"
```

- `[param]` in filenames or directories → `:param` in route path
- `index.vue` → empty segment
- The manifest `pages` array is still needed for metadata (label, icon, hidden)
- Add `"component"` to a page entry to override filesystem discovery
