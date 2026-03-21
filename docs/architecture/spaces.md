# Spaces Architecture

## What is a Space?

A Space is a self-contained module that adds functionality to Construct. Think VS Code extensions, but richer — each space has its own UI, AI agent, tools, and theme.

## Built-in Spaces

| Space | ID | Description | Agent |
|-------|----|-------------|-------|
| Code | `code` | Editor, terminal, git | code-assistant |
| Design | `design` | PixiJS canvas editor | design (+ sub-agents) |
| AI | `ai` | Multi-model chat | — (uses general) |
| Chat | `chat` | Team messaging | — |
| Git | `git` | Visual VCS | git |
| Terminal | `terminal` | PTY shell | — |
| Tasks | `kanban` | Kanban boards | kanban |
| Docs | `docs` | Markdown docs | docs |
| Notes | `notes` | Sticky notes | — |
| Calendar | `calendar` | Scheduling | calendar |

## Space File Structure

```
space-{name}/
  space.manifest.json    ← identity, pages, toolbar, theme
  space.config.ts        ← typed config (SpaceConfig interface)
  pages/                 ← route components (one per page)
  views/                 ← reusable view components
  components/            ← space-specific UI
  composables/           ← shared logic
  stores/                ← state management
  tests/                 ← space tests
  agent/                 ← AI configuration
    config.md            ← YAML frontmatter + Handlebars system prompt
    tools/               ← custom tools (*.md with command templates)
    skills/              ← prompt templates
    hooks/               ← safety.json (pre/post tool hooks)
```

## Manifest (space.manifest.json)

```json
{
  "id": "code",
  "name": "Code",
  "version": "0.3.17",
  "description": "Code editor with terminal and git",
  "icon": "i-lucide-code",
  "scope": "both",
  "navigation": {
    "label": "Code",
    "icon": "i-lucide-code",
    "to": "code",
    "order": 10
  },
  "pages": [
    {
      "path": "",
      "label": "Overview",
      "default": true,
      "toolbar": [
        { "id": "code-new-file", "icon": "i-lucide-file-plus", "label": "New File", "action": "new-file" }
      ]
    },
    { "path": "editor", "label": "Editor" },
    { "path": "terminal", "label": "Terminal" }
  ],
  "theme": {
    "color": "text-emerald-400",
    "bg": "bg-emerald-400/10"
  }
}
```

## Agent Configuration (agent/config.md)

```markdown
---
id: code-assistant
name: Code Space Assistant
category: specialized
maxIterations: 20
blockedTools:
  - create_event
  - create_task
  - create_ui_screen
---

System prompt here. Uses Handlebars templates:

{{#if context.project}}
Project: **{{context.project.name}}**
{{/if}}
```

### Key fields:
- `blockedTools` — tools this agent cannot use
- `canInvokeAgents` — sub-agents this agent can spawn
- `maxIterations` — max turns before stopping

## Custom Tools (agent/tools/*.md)

```markdown
---
id: build
name: Build Project
description: Build the project for production
parameters:
  - name: mode
    type: string
    enum: [production, development]
command: |
  cd {{project_dir}} && npm run build
timeout: 300
confirm: false
---

Use this tool when the user asks to build.
```

## Safety Hooks (agent/hooks/safety.json)

```json
{
  "hooks": [
    {
      "id": "code-no-rm-rf",
      "type": "pre_tool",
      "tools": ["bash"],
      "command": "if echo \"$TOOL_INPUT\" | grep -qE 'rm\\s+-rf\\s+/'; then\n  echo '{\"block\":true,\"message\":\"Dangerous rm -rf blocked\"}'\nfi"
    }
  ]
}
```

## Teleporting

Spaces don't render the shell. They teleport content into it:

1. **Sidebar icon** — `navigation` object tells the shell what icon, route, and sort order
2. **Toolbar actions** — each page declares toolbar buttons, rendered in the toolbar zone
3. **Sub-pages** — shown as icons on the sidebar's second panel (3D rotated)

## Scope

- `project` — only visible when a project is open
- `company` — organization-wide, not project-specific
- `both` — works in both contexts

## SDK

Spaces import components and composables from `@construct-space/sdk`:

```ts
import { Button, Modal, useToast, useToolbar } from '@construct-space/sdk'
```

The SDK provides types at build time. Runtime implementations are injected by the Construct host via `window.__CONSTRUCT__`.
