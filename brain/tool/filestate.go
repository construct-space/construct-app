package tool

import (
	"context"
	"os"
	"sync"
	"time"
)

// FileState tracks which files the model has read during the current
// session. The agent loop binds a session id to the tool context before
// each turn (see SessionKey/WithSession); Read marks paths read, Edit
// and Write check them. The goal is to stop the model from editing a
// file it has never seen — the most common destructive failure mode.
//
// Scope is per-session: two concurrent sessions don't share state.
// Records are time-stamped so a stale read (file mtime changed since
// the read) can be re-required as a fresh one. Memory only — survives
// nothing; restarts wipe.

type sessionKeyType struct{}

var sessionKey = sessionKeyType{}

type surfaceKeyType struct{}

var surfaceKey = surfaceKeyType{}

// WithSurface tags ctx with the calling surface ("builder", "spacedev",
// "ask", …) so list_tools + the registry can hide tools that don't apply
// to that surface. Unset = no filtering (legacy callers).
func WithSurface(ctx context.Context, surface string) context.Context {
	if surface == "" {
		return ctx
	}
	return context.WithValue(ctx, surfaceKey, surface)
}

func SurfaceFromCtx(ctx context.Context) string {
	if ctx == nil {
		return ""
	}
	v, _ := ctx.Value(surfaceKey).(string)
	return v
}

// surfaceDenies maps a surface name to tools that should be hidden from
// list_tools and refused by the registry. Keep this small and explicit:
// it's a maintainability cost every entry pays. Only put tools here that
// are actively confusing or harmful when surfaced.
//
//   - spacedev builds *one* space; listing installed spaces, browsing
//     the marketplace, or popping the project-create modal are
//     host-level concerns and have nothing to do with the build loop.
//   - ask is conversational; it should not be tempted to scaffold spaces
//     or run space-graph migrations. Space ACTIONS are allowed though —
//     "add a task for Val" typed into Ask should run the board/org
//     actions directly, not bounce the user to another surface.
var surfaceDenies = map[string]map[string]bool{
	"spacekit": {
		"list_spaces":           true,
		"marketplace_search":    true,
		"request_project_setup": true,
	},
	"ask": {
		"space_graph_init":      true,
		"space_graph_generate":  true,
		"space_graph_push":      true,
		"space_graph_migrate":   true,
		"space_graph_status":    true,
		"start_preview":         true,
		"request_project_setup": true,
		"marketplace_search":    true,
	},
}

// SurfaceAllows reports whether `toolName` should be visible/callable
// from `surface`. Empty surface or surface with no deny list → always
// true (no filtering).
func SurfaceAllows(surface, toolName string) bool {
	if surface == "" {
		return true
	}
	denies, ok := surfaceDenies[surface]
	if !ok {
		return true
	}
	return !denies[toolName]
}

// WithSession returns a child ctx that carries `sid` so the filestate
// helpers below can scope reads/writes to that session.
func WithSession(ctx context.Context, sid string) context.Context {
	if sid == "" {
		return ctx
	}
	return context.WithValue(ctx, sessionKey, sid)
}

func sessionFromCtx(ctx context.Context) string {
	if ctx == nil {
		return ""
	}
	v, _ := ctx.Value(sessionKey).(string)
	return v
}

// fileRead is one entry in the tracker: when the path was read and the
// mtime/size of the file at that moment, so we can detect drift later.
type fileRead struct {
	at    time.Time
	mtime time.Time
	size  int64
}

var (
	fileStateMu sync.Mutex
	fileStates  = map[string]map[string]fileRead{} // session id → path → record
)

// MarkRead records that `path` was read by `sid`. Captures the file's
// mtime+size so a later Edit/Write can detect external drift.
func MarkRead(ctx context.Context, path string) {
	sid := sessionFromCtx(ctx)
	if sid == "" || path == "" {
		return
	}
	info, err := os.Stat(path)
	if err != nil {
		return
	}
	fileStateMu.Lock()
	defer fileStateMu.Unlock()
	bucket, ok := fileStates[sid]
	if !ok {
		bucket = map[string]fileRead{}
		fileStates[sid] = bucket
	}
	bucket[path] = fileRead{at: time.Now(), mtime: info.ModTime(), size: info.Size()}
}

// MarkWritten refreshes the read record after a write so subsequent
// edits don't trip the "file changed since you read it" check on the
// model's own writes.
func MarkWritten(ctx context.Context, path string) {
	MarkRead(ctx, path)
}

// CheckReadBeforeWrite returns "" if the file is safe to edit/write
// (either was read in this session and unchanged on disk, or doesn't
// exist yet so Write is creating it). Otherwise returns a human-readable
// reason the model should see as a tool error.
func CheckReadBeforeWrite(ctx context.Context, path string) string {
	sid := sessionFromCtx(ctx)
	if sid == "" {
		return ""
	}
	if path == "" {
		return ""
	}
	info, err := os.Stat(path)
	if err != nil {
		// Doesn't exist yet — Write is creating a new file, allow.
		if os.IsNotExist(err) {
			return ""
		}
		// Some other stat error — let the tool itself surface it.
		return ""
	}
	fileStateMu.Lock()
	defer fileStateMu.Unlock()
	bucket := fileStates[sid]
	rec, ok := bucket[path]
	if !ok {
		return "read this file first — you have not read it in this session"
	}
	if !rec.mtime.Equal(info.ModTime()) || rec.size != info.Size() {
		return "file changed on disk since you last read it — read it again before editing"
	}
	return ""
}

// ResetSessionFileState wipes the tracker for `sid` — call when a
// session ends so memory doesn't grow forever. The agent loop doesn't
// need to call this; brain restarts will wipe everything anyway.
func ResetSessionFileState(sid string) {
	if sid == "" {
		return
	}
	fileStateMu.Lock()
	defer fileStateMu.Unlock()
	delete(fileStates, sid)
}
