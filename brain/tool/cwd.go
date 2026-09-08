package tool

import (
	"context"
	"os"
)

// cwdKey carries the per-prompt working directory through the agent
// loop into each tool. wire_prompt sets it from PromptPayload.ProjectDir
// so bash/read/grep/glob/git/graph all resolve against the user's space
// instead of whatever directory Tauri spawned brain in.
type cwdKey struct{}

// WithCwd returns a context with dir installed as the per-turn working
// directory. Empty dir is a no-op so callers can pass through the
// optional ProjectDir field without a nil check.
func WithCwd(ctx context.Context, dir string) context.Context {
	if dir == "" {
		return ctx
	}
	return context.WithValue(ctx, cwdKey{}, dir)
}

// Cwd returns the per-turn working directory if set, otherwise the
// process cwd. Tools should call this instead of os.Getwd() so they
// honour the prompt's project_dir hint.
func Cwd(ctx context.Context) string {
	if v := CwdRaw(ctx); v != "" {
		return v
	}
	cwd, _ := os.Getwd()
	return cwd
}

// CwdRaw returns the explicitly-set per-turn project dir, or "" if none.
// Unlike Cwd it does NOT fall back to the process cwd — use it where "no
// active project" must stay distinguishable (e.g. project-scoped memory,
// which must not write to wherever brain happened to launch).
func CwdRaw(ctx context.Context) string {
	if v, ok := ctx.Value(cwdKey{}).(string); ok {
		return v
	}
	return ""
}
