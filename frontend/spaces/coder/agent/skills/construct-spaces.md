---
id: construct-spaces
name: Construct Spaces
description: How to build, edit, and debug Construct spaces — layout, SDK, UI, Graph, CLI, manifest, theme
trigger: "space,construct,manifest,space_create,space_build,space_check,space_validate,space_install"
category: construct
agents: [coder]
---

# Construct Spaces

A space is a Vue 3 plugin that runs inside the Construct desktop app. It is NOT a standalone web app. It builds as an IIFE bundle that Construct loads from disk.

## Project Layout

```
{project}/
  space-{name}/
    space.manifest.json
    package.json
    vite.config.ts
    tsconfig.json
    src/
      entry.ts           ← exports pages, widgets, actions
      pages/
        index.vue        ← default page
      components/
      composables/
      models/            ← Graph data models
    agent/
      config.md
      skills/*.md
    widgets/
      summary/
        2x1.vue
        4x1.vue
    dist/                ← build output
  docs/
```

## Manifest (space.manifest.json)

IMPORTANT: Use this exact format. Do NOT use `spaceId`, `displayName`, or `routes` — those are wrong.

```json
{
  "id": "notes",
  "name": "Notes",
  "version": "1.0.0",
  "description": "Sticky notes for quick reminders",
  "author": { "name": "Developer" },
  "icon": "i-lucide-sticky-note",
  "scope": "both",
  "navigation": {
    "label": "Notes",
    "icon": "i-lucide-sticky-note",
    "to": "notes",
    "order": 40
  },
  "pages": [
    { "path": "", "label": "Board", "icon": "i-lucide-sticky-note", "default": true },
    { "path": "/settings", "label": "Settings" }
  ],
  "agent": "agent/config.md",
  "actions": "src/actions.ts",
  "widgets": [
    {
      "id": "quick-notes",
      "name": "Notes",
      "description": "Quick access",
      "icon": "i-lucide-sticky-note",
      "defaultSize": "4x1",
      "sizes": { "2x1": "widgets/summary/2x1.vue", "4x1": "widgets/summary/4x1.vue" }
    }
  ]
}
```

Icons: `i-lucide-{name}` (e.g., `i-lucide-zap`, `i-lucide-receipt`, `i-lucide-layout-dashboard`).

## entry.ts

The entry file exports pages, widgets, and actions for Construct to load:

```ts
import IndexPage from './pages/index.vue'
import SettingsPage from './pages/SettingsPage.vue'
import Widget2x1 from '../widgets/summary/2x1.vue'
import Widget4x1 from '../widgets/summary/4x1.vue'
import { actions } from './actions'

export default {
  pages: {
    '': IndexPage,
    '/settings': SettingsPage,
  },
  widgets: {
    'widget-id': {
      '2x1': Widget2x1,
      '4x1': Widget4x1,
    },
  },
  actions,
}
```

## vite.config.ts

```ts
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
  plugins: [vue()],
  build: {
    lib: {
      entry: resolve(__dirname, 'src/entry.ts'),
      name: '__CONSTRUCT_SPACE_{ID_UPPER}',
      fileName: 'space-{id}',
      formats: ['iife'],
    },
    rollupOptions: {
      external: ['vue', 'vue-router', 'pinia', '@vueuse/core'],
      output: {
        globals: {
          vue: 'window.__CONSTRUCT__.vue',
          'vue-router': 'window.__CONSTRUCT__["vue-router"]',
          pinia: 'window.__CONSTRUCT__.pinia',
          '@vueuse/core': 'window.__CONSTRUCT__["@vueuse/core"]',
        },
      },
    },
  },
  resolve: {
    alias: { '~': resolve(__dirname), '@': resolve(__dirname, 'src') },
  },
})
```

## package.json

```json
{
  "name": "@construct-spaces/space-{name}",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "construct build",
    "dev": "construct dev",
    "check": "construct check"
  },
  "peerDependencies": { "vue": "^3.5.31" },
  "dependencies": {
    "@construct-space/graph": "0.3.3",
    "@construct-space/ui": "^0.3.5",
    "lucide-vue-next": "^1.0.0"
  },
  "devDependencies": {
    "vite": "^8.0.2",
    "@vitejs/plugin-vue": "^5.2.4",
    "typescript": "^6.0.2",
    "vue-tsc": "^3.2.6"
  }
}
```

## Construct CLI (`construct` / `@construct-space/cli`)

```bash
construct scaffold {name}     # Create a new space
construct dev                  # Dev mode with hot reload
construct build                # Build IIFE bundle
construct run                  # Install locally
construct check                # Type-check + lint
construct validate             # Validate manifest
construct publish              # Publish to registry
construct clean                # Remove build artifacts
```

