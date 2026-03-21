# Spaces

Spaces are programs that run inside Construct. Each space can ship an `agent/` directory with agents, tools, hooks, skills, and plugins that Operator loads at startup.

Operator is space-agnostic — it doesn't know what spaces do. It just loads whatever they provide.

## Directory Structure

```
~/Library/Application Support/Construct/spaces/
└── my-space/
    ├── manifest.json          # or space.manifest.json (source repos)
    ├── dist/                  # Compiled Vue/PixiJS UI
    └── agent/
        ├── config.md          # Agent config (YAML frontmatter + system prompt)
        ├── tools/             # Custom tools (*.md)
        │   ├── create-file.md
        │   └── run-build.md
        ├── hooks/             # Pre/post tool hooks (*.json)
        │   └── safety.json
        ├── skills/            # Reusable prompt templates (*.md)
        │   └── summarize.md
        └── plugins/           # Plugins with manifest (*/plugin.json)
            └── my-plugin/
                └── plugin.json
```

All subdirectories are optional. If a space has no hooks, leave `hooks/` empty or omit it.

## Manifest

```json
{
  "id": "design",
  "name": "Design Space",
  "description": "UI design and prototyping",
  "icon": "palette"
}
```

Both `manifest.json` (installed) and `space.manifest.json` (source repos) are supported.

## Agent Definition (agent/config.md)

YAML frontmatter defines the config, markdown body is the system prompt.

```markdown
---
id: designer
name: Design Agent
category: specialist
description: Creates and modifies UI components
maxIterations: 15
allowedTools:
  - read_file
  - write_file
  - space-design-scaffold
blockedTools: []
canInvokeAgents:
  - ui-planner
  - ui-builder
---

You are a UI design agent for the Design space.
When asked to create components, use the scaffold tool first...
```

**Fields:**
| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Agent identifier (namespaced to `space:<manifest.id>`) |
| `name` | string | Display name |
| `category` | string | Agent category |
| `description` | string | What the agent does |
| `maxIterations` | int | Max turns (default 25) |
| `allowedTools` | []string | Whitelist (empty = all) |
| `blockedTools` | []string | Blacklist |
| `canInvokeAgents` | []string | Sub-agents it can spawn |

## Tool Definition (agent/tools/*.md)

YAML frontmatter defines params and command, markdown body is AI instructions.

```markdown
---
id: scaffold
name: Scaffold Component
description: Generate a new Vue component from template
parameters:
  - name: component_name
    type: string
    description: Name of the component
    required: true
  - name: variant
    type: string
    description: Component style variant
    enum: [default, minimal, full]
command: node scripts/scaffold.js {{component_name}} --variant={{variant}}
workdir: project
timeout: 30
confirm: false
---

Use this tool when the user asks to create a new component.
Always use PascalCase for component names.
```

**Fields:**
| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `id` | string | required | Tool identifier |
| `name` | string | = id | Display name |
| `description` | string | | What it does |
| `parameters` | []param | | Input parameters |
| `command` | string | required | Shell command with `{{param}}` placeholders |
| `workdir` | string | "project" | Working directory: `project`, `home`, or absolute path |
| `timeout` | int | 30 | Timeout in seconds |
| `confirm` | bool | false | Require user confirmation |

**Parameter fields:**
| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Parameter name |
| `type` | string | string, number, boolean |
| `description` | string | For LLM context |
| `required` | bool | Must be provided |
| `enum` | []string | Allowed values |

## Hook Definition (agent/hooks/*.json)

JSON files with pre/post tool hooks. Each file follows the `HookConfig` format.

```json
{
  "hooks": [
    {
      "id": "no-force-push",
      "type": "pre_tool",
      "tools": ["bash"],
      "command": "if echo \"$TOOL_INPUT\" | grep -qE 'git\\s+push\\s+--force'; then\n  echo '{\"block\":true,\"message\":\"Force push not allowed\"}'\nfi"
    }
  ]
}
```

**Hook fields:**
| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Hook identifier |
| `type` | string | `pre_tool` or `post_tool` |
| `tools` | []string | Which tools this applies to (empty = all) |
| `patterns` | []string | File path patterns to match |
| `command` | string | Shell command — non-zero exit = block |
| `timeout` | int | Timeout in seconds (default 10) |

**Environment variables available in hook commands:**
- `HOOK_TYPE` — `pre` or `post`
- `TOOL_NAME` — name of the tool being called
- `TOOL_INPUT` — tool input (pre hooks)
- `TOOL_OUTPUT` — tool output (post hooks)
- `CONSTRUCT_PROJECT_ROOT` — current project root directory

## Skill Definition (agent/skills/*.md)

YAML frontmatter + markdown body as prompt template. Skills are reusable prompt bundles triggered by keywords.

```markdown
---
id: summarize-project
name: Summarize Project
description: Generate a concise summary of the current project
trigger: summarize|overview|what is this project
category: project
tools: [read_file, list_dir, glob]
---

Read the project's README and package.json. Provide a concise summary covering:
1. What the project does
2. Tech stack and key dependencies
3. How to run it
```

**Skill fields:**
| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Skill identifier |
| `name` | string | Display name |
| `description` | string | What the skill does |
| `trigger` | string | Regex or keyword trigger |
| `category` | string | For grouping |
| `tools` | []string | Additional tools this skill needs |

## Plugin Definition (agent/plugins/*/plugin.json)

Plugins are directories with a `plugin.json` manifest. They can register tools and hooks.

```json
{
  "id": "lint-guard",
  "name": "Lint Guard",
  "version": "1.0.0",
  "type": "hook",
  "entry_point": "./check.sh",
  "hooks": [
    {
      "id": "pre-lint",
      "type": "pre_tool",
      "tools": ["write_file", "edit_file"]
    }
  ]
}
```

## Namespacing

- **Agents:** `space:<manifest.id>` (e.g., `space:design`)
- **Tools:** `space-{manifest.id}-{tool.id}` (e.g., `space-design-scaffold`)
- **Hooks:** `space:<manifest.id>` source tag
- **Skills:** `space:<manifest.id>` source tag
- **Plugins:** `{plugin.id}:{hook/tool.id}`

This prevents conflicts between spaces and builtins.

## Auto-switching

When the user navigates to a space, the frontend automatically selects that space's agent. If the space has no agent, falls back to `general`.

## Tool Execution

1. LLM calls tool with JSON input
2. Parse input, extract parameter values
3. Replace `{{param}}` placeholders in command (shell-escaped)
4. Resolve working directory
5. Execute with `sh -c` and timeout
6. Return stdout+stderr

## Template: Project Space

The `project` space serves as the reference implementation:

```
project/
├── manifest.json
└── agent/
    ├── config.md              # Project-aware agent
    ├── tools/                 # (empty — uses builtins)
    ├── hooks/
    │   └── safety.json        # Block force-push in project context
    ├── skills/
    │   └── summarize.md       # Summarize project skill
    └── plugins/               # (empty)
```

Use this structure as a template when creating new spaces.
