# Coder Intelligence Upgrade — Replicate Claude Code Capabilities

**Date:** 2026-04-03
**Status:** Planned
**Priority:** High

## Goal

Make the Coder agent as capable as Claude Code by adding missing tools, improving the system prompt, and adding skill-like behavior.

## Gap Analysis (Claude Code vs Construct Coder)

### Tools We Need (Priority Order)

| Tool | Claude Code | Construct | Priority | Notes |
|------|-------------|-----------|----------|-------|
| **TodoWrite** | Structured task tracking in conversation | `tasks` (basic) | HIGH | Track multi-step work, show progress |
| **WebSearch** | Search the web | Missing | HIGH | Research APIs, docs, packages |
| **AgentTool** | Spawn subagents | `coordinate` (basic) | HIGH | Parallel independent tasks |
| **Plan mode** | EnterPlanMode/ExitPlanMode | Missing | MEDIUM | Think before coding |
| **ToolSearch** | Discover available tools | Missing | MEDIUM | Agent self-awareness |
| **SendMessage** | Cross-agent messaging | Missing | MEDIUM | Multi-agent coordination |
| **REPL** | Interactive code execution | Missing | MEDIUM | Test snippets without bash |
| **LSP** | Language server queries | Have LSP infra, no tool | MEDIUM | Type info, go-to-def |
| **Worktree** | Git worktree isolation | Missing | LOW | Safe branching |
| **Sleep** | Wait between operations | Missing | LOW | Polling, rate limits |
| **Schedule/Cron** | Timed tasks | Missing | LOW | Background automation |
| **PowerShell** | Windows shell | Missing | LOW | Cross-platform |

### System Prompt Improvements

Claude Code's prompt has sections we should adopt:

1. **"Executing Actions with Care"** — reversibility, blast radius, confirmation
2. **"Output Efficiency"** — go straight to the point, no filler
3. **"Using Tools"** — prefer dedicated tools over bash
4. **"Tone & Style"** — no emojis, file:line references
5. **"Git Safety"** — never force push, never amend without asking
6. **Environment injection** — CWD, platform, model name, date

### Skills System

Claude Code has a skill loading system. Our coder already has skills via the operator's skill registry. We need to verify:
- Skills load on trigger match ✓ (verified in this session)
- Skills show in UI as "Using Skill('name')" (partially done — event emitted, not rendered)

## Implementation Phases

### Phase 1: System Prompt (immediate)
- Adopt Claude Code's prompt structure for the coder agent
- Add "Executing Actions with Care" section
- Add "Git Safety Protocol"  
- Add "Output Efficiency" rules
- Inject environment info (CWD, date, model, platform)

### Phase 2: Tool Improvements (week 1)
- **Improve `tasks` tool** → TodoWrite-like structured tracking
- **Add `web_search` tool** → web search via API
- **Add `tool_search` tool** → list available tools with descriptions
- **Improve `coordinate` tool** → proper agent spawning with context

### Phase 3: Agent Intelligence (week 2)
- **Plan mode** → structured planning before execution
- **REPL tool** → interactive code execution
- **LSP tool** → type info, diagnostics, go-to-definition
- **Skill UI** → show "Using Skill('name')" in conversation

### Phase 4: Safety & Polish (week 3)
- **Worktree isolation** → safe branch work
- **Git safety** → prevent destructive operations
- **Error recovery** → smart retry with error reading
- **Progress tracking** → show turn count, cost, token usage

## Key Files

| Area | File |
|------|------|
| Coder agent config | `frontend/spaces/coder/agent/config.md` |
| System prompt builder | `operator/internal/runner/system_prompt.go` |
| Tool registry | `operator/internal/tool/module.go` |
| Tool implementations | `operator/internal/tool/builtin_*.go` |
| Skill registry | `operator/internal/skill/registry.go` |
| Stream events | `operator/internal/stream/event.go` |
| Runner loop | `operator/internal/runner/runner.go` |

## Reference

Claude Code source: `/Users/flakerim/Downloads/claude-code-source-code-main/`
Claude Code CLAUDE.md: `/Users/flakerim/Downloads/claude-code-source-code-main/CLAUDE.md`
