# brain

The agent sidecar. Runs the prompt loop, tools, skills, and providers. Built to
`desktop/bin/construct-brain-<target>` via `bun run brain:build` from the repo
root; the desktop shell spawns it as a Tauri sidecar.

## Agent resolution (which system prompt runs)

`handlePrompt` (wire_prompt.go) picks the system prompt in this order:

1. **`pl.System`** if the caller already supplied a full prompt.
2. **Built-in agent** by `pl.AgentID` from the embedded registry
   (`agents.LoadBuiltin`, `//go:embed builtin/*/prompt.md`). `construct` is the
   primary one.
3. **Per-space agent** — if the id isn't a built-in **and** `pl.SpaceID` is set,
   brain fetches that installed space's `agent/config.md` over the
   **`space.agent`** bridge method and runs it as the prompt
   (`agents.FromMarkdown`). This is how a Space (Calendar, Drive, …) gets its
   *own* scoped identity, "what can you do" answer, and `maxIterations` instead
   of the generic built-in.
4. **Fallback** — any miss/error at step 3 falls through to the built-in
   `construct` agent, so the worst case is the generic prompt, never a failure.

### The `space.agent` bridge

- Brain: `fetchSpaceAgentPrompt` → `bridge.Call("space.agent", {space_id})`.
  The method is allowlisted in `bridge/hostBridgeMethod` (group 2: routes to the
  main window, where the space registry lives).
- Frontend: `bridgeListener.handleSpaceAgent` reads `agent/config.md` from the
  installed `<id>.space` bundle via the loader's `SpaceSource` (zip or dir) and
  returns `{ markdown }`.

Note: a space's actions are injected separately (`space.list_actions` →
`fetchSpaceActionsSection`), so even when the built-in prompt runs, the agent
can still call that space's actions. The built-in `construct` prompt also has a
"match the surface you're on" rule so capability answers stay scoped when a
space's actions are present — a belt-and-suspenders layer under the per-space
prompt above.

Editing `builtin/*/prompt.md` requires a brain rebuild (`bun run brain:build`)
since prompts are embedded; a frontend reload alone won't pick it up.
