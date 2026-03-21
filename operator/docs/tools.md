# Tools

Tools are capabilities the LLM can invoke during the agent loop.

## Interface

```go
type Executor interface {
    Execute(ctx context.Context, input string) (*Result, error)
}

type Tool struct {
    Def      provider.ToolDef  // Name, description, JSON schema
    Executor Executor          // How to run it
    Source   string            // builtin, space:<id>, mcp:<id>, skill:<id>
}
```

## Registry

Tools are stored in a `Registry`. The runner filters them per-agent based on `allowedTools` / `blockedTools`.

```go
r := tool.NewRegistry()
tool.RegisterBuiltins(r, workDir)

// Filter for specific agent
agentTools := r.ForAgent(agent.Tools, agent.BlockTools)
```

**Filtering logic:**
- If `blockedTools` is set → exclude those
- If `allowedTools` is set → only include those
- Both empty → all tools available

## Built-in Tools (7)

### read_file
Read file contents with line numbers.
```json
{ "path": "src/main.go" }
```

### write_file
Write content to file. Creates parent directories.
```json
{ "path": "src/new.go", "content": "package main\n..." }
```

### edit_file
Replace exact string match in file. Fails if match is not unique.
```json
{ "path": "src/main.go", "old_string": "foo", "new_string": "bar" }
```

### bash
Execute shell command. Returns combined stdout+stderr.
```json
{ "command": "go build ./..." }
```

### glob
Find files matching pattern using `doublestar` glob.
```json
{ "pattern": "**/*.go" }
```

### grep
Search file contents using ripgrep.
```json
{ "pattern": "func main", "path": ".", "glob": "*.go" }
```

### list_dir
List directory contents with type indicators (/ for dirs).
```json
{ "path": "src/" }
```

**Path resolution:** Relative paths resolved against `workDir`. Absolute paths used as-is.

## Space Tools

Loaded from `spaces/{id}/agent/tools/*.md`. See [spaces.md](spaces.md).

Each space tool is a shell command with parameter substitution:
- Namespaced: `space-{spaceID}-{toolID}`
- Parameters: `{{param}}` placeholders in command
- Shell-escaped to prevent injection
- Timeout: configurable (default 30s)
- Workdir: `project`, `home`, or absolute path

## Tool Sources

| Source | Example | Loaded From |
|--------|---------|-------------|
| `builtin` | read_file, bash | `tool.RegisterBuiltins()` |
| `space:design` | space-design-scaffold | `agent/tools/*.md` |
| `mcp:filesystem` | mcp-fs-read | MCP server (stub) |
| `skill:git` | skill-git-commit | Skill bundle (stub) |
