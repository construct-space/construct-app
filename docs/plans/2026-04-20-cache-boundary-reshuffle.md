# Cache Boundary Reshuffle

## Idea

The operator's system prompt is split into a cacheable static prefix and a per-turn dynamic suffix (`<!-- cache_boundary -->`), but today the boundary is drawn in the wrong place: **project instruction files, the skills index, and project metadata sit on the dynamic side even though they almost never change within a session.** Each turn re-bills those tokens instead of hitting the Anthropic prompt cache.

Move anything that is "stable for the life of the session" into the static prefix. Keep only genuinely per-turn data (UI state, file tracker, session memory, matched skill bodies) on the dynamic side.

## Goal

Measurable reduction in per-turn input token cost and first-token latency on turns 2..N of any session.

Target: static-prefix cache hit rate above 90% after turn 1, and a ≥30% drop in average input tokens billed per turn for sessions longer than 3 turns.

## Requirements

- No behavioral change visible to the user — same prompt content, same ordering conventions.
- Existing sessions must keep working; no on-disk format change.
- Must degrade gracefully if an instruction file is edited mid-session (cache key invalidates, next turn rebuilds — acceptable).
- Add a tiny telemetry hook so we can see the before/after cache hit rate.

## What Moves

**Today — dynamic suffix** (see Explore report 2026-04-20):

| Component | Change | Why |
|-----------|--------|-----|
| Project metadata (`## Project Context`) | → static | Doesn't change within a session |
| Instruction files (CONSTRUCT.md, CLAUDE.md, agents.md, AGENTS.md, .local.md siblings, `.construct/rules/*.md`) | → static | User edits are rare; invalidate on edit is fine |
| Skills index (`## Available Skills`) | → static | Agent-level, stable per session |
| Environment info (date, platform, cwd) | → static | Stable within a session boot |

**Stays dynamic** (genuinely per-turn):

- File tracker summary (grows each turn)
- Session memory (only on resume, arguably static but read-once)
- Active UI Context + Runtime Context (UI state, selection, vibe session)
- Matched skill bodies (task-dependent)
- Git status sub-fields that actually shift (branch, dirty count) — **split the current env block**: static part (platform, date, project root, cwd) vs. dynamic part (git branch+dirty+ahead/behind).

## Architecture

### Assembly Pipeline

Rewrite `buildSystemWithContextAndState()` in `operator/internal/runner/system_prompt.go` to produce two explicit strings rather than one blob with a marker:

```go
type SystemPrompt struct {
    Static  string // cacheable prefix: base prompt + sections + morpheus +
                  // project meta + instruction files + skills index + env-static
    Dynamic string // per-turn: git dynamics + UI/runtime + file tracker +
                  // session memory + matched skill bodies
}
```

`SplitSystemPrompt()` (`system_prompt_cache.go`) goes away — no more marker detection. The provider layer already supports passing a cache-breakpoint between two system messages; wire the boundary there instead of in the text.

### Cache Invalidation

Instruction files are the tricky case — user can edit CLAUDE.md mid-session. Options:

- **A. Hash the static prefix once at session start; do not re-read.** Simple; requires session restart to pick up edits. Matches today's behavior closely.
- **B. Stat the instruction files each turn; rebuild static if mtime changed.** Invalidates cache on the first turn after edit, re-caches from there. Small filesystem cost.

Recommend **B**. One mtime check per file is cheap and user edits do happen.

### Ordering Inside Static Prefix

Keep today's visual ordering so the assembled prompt looks the same:

1. Agent base prompt (`prompt.md`)
2. System sections (role, tool hierarchy, output efficiency)
3. Morpheus (if enabled)
4. `## Project Context` (metadata)
5. `## Environment` (static half: platform, date, cwd, project root)
6. Instruction files (in priority order)
7. `## Available Skills` (one-line index)

### Dynamic Suffix Ordering

1. `## Environment (current)` (git branch, dirty count, ahead/behind, last commit)
2. `## Active UI Context` (if populated)
3. `## Runtime Context` (if populated)
4. Session memory (if resume)
5. File tracker summary
6. Matched skill bodies

## Out of Scope

- Instruction-file size caps → separate plan.
- Skill matcher precision → separate plan.
- Adding project layout / package-manifest summary to the prefix → separate plan.
- Dedup between Project/Runtime/UI context blocks → separate plan.

Those four combine naturally in a follow-up "context-quality" plan after this lands.

## Milestones

1. **M1 — Plumbing.** Introduce `SystemPrompt{Static, Dynamic}` struct + thread it through `runner` and provider layer. Boundary comes from struct split, not from marker. No content change yet. Tests: existing prompt tests keep passing; snapshot test for static+dynamic pair.
2. **M2 — Move project meta + env static half.** Verify downstream (LLM behavior, streaming, replay) unchanged.
3. **M3 — Move instruction files.** Implement mtime-based invalidation. Unit-test the invalidation: edit a file between two `build()` calls, assert static hash changes.
4. **M4 — Move skills index.** Matched skill bodies stay dynamic.
5. **M5 — Telemetry.** Log per-turn: `static_bytes`, `dynamic_bytes`, `cache_hit` (as reported by provider). Roll up per-session.
6. **M6 — Measure.** Run a canned 10-turn session before and after on a real project; report input-token delta.

## Tradeoffs

- **Cache key is now opaque to the reader.** Today someone can look at the assembled prompt and see exactly where the boundary sits (marker is visible in debug dumps). After this, debugging requires inspecting the struct. Mitigation: keep the marker in debug-mode dumps (`DEBUG_PROMPT=1`).
- **Mtime invalidation can spuriously miss.** If a file is edited within the mtime resolution window, we might not detect it. Acceptable — worst case one turn uses stale content, next turn catches it via read. If anyone reports it, switch to hash-based invalidation (read the file, compare sha).
- **Provider support required.** Anthropic's cache breakpoint API accepts the split; verify the OpenAI/local paths handle a two-part system prompt cleanly. Fallback: concatenate for providers that don't cache.

## Open Questions

- Does session memory belong in static or dynamic? It's read once at resume but doesn't change after. Leaning dynamic because cache is keyed per-session anyway, so it'd add a per-session variant of the static prefix — same effect, less invariant.
- Should the matched-skill bodies be hoisted into static when the matcher is deterministic for a session? Defer until skill-matching plan lands.
- Where does per-profile config (org-managed settings) live? Currently not in the prompt; if we ever add it, it's static-per-session.

## Open File Pointers

- `operator/internal/runner/system_prompt.go` — `buildSystemWithContextAndState()`
- `operator/internal/runner/system_prompt_cache.go` — boundary marker + `SplitSystemPrompt()` (to remove)
- `operator/internal/runner/system_prompt_sections.go` — static-half env + system sections
- `operator/internal/runner/run_setup.go` — skills index + matched-skill body assembly
- `operator/internal/provider/` — cache-breakpoint wiring per provider
- `operator/internal/builder/builder.go`, `operator/internal/spacedev/spacedev.go` — per-agent base prompt entry points
