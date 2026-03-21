# Memory Management Patterns for AI Agent Systems

Research for Construct Operator's memory subsystem. Covers four systems: mem0, Letta (MemGPT), OpenClaw community patterns, and Claude Code's file-based memory.

---

## 1. mem0 -- Memory Layer for AI Agents

**Source:** https://github.com/mem0ai/mem0

### Storage

- **Dual-layer architecture**: vector store + graph database working together.
- **Vector store** (default: Qdrant on-disk at `/tmp/qdrant`): stores embedded memory facts with cosine similarity search. Supports 19 backends in Python: Qdrant, Chroma, PGVector, Pinecone, Milvus, MongoDB, Redis, Elasticsearch, FAISS, Supabase, Weaviate, and more.
- **Graph database**: stores entity-relationship triples extracted from conversations. Enables contextual relationship queries that pure vector search misses (e.g., "who does Alice work with?").
- **History database** (SQLite at `~/.mem0/history.db`): audit trail of all memory mutations with previous values preserved.
- **Embeddings**: default `text-embedding-3-small` (1536 dims), configurable to any provider.

### Memory Categories

mem0 classifies memories into four types:
- **Working memory** -- short-term session awareness
- **Factual memory** -- structured knowledge ("user prefers dark mode")
- **Episodic memory** -- past conversation summaries
- **Semantic memory** -- general domain knowledge

Also supports **procedural memory** for agent workflows -- bypasses standard fact extraction and generates workflow summaries instead.

### Retrieval

- **Semantic search**: embed query, cosine similarity against vector store, optional minimum score threshold.
- **Graph traversal**: follow entity relationships for contextual retrieval.
- **Metadata filtering**: comparison operators (`eq`, `ne`, `gt`, `in`), logical operators (`AND`, `OR`, `NOT`), wildcard and substring matching.
- **Reranking**: optional post-retrieval cross-encoder reranking.
- **Session scoping**: all queries require at least one of `user_id`, `agent_id`, or `run_id` -- prevents cross-session contamination.

### Update / Lifecycle

The add flow is the most interesting part:

1. Messages are normalized to `[{role, content}]` format.
2. An LLM extracts key facts from the conversation.
3. Each fact is embedded and matched against existing memories (top 5 by similarity).
4. Duplicates are consolidated by ID.
5. The LLM decides an action for each: **ADD**, **UPDATE**, **DELETE**, or **NONE**.
6. Vector and graph operations execute in parallel via `ThreadPoolExecutor`.

Updates preserve the original `created_at` timestamp, re-embed the content, and record the change in the history DB. Deletions are soft -- marked in history, removed from vector store.

Memory expiration is supported via configurable TTLs and timestamp-based queries.

### Key Patterns Worth Adopting

- **LLM-in-the-loop for deduplication**: don't just do vector similarity -- have an LLM decide if a new fact updates, replaces, or is distinct from existing memories. This prevents memory bloat.
- **Dual storage (vector + graph)**: vector for "find similar", graph for "find related". Both are needed for a complete memory system.
- **Session-scoped isolation**: mandatory scoping prevents memory leakage between users/agents.
- **Audit trail**: every mutation recorded with before/after values.

---

## 2. Letta (formerly MemGPT) -- Stateful Agent Memory

**Source:** https://github.com/Letta-AI/letta | Paper: https://arxiv.org/abs/2310.08560

### Core Concept: OS Virtual Memory Analogy

Letta's fundamental insight: treat the LLM context window like RAM, and external storage like disk. The agent manages its own memory through tool calls, moving data between tiers -- just like an OS manages virtual memory with page swaps.

### Storage -- Three-Tier Memory Hierarchy

**Tier 1: Core Memory (In-Context Blocks)**
- Structured, labeled blocks pinned directly into the context window.
- Each block has: `label`, `value` (string content), `description`, `limit` (char cap), `read_only` flag.
- Default blocks: `persona` (agent identity) and `human` (user info), each with a character limit.
- Agents can edit their own core memory through tool calls (`core_memory_append`, `core_memory_replace`).
- Blocks stored in a database with unique IDs, compiled into the prompt at inference time.
- Supports Jinja templating for prompt formatting.
- **Shared blocks**: multiple agents can read/write the same block -- enables collaborative memory.

