package runner

import (
	"strings"

	"construct-operator/internal/agent"
)

// isStuckInLoop detects repetitive tool call patterns:
// - Same tool+args 3x in a row (AAA)
// - Alternating pattern 3x (ABABAB = 6 turns)
// - Small set of unique tools repeated (e.g., only 2 unique tools in last 8 turns)
func isStuckInLoop(turns []agent.Turn) bool {
	if len(turns) < 4 {
		return false
	}

	// Get signatures of recent turns
	lookback := 8
	if lookback > len(turns) {
		lookback = len(turns)
	}
	sigs := make([]string, lookback)
	for i := 0; i < lookback; i++ {
		t := turns[len(turns)-1-i]
		if len(t.ToolCalls) == 0 {
			sigs[i] = "__no_tools__"
		} else {
			tc := t.ToolCalls[0]
			sigs[i] = tc.Call.Name + ":" + truncateForCompare(tc.Call.Input, 200)
		}
	}

	// Check: same command 3x in a row
	if len(sigs) >= 3 && sigs[0] == sigs[1] && sigs[1] == sigs[2] {
		return true
	}

	// Check: alternating pattern (ABAB) over last 6 turns
	if len(sigs) >= 6 && sigs[0] == sigs[2] && sigs[2] == sigs[4] && sigs[1] == sigs[3] && sigs[3] == sigs[5] {
		return true
	}

	// Check: only 1-2 unique tool signatures in last 8 turns
	if len(sigs) >= 8 {
		unique := make(map[string]bool)
		for _, s := range sigs {
			unique[s] = true
		}
		if len(unique) <= 2 {
			return true
		}
	}

	return false
}

func truncateForCompare(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max]
}

func stuckLoopMessage(agentCfg *agent.Config) string {
	if agentCfg != nil {
		switch strings.TrimSpace(strings.ToLower(agentCfg.ID)) {
		case "vibe", "space:vibe":
			return "Stopped after repeated identical tool calls without making progress. Start a fresh run and follow the docs first, especially docs/goals and docs/construct-context when they exist."
		}
	}
	return "Stopped after repeated identical tool calls without making progress."
}
