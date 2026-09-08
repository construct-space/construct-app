package agent

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"github.com/construct-space/brain/provider"
)

// toolLoopHistory builds a long alternating assistant(tool_use) /
// user(tool_result) conversation, padded so it crosses the compaction
// trigger. This is the exact shape that used to split pairs at the
// head/tail boundaries.
func toolLoopHistory(turns int, pad int) []provider.Message {
	filler := strings.Repeat("x", pad)
	msgs := []provider.Message{
		{Role: "user", Content: []provider.Block{{Type: "text", Text: "start " + filler}}},
	}
	for i := 0; i < turns; i++ {
		id := fmt.Sprintf("call_%d", i)
		msgs = append(msgs,
			provider.Message{Role: "assistant", Content: []provider.Block{
				{Type: "text", Text: "calling " + filler},
				{Type: "tool_use", ToolUse: &provider.ToolUseBlock{ID: id, Name: "read"}},
			}},
			provider.Message{Role: "user", Content: []provider.Block{
				{Type: "tool_result", ToolResult: &provider.ToolResultBlock{ToolUseID: id, Content: "result " + filler}},
			}},
		)
	}
	return msgs
}

func assertPaired(t *testing.T, msgs []provider.Message) {
	t.Helper()
	uses := map[string]bool{}
	results := map[string]bool{}
	for _, m := range msgs {
		for _, b := range m.Content {
			if b.Type == "tool_use" && b.ToolUse != nil {
				uses[b.ToolUse.ID] = true
			}
			if b.Type == "tool_result" && b.ToolResult != nil {
				results[b.ToolResult.ToolUseID] = true
			}
		}
	}
	for id := range uses {
		if !results[id] {
			t.Errorf("tool_use %s has no tool_result after compaction", id)
		}
	}
	for id := range results {
		if !uses[id] {
			t.Errorf("tool_result %s has no tool_use after compaction", id)
		}
	}
}

func TestCompactRepairsSplitToolPairs(t *testing.T) {
	cfg := CompactConfig{
		MaxChars:       10_000,
		TriggerPct:     0.5,
		TargetPct:      0.3,
		PreserveFirstN: 2, // head ends on the first assistant tool_use — its result lands in the elided middle
		PreserveLastN:  7, // odd count so the tail opens on a tool_result whose call was elided
	}
	msgs := toolLoopHistory(20, 400)

	out, stats := CompactIfNeeded(context.Background(), msgs, cfg, nil)
	if !stats.Triggered {
		t.Fatalf("compaction did not trigger (chars=%d)", stats.CharsBefore)
	}
	assertPaired(t, out)

	// The sentinel must survive sanitation.
	found := false
	for _, m := range out {
		for _, b := range m.Content {
			if b.Type == "text" && strings.Contains(b.Text, "compacted") {
				found = true
			}
		}
	}
	if !found {
		t.Error("compaction sentinel missing from output")
	}
}

func TestCompactNoopStaysIntact(t *testing.T) {
	msgs := toolLoopHistory(3, 10)
	out, stats := CompactIfNeeded(context.Background(), msgs, DefaultCompactConfig(), nil)
	if stats.Triggered {
		t.Fatal("small history should not trigger compaction")
	}
	if len(out) != len(msgs) {
		t.Fatalf("no-op path changed message count: %d != %d", len(out), len(msgs))
	}
	assertPaired(t, out)
}