**Tier 2: Archival Memory (External Knowledge)**
- Processed, indexed knowledge in a vector database.
- Agents insert/search archival memory through dedicated tools.
- Not automatically loaded -- agent must explicitly query it.
- Used for knowledge that doesn't need to be in every prompt but should be retrievable.

**Tier 3: Recall Memory (Conversation History)**
- Complete interaction history stored on disk.
- Automatically captured -- no agent action needed.
- Searchable when needed, but not in the active context unless retrieved.

**Message Buffer (Working Context)**
- Most recent messages in the conversation thread.
- When buffer exceeds capacity: ~70% of older messages are evicted.
- Evicted messages undergo recursive summarization -- older content has progressively less influence.
- Summaries are stored and available for future reference.

### Retrieval

- Core memory: always in context, zero retrieval cost.
- Archival memory: agent calls search tools, vector similarity lookup.
- Recall memory: searchable conversation history, keyword/semantic.
- The agent decides what to retrieve -- it has agency over its own memory.

### Update / Lifecycle

- **Self-managed**: the agent decides when to update its core memory, archive important info, or search for past context. This is fundamentally different from systems where memory is managed externally.
- **Sleep-time compute**: asynchronous background agents consolidate and reorganize memory during idle periods. This separates memory quality from response latency.
- **Context eviction**: when the message buffer fills, automatic summarization compresses old messages. Recursive summarization means very old content becomes increasingly compressed.
- **All state persisted**: messages, tool calls, reasoning, memory mutations -- everything written to database. Nothing lost on context eviction.

### Key Patterns Worth Adopting

- **Agent-managed memory**: let the agent decide what's important enough to remember. Don't try to extract and store everything automatically.
- **Tiered memory with different access costs**: some things should always be in context (core), some should be searchable (archival), some should just be logged (recall).
- **Sleep-time consolidation**: process and organize memories asynchronously, not during active conversation. Improves both latency and memory quality.
- **Shared memory blocks**: enable multi-agent collaboration through shared state.
- **Recursive summarization for eviction**: don't just drop old messages -- compress them progressively.

---

## 3. OpenClaw Community Patterns

**Sources:** github.com/jzOcb/openclaw-memory-management, github.com/CortexReach/memory-lancedb-pro

### Storage -- File + Vector Hybrid

The OpenClaw ecosystem shows two complementary approaches:

