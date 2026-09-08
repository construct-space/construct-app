package agent

import (
	"context"
	"fmt"

	"github.com/construct-space/brain/provider"
)

// Summarizer condenses a slice of elided messages into a short note.
// Optional — when nil, compaction falls back to the sentinel-only path
// (lossy but free). Implementations live in main.go and typically call a
// cheap model with a "summarize this exchange" prompt.
type Summarizer func(ctx context.Context, msgs []provider.Message) (string, error)

// CompactConfig sizes the rolling context window. Brain v0 uses a simple
// "preserve head + tail, elide middle" strategy — no LLM summarisation
// yet. That avoids the cost of a second model call while still keeping
// brain responsive on long sessions; the model loses middle-of-session
// detail but keeps orientation (first user prompt) and recent state.
type CompactConfig struct {
	MaxChars       int // soft ceiling on assembled message chars; default 200_000
	TriggerPct     float64
	TargetPct      float64
	PreserveFirstN int // turns always kept at the start (default 2)
	PreserveLastN  int // turns always kept at the end (default 8)
}

func DefaultCompactConfig() CompactConfig {
	return CompactConfig{
		MaxChars:       200_000,
		TriggerPct:     0.85,
		TargetPct:      0.60,
		PreserveFirstN: 2,
		PreserveLastN:  8,
	}
}

// CompactIfNeeded returns a possibly-trimmed message list and a stat
// record describing what happened. Idempotent: called every turn,
// no-ops when the conversation is small. When summarize is non-nil and
// the trigger fires, the elided middle is replaced by a 1-paragraph
// summary instead of a bare "[N turns elided]" sentinel.
func CompactIfNeeded(ctx context.Context, msgs []provider.Message, cfg CompactConfig, summarize Summarizer) ([]provider.Message, CompactStats) {
	stats := CompactStats{Total: len(msgs)}
	if cfg.MaxChars <= 0 {
		cfg = DefaultCompactConfig()
	}
	chars := totalChars(msgs)
	stats.CharsBefore = chars
	trigger := int(float64(cfg.MaxChars) * cfg.TriggerPct)
	if chars < trigger {
		stats.CharsAfter = chars
		return msgs, stats
	}

	keepFirst := cfg.PreserveFirstN
	keepLast := cfg.PreserveLastN
	if keepFirst+keepLast >= len(msgs) {
		stats.CharsAfter = chars
		return msgs, stats
	}

	// Drop middle. Insert a sentinel user message so the model knows
	// turns were elided rather than thinking the gap is real.
	middleStart := keepFirst
	middleEnd := len(msgs) - keepLast
	elided := middleEnd - middleStart
	if elided <= 0 {
		stats.CharsAfter = chars
		return msgs, stats
	}

	head := msgs[:middleStart]
	tail := msgs[middleEnd:]
	middle := msgs[middleStart:middleEnd]

	sentinelText := fmt.Sprintf("[brain compacted %d earlier turns to keep the session under the context limit]", elided)
	if summarize != nil {
		if sum, err := summarize(ctx, middle); err == nil && sum != "" {
			sentinelText = fmt.Sprintf("[brain compacted %d earlier turns. Summary of what happened: %s]", elided, sum)
			stats.Summarized = true
		}
	}
	sentinel := provider.Message{
		Role: "user",
		Content: []provider.Block{{
			Type: "text",
			Text: sentinelText,
		}},
	}

	out := make([]provider.Message, 0, len(head)+1+len(tail))
	out = append(out, head...)
	out = append(out, sentinel)
	out = append(out, tail...)

	// Slicing at message granularity can split tool_use/tool_result
	// pairs: the head often ends on an assistant tool_use whose result
	// was elided, and the tail can open with a tool_result whose call is
	// gone. Providers 400 on either, and since compaction re-fires every
	// turn, the session bricks exactly when it gets long. Repair pairing
	// before returning.
	out = sanitizeToolPairing(out)

	stats.Triggered = true
	stats.Elided = elided
	stats.CharsAfter = totalChars(out)
	return out, stats
}

