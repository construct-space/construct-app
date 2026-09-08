# Space Tool API — `useSpaceTool`

**Status:** accepted v1 contract.

## Bundle Shape

Dynamic spaces are installed as one `<id>.space/` directory. First-party native
tool CLIs live under `tools/<platform>/`; third-party helper executables live
under `lib/<platform>/`.

```text
mail.space/
  manifest.json
  app.iife.js
  style.css
  SKILL.md
  agent/config.md
  tools/darwin-arm64/mail-tools
  tools/windows-x64/mail-tools.exe
  lib/darwin-arm64/ffmpeg
  lib/windows-x64/ffmpeg.exe
  checksums.json
```

Root `tools.go` is optional source. `construct build` compiles it into
`dist/<id>.space/tools/<platform>/<id>-tools`. Local builds default to the
current platform; marketplace builds set `CONSTRUCT_TOOL_TARGETS=all`.

## Runtime Env

When Construct invokes a space tool, it resolves:

```text
<profile>/spaces/<id>.space/tools/<platform>/<name>
```

The child process receives a scrubbed environment:

- `SPACE_DIR` = installed `<id>.space`
- `SPACE_TOOLS` = `tools/<platform>`
- `SPACE_LIB` = `lib/<platform>`
- `SPACE_LIB_ROOT` = `lib`
- `CONSTRUCT_SPACE_ID` = space id
- `CONSTRUCT_PLATFORM` = `darwin-arm64`, `linux-x64`, etc.
- `PATH` = `SPACE_LIB:SPACE_TOOLS:<host PATH>`

That keeps tools simple:

```go
cmd := exec.Command("ffmpeg", "-version")
cmd.Stdout = os.Stdout
cmd.Stderr = os.Stderr
_ = cmd.Run()
```

## SDK Surface

```ts
import { useSpaceTool } from '@construct-space/sdk'

const tool = useSpaceTool('mail-tools')
const result = await tool.invoke(['index', '--account', accountId], {
  timeoutMs: 120_000,
})
```

`result` contains `{ stdout, stderr, code, timedOut, stdoutTruncated,
stderrTruncated }`.

## Deferred

- Shared per-user dependency cache for common helpers such as ffmpeg. v1 keeps
  spaces self-contained.
- First-run consent UI and hash-pinned approvals.
- OS-level syscall sandbox. Path control, env scrubbing, output caps, and
  timeout caps exist today; full syscall isolation is tracked separately.