**File-based (openclaw-memory-management)**
Four-layer storage with priority-based TTLs:
1. **MEMORY.md** ("Hot Memory"): loaded every session, capped at 200 lines. Contains active P0/P1/P2 entries.
2. **lessons/*.jsonl**: structured lessons in JSONL, semantic-searchable.
3. **archive/**: expired content, searchable but not auto-loaded.
4. **YYYY-MM-DD.md**: daily raw logs for reference.

Priority levels with TTLs:
- **P0 (Core Identity)**: never expires. User preferences, safety rules.
- **P1 (Active Projects)**: 90-day TTL. Current initiatives, recent decisions.
- **P2 (Temporary)**: 30-day TTL. Debugging notes, one-time events.

**Vector-based (memory-lancedb-pro)**
LanceDB-backed with hybrid retrieval:
- **L0/L1/L2 layered storage**: single-sentence indices -> structured summaries -> full narratives. Optimizes retrieval speed vs. information density.
- **Hybrid search**: Vector ANN + BM25 full-text, fused with cross-encoder reranking. BM25 matches get a 15% boost in the fusion score.
- **Multi-scope isolation**: memories segregated across global, agent, user, and project scopes.

### Retrieval

- **Hybrid retrieval (Vector + BM25)**: queries run through both embedding-based ANN and full-text BM25 simultaneously, then scores are fused with weighted merging.
- **Cross-encoder reranking**: post-fusion reranking for precision.
- **Tiered access**: hot memory loaded automatically, archival searched on demand.

### Update / Decay

- **Weibull decay engine**: memory salience adjusted based on recency, access frequency, and importance. Frequently-accessed memories are promoted; stale content fades naturally.
- **Automatic archiving**: `memory-janitor.py` runs daily via crontab, migrating expired entries to archive. Keeps hot memory lean (reduced from 427 to 96 lines -- 78% token reduction).
- **Smart extraction**: LLM-powered 6-category extraction (profiles, preferences, entities, events, cases, patterns) with two-stage deduplication.

### Key Patterns Worth Adopting

- **Priority-based TTLs**: not all memories are equal. Core identity never expires, project context lives for months, debugging notes for weeks.
- **Hot/warm/cold tiering**: always-loaded vs. searchable vs. archived. Critical for token budget management.
- **Automatic janitor**: scheduled cleanup prevents memory bloat without manual intervention.
- **Weibull decay**: mathematically principled relevance decay based on recency + access frequency + importance.
- **Hybrid retrieval (vector + BM25)**: semantic search misses exact matches; keyword search misses semantic similarity. Use both.

---

## 4. Claude Code -- File-Based Project Memory

**Source:** `~/.claude/` directory structure, CLAUDE.md files

### Storage

Claude Code uses a pure file-based memory system:

- **`~/.claude/CLAUDE.md`**: global user instructions. Flat markdown, loaded for every session across all projects. Contains user preferences, project-specific configs, workflow rules.
- **`~/.claude/projects/{path-encoded}/`**: per-project directory. Path is the filesystem path with `/` replaced by `-`.
  - **`memory/MEMORY.md`**: project-specific memory index, linking to topic files.
  - **`memory/{topic}.md`**: structured memory files with YAML frontmatter (name, description, type).
  - **`{session-uuid}.jsonl`**: full conversation history per session, stored as JSON lines.
  - **`{session-uuid}/subagents/*.meta.json`**: metadata about sub-agent invocations within a session.
- **`~/.claude/settings.json`**: permissions, plugins, behavior config.
- **`~/.claude/history.jsonl`**: global conversation history.
- **`~/.claude/plans/`**: stored execution plans.
- **`~/.claude/todos/`**: task tracking.

### Retrieval

- **Always-loaded**: CLAUDE.md files (global + project) injected into every conversation as system context. No search needed -- they're always present.
- **Session history**: previous conversations stored as JSONL but not automatically loaded. The user (or a new session) doesn't get previous session context unless explicitly referenced.
- **No semantic search**: purely file-based, no embeddings, no vector store. Relies on the user and the agent manually referencing relevant context.

### Update / Lifecycle

- Memory files are manually curated -- either by the user editing CLAUDE.md or by the agent writing to memory files when instructed.
- Session histories accumulate indefinitely (no decay, no summarization).
- No automatic deduplication or conflict resolution.

### Key Patterns Worth Adopting

- **Always-in-context project instructions**: some memories should always be loaded, period. Don't make the system search for project conventions every time.
- **YAML frontmatter for memory metadata**: structured headers (name, description, type) on otherwise freeform content.
- **Path-encoded project isolation**: simple, filesystem-native project scoping without a database.
- **Separation of instructions vs. history**: CLAUDE.md (curated knowledge) is separate from session JSONL (raw history). These serve different purposes and should be stored differently.

---

## Synthesis: Patterns for Construct Operator

Based on the research above, here are the patterns we should adopt for the Operator's memory subsystem.

### 1. Three-Tier Memory Architecture

```
Tier 1: Core Memory (always in context)
  - Project config, user preferences, active instructions
  - Equivalent to Letta's core memory blocks + Claude Code's CLAUDE.md
  - Stored as structured blocks with labels and character limits
  - Agent can self-edit via tools

Tier 2: Searchable Memory (retrieved on demand)
  - Past decisions, learned patterns, entity relationships
  - Equivalent to Letta's archival memory + mem0's vector+graph store
  - Stored in vector DB (embeddings) + optional graph DB (relationships)
  - Retrieved via hybrid search (vector + BM25 + graph traversal)

Tier 3: Raw History (logged, rarely accessed)
  - Full conversation transcripts, tool call logs
  - Equivalent to Letta's recall memory + Claude Code's JSONL
  - Stored as append-only logs
  - Searchable but never auto-loaded
```

### 2. Memory Lifecycle

```
Ingest -> Extract -> Deduplicate -> Store -> Decay -> Archive -> Delete

1. INGEST: conversation messages arrive
2. EXTRACT: LLM identifies key facts, preferences, decisions
3. DEDUPLICATE: compare against existing memories (vector similarity + LLM judgment)
4. STORE: write to appropriate tier with metadata (user_id, project_id, timestamps)
5. DECAY: Weibull decay adjusts salience based on recency + access frequency + importance
6. ARCHIVE: janitor moves expired/low-salience memories to cold storage
7. DELETE: hard delete after archive TTL expires (configurable)
```

### 3. Priority-Based Retention (from OpenClaw)

| Priority | Description | TTL | Examples |
|----------|-------------|-----|----------|
| P0 | Core identity | Never expires | User preferences, project conventions, safety rules |
| P1 | Active context | 90 days | Current sprint decisions, recent architecture choices |
| P2 | Temporary | 30 days | Debugging notes, one-off instructions |
| P3 | Ephemeral | Session only | Current task working state |

### 4. Hybrid Retrieval Pipeline

```
Query -> [Embed] -> [Vector ANN Search]  -|
      -> [Tokenize] -> [BM25 Search]     -|-> Score Fusion -> Rerank -> Filter -> Return
      -> [Entity Extract] -> [Graph Walk] -|
```

- Vector search for semantic similarity
- BM25 for exact keyword matches
- Graph traversal for entity relationships
- Weighted score fusion (configurable weights)
- Cross-encoder reranking for precision
- Metadata filtering (user scope, project scope, time range)

### 5. Agent Self-Management (from Letta)

Give the agent tools to manage its own memory:
- `memory_store(content, priority, scope)` -- explicitly save something
- `memory_search(query, scope, limit)` -- search past memories
- `memory_update(id, new_content)` -- modify existing memory
- `memory_delete(id)` -- remove a memory
- `core_memory_edit(block, operation, content)` -- edit always-in-context blocks

The agent decides what's worth remembering. External extraction (mem0-style) handles what the agent misses.

### 6. Sleep-Time Consolidation (from Letta)

Between sessions or during idle time:
- Background process reviews recent memories
- Consolidates duplicates and near-duplicates
- Promotes frequently-accessed P2 memories to P1
- Demotes stale P1 memories to P2
- Updates summaries and relationship graphs
- Reorganizes core memory blocks for coherence

### 7. Scoping and Isolation

Every memory operation scoped by:
- `user_id` -- per-user isolation
- `project_id` -- per-project isolation
- `agent_id` -- per-agent isolation (if multi-agent)
- `session_id` -- for session-specific working memory

Cross-scope queries possible but explicit (e.g., "search all projects for this user").

### 8. Recommended Tech Stack

| Component | Recommendation | Rationale |
|-----------|---------------|-----------|
| Vector DB | **Qdrant** (self-hosted) or **PGVector** (if already using Postgres) | Qdrant: best performance, easy self-host. PGVector: fewer moving parts if Postgres is already in the stack. |
| Graph DB | **Neo4j** or embedded graph in Postgres (Apache AGE) | Entity relationships, "who/what is related to X" queries |
| Embeddings | `text-embedding-3-small` (1536d) or local model via Ollama | Balance of quality and cost |
| Full-text search | **PostgreSQL FTS** or **Tantivy** (Rust) | BM25 keyword matching for hybrid retrieval |
| History store | **Append-only JSONL** or **PostgreSQL JSONB** | Raw conversation logs, audit trail |
| Core memory | **Structured blocks in PostgreSQL** | Always-loaded, agent-editable, versioned |

### 9. What NOT to Do

- **Don't store everything in vectors**: not all memory needs embedding. Structured data (preferences, configs) should be in structured storage.
- **Don't skip deduplication**: without it, memory bloats fast. Use LLM judgment, not just vector similarity thresholds.
- **Don't make all memory agent-managed**: some extraction should happen automatically (mem0-style). Agents forget to save things.
- **Don't ignore decay**: memories without TTLs or decay accumulate forever. The system slows down and retrieval quality drops.
- **Don't treat memory as read-only**: memories should be updateable. "User prefers dark mode" should replace "user prefers light mode", not coexist.

---

## References

- mem0: https://github.com/mem0ai/mem0 | https://docs.mem0.ai
- Letta: https://github.com/Letta-AI/letta | https://www.letta.com/blog/agent-memory
- MemGPT paper: https://arxiv.org/abs/2310.08560
- OpenClaw memory-management: https://github.com/jzOcb/openclaw-memory-management
- OpenClaw memory-lancedb-pro: https://github.com/CortexReach/memory-lancedb-pro
- Claude Code memory: ~/.claude/projects/ filesystem structure
