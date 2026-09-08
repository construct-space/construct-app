1. CLAUDE.md is loaded every single turn. every. single. turn.
this is the highest leverage thing u can do and almost nobody does it properly.
most people either have nothing in their CLAUDE.md file or they wrote the whole bible in it.
the source code shows that claude code reads ur CLAUDE.md files on EVERY query iteration. not at session start. every turn. that means every time u send a message, it re-reads ur instructions.
there's a whole hierarchy:

- ~/.claude/CLAUDE.md — global (ur coding style, preferences)
- ./CLAUDE.md — project level (architecture decisions, conventions)
- .claude/rules/*.md — modular rules
- CLAUDE.local.md — private notes (gitignored)
u get 40,000 characters. that is a LOT. most people use maybe 200.
put ur architecture decisions in there. ur file conventions. ur testing patterns. ur "never do this" rules. the model reads them every single turn. this is the difference between claude code being a generic assistant and claude code being YOUR assistant that knows YOUR codebase.
if u do one thing after reading this, its this.

1. subagents share the prompt cache (parallelism is basically free)
this is the thing that blew my mind.
when claude code forks a subagent, it creates a byte-identical copy of the parent context. the API caches this. so spawning 5 agents to work on different parts of ur codebase costs barely more than 1 agent doing it sequentially.
read that again.
5 agents. same cost as 1. because they all hit the prompt cache.
most people use claude code like a single worker. one task at a time. wait for it to finish. give it the next thing.
the source code literally has three execution models for subagents:

- fork — inherits parent context, cache-optimized
- teammate — separate pane in tmux or iterm, communicates via file-based mailbox
- worktree — gets its own git worktree, isolated branch per agent
u can tell claude code to spin up 5 agents: one doing a security audit, one refactoring the auth module, one writing tests, one updating docs, one fixing bugs. all at the same time. all sharing the cache.
the architecture is BUILT for this. using it single-threaded is criminal.

1. the permission system is designed to be configured, not clicked through
every time claude code asks "allow this action?" and u click yes, that's a failure of configuration, not a feature.
the source code reveals a 5-level settings cascade:
policy > flag > local > project > user

in ~/.claude/settings.json u can set glob patterns for what's always allowed:
json
{
  "permissions": {
    "allow": [
      "Bash(npm *)",
      "Bash(git*)",
      "Edit(src/**)",
      "Write(src/**)"
    ]
  }
}

there are three permission modes:

- bypass — no permission checks at all (dangerous but fast)
- allowEdits — auto-allows file edits in ur working directory
- auto (this is new) — runs an LLM classifier on each action. this is the sweet spot.
auto mode has its own allow/deny lists u can configure. the source code shows it races multiple resolvers in parallel: user click, hook classifier, bridge, and first one to respond wins.
every time u stop to click "allow" is time wasted. configure it once. never click again.

1. there are 5 compaction strategies. context pressure is a real problem
the source code has FIVE different ways to compress ur conversation when it gets too long:
1. microcompact — time-based clearing of old tool results
1. context collapse — summarizes spans of conversation
1. session memory — extracts key context to a file
1. full compact — summarizes entire history
1. PTL truncation — drops oldest message groups
this tells u something important: context overflow is a central problem the engineers spent a LOT of time on.
what this means for u:

- use `/compact` proactively. don't wait for the system to auto-compact and lose context u care about.
- the default window is 200K tokens. but u can opt into 1M tokens by using the `[1m]` model suffix. for large refactors across many files, this matters.
- long sessions accumulate "session memory" — structured summaries of task specs, file lists, workflow state, errors, and learnings. this is why resuming a session is better than starting fresh.
- large tool results get stored to disk with only an 8KB preview sent to the model. if u paste a massive file, the model may only see a fraction. keep inputs focused.
the people getting the most out of claude code use `/compact` like a manual save point in a video game. preserve what matters, clear what doesn't, keep moving.

1. the hook system is the real extension API  (25+ lifecycle events)
this is the power-user feature that almost nobody knows about.
the source code reveals 25+ lifecycle events u can hook into:

- PreToolUse — runs before any tool executes
- PostToolUse — runs after any tool executes
- UserPromptSubmit — runs when u send a message
- SessionStart / SessionEnd — session lifecycle
- and 20+ more

with 5 types of hooks:

- command — run a shell command
- prompt — inject context via LLM
- agent — run a full agent verification loop
- HTTP — call a webhook
- function — run JS

real examples of what u can do:

- auto-run linting before every file write
- run tests after every edit
- inject relevant docs into every prompt automatically
- send a slack notification when a task completes
- validate that security patterns are followed before code ships

the `UserPromptSubmit` hook is especially crazy. u can inject `additionalContext` into every single message u send. imagine automatically attaching test output, recent git diffs, or project state to every prompt without typing it.
this is how u build a custom development environment on top of claude code. not by prompting better. by hooking into the system itself.
6. sessions are persistent and resumable (stop starting fresh)
every conversation is saved as JSONL at
~/.claude/projects/{hash}/{sessionId}.jsonl

the source code supports:

- --continue — resume ur last session
- --resume — pick a specific past session  
- --fork-session — branch from a past conversation (i personally love this)
session memory extraction preserves key context across compactions: task specs, file lists, workflow state, errors, and learnings.
most people start a new session every time they open claude code. this is like closing ur IDE and reopening it from scratch every hour. all the context about what u were doing, what failed, what u learned — gone.
use `--continue`. always. let context accumulate. let the session memory build up learnings over time. the source code literally has infrastructure for this. use it.

1. the tool system runs 60+ tools with smart batching
claude code has 60+ built-in tools. but the interesting part is HOW it runs them.
the source code partitions tool calls into two categories:

- concurrent — read-only operations (reading files, searching, globbing) run in parallel
- serial — mutating operations (edits, writes, bash commands) run one at a time
this means when claude code needs to read 10 files to understand ur codebase, it reads all 10 simultaneously. but when it needs to edit 3 files, it does them one at a time to avoid conflicts.
on top of the built-in tools, u can connect MCP servers that add more tools. the source code uses deferred loading. MCP tools only load when needed, so connecting 5 MCP servers doesn't slow down every request.
and there's ToolSearch for deferred discovery of tools the agent doesn't know about yet.
the practical takeaway: if ur workflow involves external systems (databases, cloud providers, CI/CD), connect MCP servers for them. the architecture handles the complexity. u just get more capabilities.

1. the streaming architecture means interruption is cheap
the entire pipeline uses async generators yielding individual events. pressing Escape cleanly aborts the current stream without losing previous context.
this seems small but it changes how u should use claude code.
dont wait for a response u know is going wrong. interrupt immediately and redirect. the source code is designed for this. ur previous context is preserved. the interrupted response is discarded cleanly. zero penalty.
think of it like pair programming. if ur pair starts going down the wrong path, u dont wait for them to finish. u say "actually, go this way instead." same energy.
2. the retry system is more sophisticated than u think**
the source code reveals:

- 10 retries with exponential backoff and jitter (500ms base)
- automatic OAuth token refresh on 401/403
- model fallback: if Opus fails 3 times with 529 errors, it automatically falls back to Sonnet
- 90-second idle watchdog on streams — if streaming stalls, it falls back to non-streaming
- persistent mode has infinite retry with 5-minute max backoff
this means claude code is designed to be left running. it handles API hiccups, rate limits, and outages gracefully. u dont need to babysit it. let it run in the background and come back to results.

the tldr: highest leverage actions from the source code:
• write a real CLAUDE.md → loaded every turn. 40K chars. highest leverage config.
• parallelize with subagents → fork model shares prompt cache. 5 agents ≈ cost of 1.
• configure permissions in settings.json → eliminate click fatigue forever.
• use /compact proactively → 5 compaction strategies exist because context pressure is real.
• set up hooks → 25+ events, 5 types. this is the real extension API.
• always --continue sessions → JSONL persistence + session memory = accumulated context.
• connect MCP servers → deferred loading means zero cost until used.
• interrupt freely → async generators mean zero penalty for redirecting.
part 2

the entry point is ruthlessly optimized for speed
claude code boots in milliseconds. how?
fast-path routing. simple commands like --version and --daemon get intercepted before the full app even loads. no unnecessary initialization.
parallel prefetching. while the CLI parses ur command, its already loading settings, checking auth, establishing TLS connections, and preconnecting to the API. all at the same time.
memoized initialization. expensive setup operations run once and get cached.
what u can steal: if ur AI product has a CLI or startup sequence, dont load everything upfront. fast-path the common cases. prefetch in parallel. memoize expensive ops. users notice startup time more than u think.
2. they built a custom terminal renderer from scratch
claude code doesnt use a standard terminal UI library. they built their own React-based renderer using Ink with:
a Yoga flexbox layout engine for the terminal
virtual scrolling with height caching
incremental ANSI diff output via interned screen buffers
CSI u input parsing for mouse support and text selection
they literally brought web rendering concepts to the terminal.
what u can steal: dont assume the default UI framework is good enough. if ur AI product has a unique interaction pattern (streaming responses, tool outputs, multi-agent views), invest in the rendering layer. a custom UI that handles streaming well is a massive UX advantage. most AI products have janky streaming because they didnt invest here.
3. the conversation loop is an async generator state machine
this is the core of the product. the REPL loads tools, builds the system prompt, loads context, then enters an async generator loop:
for await (event of query({messages, systemPrompt, tools}))
every event gets processed and rendered in real time. tool calls, text deltas, errors — all flowing through one unified stream.
the query engine itself is a while(true) loop that:

1. normalizes messages + compacts context
2. builds the system prompt (static + dynamic)
3. calls the model with streaming
4. collects tool_use blocks
5. executes tools
6. appends results
7. loops until end_turn
what u can steal: if ur building any AI product with tool use, this is the pattern. async generators for the event stream. a state machine loop for the agent cycle. separate "normalize context" from "call model" from "execute tools." most AI products mash these together and end up with spaghetti. anthropic separated them cleanly and it shows.
8. tool execution has smart concurrency
claude code has 60+ tools. but the clever part is how it runs them.
when the model returns multiple tool calls, the system partitions them:
concurrent batch — read-only tools (file reads, searches, globs) run in parallel
serial batch — mutating tools (edits, writes, bash) run sequentially
each tool goes through: input validation (Zod) → pre-hooks → permission check → execution → post-hooks → result truncation
what u can steal: if ur AI product uses tools, think about concurrency. read operations can parallelize safely. write operations need ordering. most AI products run everything serially and its unnecessarily slow. also: validate inputs with a schema. truncate outputs. ur model doesnt need a 50KB file in its context when 8KB would do.
9. the permission system is a multi-layer race
this is genuinely clever engineering.
when claude code needs permission for an action, it doesnt just ask the user. it races multiple resolvers in parallel:
user click (the dialog)
hook classifier (automated rules)
bash security classifier (LLM-based safety check)
bridge/web UI (external approval)
first one to respond wins. createResolveOnce pattern.
on top of that, theres a 5-level rule cascade: policy > flag > local > project > user. rules at higher levels cant be overridden by lower levels.
what u can steal: if ur AI product does anything risky (file access, API calls, data modification), build a layered permission system. dont just prompt the user every time. have configurable rules, auto-classifiers, and interactive fallbacks. the race pattern is especially smart — it means the fastest safe path always wins.
10. context management has 5 compression strategies
this is where u can tell the engineers spent months.
200K token default window. 1M opt-in. and FIVE strategies to manage overflow:
microcompact — clears old tool results based on time
context collapse — summarizes spans of conversation into shorter versions  
session memory — extracts structured context (task spec, files, learnings) to a file
full compact — summarizes entire conversation history
PTL truncation — drops oldest message groups as last resort
the system tries them in order from least lossy to most lossy. and it does it automatically when context pressure hits.
what u can steal: if ur AI product has conversations longer than a few turns, u NEED a context management strategy. most products just truncate from the top. thats the dumbest possible approach. build tiered compression. save important context to external storage. summarize before u truncate. the difference between a product that "loses context" and one that "remembers everything" is this engineering.
11. the system prompt is split into cacheable and dynamic sections
anthropic splits the system prompt into two parts:
static (cacheable): role instructions, tool guidelines, coding rules, style rules. these rarely change between turns.
dynamic (per-request): CLAUDE.md files, environment info, git status, current date, memory. these change every turn.
theres an explicit cache boundary between them. the static part gets cached by the API (1 hour TTL). the dynamic part gets rebuilt every turn.
what u can steal: if ur sending system prompts to an LLM API, split them the same way. put stable instructions first (cacheable). put dynamic context after. this dramatically reduces API costs because the cached prefix doesnt get re-processed. most AI products rebuild the entire system prompt every turn and pay full price every time.
12. subagents are designed for cache sharing
when claude code forks a subagent, it creates a byte-identical copy of the parent context. this means the forked agent hits the same prompt cache as the parent.
5 parallel agents cost barely more than 1 sequential agent.
three execution models:
fork — same process, shared cache, no recursive forking allowed
teammate — separate tmux/iterm pane, file-based mailbox communication
worktree — git worktree per agent, isolated branches
what u can steal: if ur building a multi-agent system, think about cache topology. agents that share context prefixes can share API caches. design ur agent spawning to maximize cache hits. also: file-based communication between agents is simple and robust. dont over-engineer with message queues when a JSON file in a known directory works.
13. the hook system makes it extensible without forking
25+ lifecycle events. 5 hook types (command, prompt, agent, HTTP, function). hooks can come from settings, plugins, agent frontmatter, or SDK callbacks.
PreToolUse can block or modify actions before they happen. PostToolUse can transform results. UserPromptSubmit can inject context into every message.
what u can steal: build hooks into ur AI product from day one. even if u dont use them immediately. the ability to run custom logic before/after every tool call, every message, every session — thats what turns a product into a platform. ur power users will build things on top of ur hooks that u never imagined.
14. everything is persistent and resumable
conversations saved as JSONL. session memory extracted to files. sessions can be continued, resumed, or forked.
what u can steal: persist everything. conversations, tool results, agent state. make it resumable. the cost of storage is nothing compared to the cost of lost context. most AI products treat every session as ephemeral and it kills the user experience for long-running tasks.
the bigger picture
what this architecture reveals about building AI products:
• separate ur rendering layer from ur agent logic. claude code uses React for UI and async generators for the agent loop. theyre completely decoupled. this is why they can support terminal, web bridge, and SDK interfaces from the same core.
• treat context like a managed resource. not a dump. 5 compaction strategies exist because "just send everything to the model" doesnt scale. every serious AI product will need context management eventually. build it early.
• design for parallelism from day one. tool batching, subagent forking, cache sharing. the architecture assumes multiple things happening at once. single-threaded agent loops are a dead end.
• make permissions configurable, not binary. a 5-level cascade with auto-classifiers is way more sophisticated than "allow all" or "ask every time." ur users have different risk tolerances. let them configure it.
• hooks > plugins > hardcoded features. the most extensible part of claude code isnt any single feature. its the hook system that lets anyone add features without touching the core.
• cache-aware architecture saves money. splitting system prompts into static/dynamic, sharing caches across subagents, using ephemeral markers. these are cost optimizations baked into the architecture. at scale this is the difference between profitable and bankrupt.

Claude Code’s memory system is actually insanely well-designed. It isn't like  “store everything” but constrained, structured and self-healing memory.

The architecture is doing a few very non-obvious things:

> Memory = index, not storage

- MEMORY.md is always loaded, but it’s just pointers (~150 chars/line)
- actual knowledge lives outside, fetched only when needed

> 3-layer design (bandwidth aware)

- index (always)
- topic files (on-demand)
- transcripts (never read, only grep’d)

> Strict write discipline

- write to file → then update index
- never dump content into the index
- prevents entropy / context pollution

> Background “memory rewriting” (autoDream)

- merges, dedupes, removes contradictions
- converts vague → absolute
- aggressively prunes
- memory is continuously edited, not appended

> Staleness is first-class

- if memory ≠ reality → memory is wrong
- code-derived facts are never stored
- index is forcibly truncated

> Isolation matters

- consolidation runs in a forked subagent
- limited tools → prevents corruption of main context

> Retrieval is skeptical, not blind

- memory is a hint, not truth
- model must verify before using

> What they don’t store is the real insight

- no debugging logs, no code structure, no PR history
- if it’s derivable, don’t persist it

 SOMEONE has extracted skills from the source code  and put them in a public repo here:

 <https://github.com/chatgptprojects/clear-code>

SOMEONE has also done a human evaluation of the code and documented it here:
<https://github.com/sanbuphy/learn-coding-agent>