// sanitizeToolPairing drops tool_use blocks with no matching tool_result
// and tool_result blocks with no matching tool_use, then removes
// messages left empty. Relative order is preserved.
func sanitizeToolPairing(msgs []provider.Message) []provider.Message {
	useIDs := map[string]bool{}
	resultIDs := map[string]bool{}
	for _, m := range msgs {
		for _, b := range m.Content {
			if b.Type == "tool_use" && b.ToolUse != nil {
				useIDs[b.ToolUse.ID] = true
			}
			if b.Type == "tool_result" && b.ToolResult != nil {
				resultIDs[b.ToolResult.ToolUseID] = true
			}
		}
	}
	out := make([]provider.Message, 0, len(msgs))
	for _, m := range msgs {
		kept := make([]provider.Block, 0, len(m.Content))
		for _, b := range m.Content {
			switch {
			case b.Type == "tool_use" && b.ToolUse != nil && !resultIDs[b.ToolUse.ID]:
				continue // dangling call — its result was elided
			case b.Type == "tool_result" && b.ToolResult != nil && !useIDs[b.ToolResult.ToolUseID]:
				continue // orphan result — its call was elided
			}
			kept = append(kept, b)
		}
		if len(kept) == 0 {
			continue
		}
		out = append(out, provider.Message{Role: m.Role, Content: kept})
	}
	return out
}

type CompactStats struct {
	Triggered   bool
	Summarized  bool
	Total       int
	Elided      int
	CharsBefore int
	CharsAfter  int
}

// truncateToolResult caps an individual tool's output. Most outputs are
// short; a Read on a 50KB file or a Bash that prints a 100K log will
// otherwise eat the entire context budget in one turn.
//
// Strategy: keep the head + tail with a marker between. Head is bigger
// because diagnostics typically lead the output; tail captures exit
// codes and the "here's what failed" trailers.
const (
	toolResultMax  = 15_000
	toolResultHead = 10_000
	toolResultTail = 4_000
)

func truncateToolResult(s string) string {
	if len(s) <= toolResultMax {
		return s
	}
	return s[:toolResultHead] +
		fmt.Sprintf("\n\n[truncated — %d chars omitted between head and tail]\n\n", len(s)-toolResultHead-toolResultTail) +
		s[len(s)-toolResultTail:]
}

// EmergencyCompact strips the heavy tool_result blocks from older
// messages, keeping only the final assistant text and the most recent
// few turns intact. Called by the agent loop when even after normal
// compaction the message slice is still over budget — last-resort
// recovery so the model can keep working instead of erroring.
func EmergencyCompact(msgs []provider.Message, keepLastN int) []provider.Message {
	if keepLastN <= 0 {
		keepLastN = 4
	}
	if len(msgs) <= keepLastN {
		return msgs
	}
	cutoff := len(msgs) - keepLastN
	out := make([]provider.Message, 0, len(msgs))
	for i, m := range msgs {
		if i >= cutoff {
			out = append(out, m)
			continue
		}
		stripped := make([]provider.Block, 0, len(m.Content))
		for _, b := range m.Content {
			if b.Type == "tool_result" && b.ToolResult != nil {
				stripped = append(stripped, provider.Block{
					Type: "tool_result",
					ToolResult: &provider.ToolResultBlock{
						ToolUseID: b.ToolResult.ToolUseID,
						Content:   "[stripped during emergency compaction]",
						IsError:   b.ToolResult.IsError,
					},
				})
				continue
			}
			stripped = append(stripped, b)
		}
		out = append(out, provider.Message{Role: m.Role, Content: stripped})
	}
	return out
}

func totalChars(msgs []provider.Message) int {
	n := 0
	for _, m := range msgs {
		for _, b := range m.Content {
			n += len(b.Text)
			if b.ToolUse != nil {
				n += len(b.ToolUse.Name) + 32 // rough id+input overhead
			}
			if b.ToolResult != nil {
				n += len(b.ToolResult.Content)
			}
		}
	}
	return n
}
