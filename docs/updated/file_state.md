# File State — Claude Code vs Construct

  What Claude Code does:

  - LRU cache for file contents with mtime invalidation
  - Read state tracking: knows which files have been read in the current session
  - System prompt injection: "you already have these files in context, don't re-read"
  - Content replacement state: freeze/replace file content ranges
  - File content stored externally (8KB preview in context, full on disk)

  How it is now:

  ┌────┬───────────────────────────────┬──────────────────────────────────────────────────┬──────────────────────────┐
  │  # │ What we built                 │ How it works                                     │ File                     │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │  1 │ File state tracker            │ Tracks every file read/write/edit with path,     │ coder/filestate.go       │
  │    │                               │ action, turn number, content ref ID. ReadCount   │                          │
  │    │                               │ and WriteCount per file.                          │                          │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │  2 │ System prompt injection       │ Summary() generates "## Files accessed this      │ coder/filestate.go       │
  │    │                               │ session" with per-file status: "read turn N",    │                          │
  │    │                               │ "written turn N", "edited turn N". Includes      │                          │
  │    │                               │ instruction "Do not re-read files you already    │                          │
  │    │                               │ have in context."                                │                          │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │  3 │ LRU file cache                │ In-memory cache of file contents. mtime-based    │ coder/filecache.go       │
  │    │                               │ invalidation: Get() checks os.Stat(), evicts if  │                          │
  │    │                               │ mtime or size changed. Max 1000 entries. LRU     │                          │
  │    │                               │ eviction (newest at end of order slice).          │                          │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │  4 │ Cache invalidation on write   │ Invalidate(path) removes a file from cache.      │ coder/filecache.go       │
  │    │                               │ Called after write_file or edit_file so next      │                          │
  │    │                               │ read fetches fresh content from disk.              │                          │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │  5 │ Runner integration            │ TrackToolResult() in the coder module maps tool  │ coder/coder.go           │
  │    │                               │ names to file actions: read_file → "read",       │                          │
  │    │                               │ write_file → "write", edit_file → "edit".         │                          │
  │    │                               │ Extracts path from JSON input.                    │                          │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │  6 │ Disk-persisted large results  │ Context budget persists oversized file reads to  │ coder/context.go         │
  │    │                               │ disk. FileState stores the StoredResult.ID as     │                          │
  │    │                               │ ContentRef. Retrieve(id) reads full content.      │                          │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │  7 │ Session state persistence     │ FileState.All() returns all records for session  │ coder/session_state.go   │
  │    │                               │ state capture. On resume, file state is restored │                          │
  │    │                               │ so the agent knows which files it already has.    │                          │
  └────┴───────────────────────────────┴──────────────────────────────────────────────────┴──────────────────────────┘

  The 2 gaps — Claude Code vs Construct:

  ┌─────┬──────────────────────┬────────┬──────────────────────────────────────────┬────────────────────────────┐
  │  #  │        Gap           │ Impact │            What they do                  │       What we do           │
  ├─────┼──────────────────────┼────────┼──────────────────────────────────────────┼────────────────────────────┤
  │  1  │ Content replacement  │ Medium │ Freeze/replace ranges within file        │ Whole-file tracking only.  │
  │     │ state                │        │ content. Surgical updates without        │ No sub-file range          │
  │     │                      │        │ re-reading entire file.                  │ tracking or replacement.   │
  ├─────┼──────────────────────┼────────┼──────────────────────────────────────────┼────────────────────────────┤
  │  2  │ Cache hit/miss       │ Low    │ Explicit hit/miss counters for           │ Stats() returns entry      │
  │     │ counters             │        │ monitoring cache effectiveness.          │ count but hits/misses      │
  │     │                      │        │                                          │ tracked externally (zero   │
  │     │                      │        │                                          │ values returned).          │
  └─────┴──────────────────────┴────────┴──────────────────────────────────────────┴────────────────────────────┘

---

## Problem → Solution Log

### File state tracking — DONE
**Problem:** The agent re-read files it already had in context, wasting tokens and API calls.
**Solution:** `FileState` tracks every file operation with path, action (read/write/edit), turn number, and optional content reference ID. `WasRead()` and `WasWritten()` give quick lookups. Thread-safe with RWMutex.
**Files:** `coder/filestate.go`

### System prompt injection — DONE
**Problem:** Even with tracking, the LLM didn't know which files were already in context. It would re-read the same file 3-4 times in a session.
**Solution:** `Summary()` generates a "## Files accessed this session" section injected into the system prompt (dynamic section). Lists each file with its last action and turn number. Includes the instruction "Do not re-read files you already have in context." This is detected as a dynamic marker by `SplitSystemPrompt()`.
**Files:** `coder/filestate.go`

### LRU file cache — DONE
**Problem:** Even when the LLM avoided re-reading, tool execution still hit disk every time. Slow for large files.
**Solution:** `FileCache` with configurable max entries (default 1000). `Get()` validates mtime + file size before returning cached content — if either changed, the entry is evicted and a miss is returned. `Put()` stores with mtime snapshot. LRU eviction: oldest entries removed when at capacity. O(n) touchLocked but n is bounded by max entries.
**Files:** `coder/filecache.go`

### Disk persistence for large results — DONE
**Problem:** Large file reads consumed too much context. A 50KB file used 50K chars of the model's context window.
**Solution:** Context budget system persists oversized results to disk. FileState stores the `StoredResult.ID` as `ContentRef`. The model sees a smart preview (head/tail split based on tool type) with a `ref:ID` footer. `Retrieve(id)` reads the full content back if needed.
**Files:** `coder/context.go`, `coder/filestate.go`
