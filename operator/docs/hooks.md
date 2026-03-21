# Hooks

Hooks are live and run around every tool execution path in the operator runtime.

That includes:

- tool calls initiated by the LLM inside `runner.Run()`
- direct `tool.*` requests
- direct `tools.call` requests

## Sources

Operator registers hooks from four places:

- built-in safety hooks created at startup
- hooks loaded from spaces
- user hooks from `CONSTRUCT_DATA_DIR/hooks.json`
- plugin-provided hooks

Enable/disable state is persisted in `CONSTRUCT_DATA_DIR/state/hook-states.json`.

## Types

| Type | When | Can block |
|------|------|-----------|
| `pre_tool` | before a tool executes | yes |
| `post_tool` | after a tool executes | no |

## Matching Rules

A hook can limit itself by:

- `Tools`: exact tool names or glob patterns
- `Patterns`: matched against the raw tool input plus parsed `path` / `file_path` fields when the input is JSON

Empty `Tools` means "all tools".

## Execution Semantics

### Pre-hooks

- all matching pre-hooks run in priority order
- execution stops early only if a hook returns a blocking result
- non-blocking results do not suppress later matching hooks

### Post-hooks

- all matching post-hooks run
- post-hooks never block tool execution retroactively

Both paths collect basic metrics exposed through `hooks.metrics`.

## Execution Model

A hook can be either:

- a Go-native `Check` function
- a shell command

Go-native checks are used for built-in safety hooks. External commands are run through the platform shell:

- macOS/Linux: `sh -c`
- Windows: `cmd /c`

Non-zero exit status from a shell hook is treated as a blocking result for pre-hooks.

If a hook prints JSON shaped like this, operator uses it as structured output:

```json
{
  "block": true,
  "message": "reason"
}
```

Otherwise any non-empty stdout/stderr is treated as the hook message.

## Hook Environment

Shell hooks receive these variables:

- `HOOK_TYPE`
- `TOOL_NAME`
- `TOOL_INPUT` for pre-hooks
- `TOOL_OUTPUT` for post-hooks
- `CONSTRUCT_PROJECT_ROOT` when a project root is available for the current client

Plugin-backed hooks also receive `HOOK_RPC_REQUEST`, a JSON-RPC payload prepared by operator so user input does not get interpolated into the shell command.

## Built-in Safety Hooks

The runtime currently installs two built-ins:

- `safety-project-boundary`: blocks `write_file` and `edit_file` outside the active project root
- `safety-destructive-commands`: blocks obviously destructive `bash` commands

These are pure Go checks and do not shell out.
