package skill

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"
)

// SystemPromptParts splits the assembled system prompt into a static
// (cacheable) prefix and a dynamic (per-turn) suffix. Anthropic charges
// full input tokens for the dynamic part but reuses the cached prefix
// across turns — so getting this boundary right cuts per-turn cost
// dramatically on long sessions.
//
// Mirrors operator's runner/system_prompt_cache.go split markers verbatim
// so brain prompts cache the same way operator's did. Adding a new
// dynamic section? Add its marker here AND emit it past that boundary.
type SystemPromptParts struct {
	Static  string
	Dynamic string
	Hash    string // sha256[:8] of static — for cache-break detection in logs
}

// dynamicMarkers are headings that signal per-turn content. The earliest
// occurrence of any marker in the prompt is the cache boundary.
var dynamicMarkers = []string{
	"\n\n## Project Context",
	"\n\n## Files accessed this session",
	"\n\n## Memory",
	"\n\n## Sub-Agent:",
	"\n\n## Active UI Context",
	"\n\n## Runtime Context",
	"\n\n## Instructions from",
}

func SplitSystemPrompt(full string) SystemPromptParts {
	split := len(full)
	for _, m := range dynamicMarkers {
		if idx := strings.Index(full, m); idx >= 0 && idx < split {
			split = idx
		}
	}
	static := full[:split]
	dynamic := ""
	if split < len(full) {
		dynamic = full[split:]
	}
	h := sha256.Sum256([]byte(static))
	return SystemPromptParts{
		Static:  static,
		Dynamic: dynamic,
		Hash:    hex.EncodeToString(h[:8]),
	}
}