### Graph CLI (data models):
```bash
construct graph init                                    # Add Graph to space
construct graph g Task title:string status:string       # Generate a model
construct graph push                                    # Register with Graph
```

Field types: `string`, `int`, `number`, `boolean`, `date`, `json`, `enum:a,b,c`
Modifiers: `required`, `unique`, `index` — chain with `:` e.g. `email:string:required:unique`
Relations: `post:belongsTo:Post`, `comments:hasMany:Comment`

## @construct-space/sdk

```ts
import { useOperator, useTheme, useNotification, useAuth, useStorage } from '@construct-space/sdk'
```

- `useOperator()` — backend communication. Returns `{ connected, send, connect }`
- `useTheme()` — current theme. Returns `{ theme, isDark }`
- `useNotification()` — toasts. `add({ title, description, color })`
- `useAuth()` / `useAuthStore()` — current user
- `useStorage()` — persistent key-value storage
- `useProjectStore()` — active project context
- `useMarkdown()` — `{ renderMarkdown(text) }`

## @construct-space/graph

```ts
import { defineModel, field, access, useGraph, type DataRecord } from '@construct-space/graph'
```

### Model definition:
```ts
// src/models/Note.ts
import { defineModel, field, access } from '@construct-space/graph'

export const Note = defineModel('note', {
  content: field.string().required(),
  color: field.string(),
  position_x: field.int(),
  position_y: field.int(),
  is_pinned: field.boolean(),
}, {
  access: {
    read: access.owner(),
    create: access.authenticated(),
    update: access.owner(),
    delete: access.owner(),
  }
})
```

### Composable pattern:
```ts
// src/composables/useNotes.ts
import { useGraph, type DataRecord } from '@construct-space/graph'
import { Note } from '../models/Note'

export interface NoteRecord extends DataRecord {
  content: string
  color: string
  is_pinned: boolean
}

let _graph: ReturnType<typeof useGraph<NoteRecord>> | null = null
function graph() {
  if (!_graph) _graph = useGraph<NoteRecord>(Note)
  return _graph
}

export function useNotes() {
  return {
    list: () => graph().find(),
    get: (id: string) => graph().findOne(id),
    create: (data: Partial<NoteRecord>) => graph().create(data as any),
    update: (id: string, data: Partial<NoteRecord>) => graph().update(id, data),
    remove: (id: string) => graph().remove(id),
    count: () => graph().count(),
  }
}
```

## @construct-space/ui

```ts
import { Button, Badge, Card, Input, Modal, Icon, DashboardPanel } from '@construct-space/ui'
```

Components: DashboardPanel, Accordion, Drawer, Modal, Badge, Card, Chip, Avatar, Empty, Button, Input, Checkbox, ColorPicker, Calendar, ContextMenu, Dropdown, DropdownMenu, Alert, Notification, Tooltip, Icon, Kbd.

Built on Reka UI + Tailwind CSS.

## Theme Variables

Always use these — never hardcode colors:

```css
var(--app-background)          /* main bg */
var(--app-foreground)          /* main text */
var(--app-accent)              /* brand color */
var(--app-muted)               /* secondary text */
var(--app-border)              /* borders */
var(--app-surface)             /* card surfaces */
```

## Vue 3 SFC Pattern

```vue
<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useNotification } from '@construct-space/sdk'
import { Button, Card, Badge } from '@construct-space/ui'
import { StickyNote } from 'lucide-vue-next'
import { useNotes, type NoteRecord } from '../composables/useNotes'

const toast = useNotification()
const { list, create, remove } = useNotes()
const notes = ref<NoteRecord[]>([])

onMounted(async () => { notes.value = await list() })
</script>

<template>
  <div class="p-4" style="background: var(--app-background); color: var(--app-foreground)">
    <Card v-for="note in notes" :key="note.id">
      <div class="p-3">
        <Badge :label="note.color" />
        <p class="text-sm" style="color: var(--app-muted)">{{ note.content }}</p>
      </div>
    </Card>
  </div>
</template>
```

## Workflow

### New space:
Use `space_create` to scaffold, then implement pages. Never mkdir manually.

### Edit existing space:
1. `space_check` to see errors
2. Read failing files
3. Fix with `edit_file`
4. `space_check` again
5. `space_build` → `space_install` → `construct_open_dev`

### Rules:
- Use `space_build`, never `npm run build` or `bash`
- No dev servers — spaces load inside Construct
- Use `@construct-space/ui` for UI components
- Use `@construct-space/graph` for data persistence
- Use CSS theme variables, not hardcoded colors
- Do NOT read node_modules — this skill has all the API docs you need
