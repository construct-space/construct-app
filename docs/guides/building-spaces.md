# Building a Space

## Quick Start

1. Create the space directory:

```bash
mkdir space-myapp && cd space-myapp
bun init
bun add @construct-space/sdk @construct-space/ui
```

2. Create `space.manifest.json`:

```json
{
  "id": "myapp",
  "name": "My App",
  "version": "0.1.0",
  "description": "My custom space",
  "icon": "i-lucide-star",
  "scope": "both",
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

3. Create your page:

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

## Distribution

### Public (Marketplace)

Publish to the Spaces Portal for anyone to install.

### Private (Organization)

Install directly into your Construct data directory:

```
~/Library/Application Support/space.construct.personal/spaces/space-myapp/
```

### Scoped

- `"scope": "project"` — only visible when a project is open
- `"scope": "company"` — always visible, organization-wide
- `"scope": "both"` — works in both contexts
