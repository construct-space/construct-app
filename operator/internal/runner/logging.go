package runner

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"construct-operator/internal/agent"
	"construct-operator/internal/appdir"
	"construct-operator/internal/provider"
)

// ─── Project-level logging ───
// Writes a human-readable log to {project_root}/.construct/coder.log
// so the user can monitor and review the full agent session.

var projectLogMu sync.Mutex

func projectLogPath(projectRoot string) string {
	dir := filepath.Join(projectRoot, ".construct")
	os.MkdirAll(dir, 0755)
	return filepath.Join(dir, "coder.log")
}

func appendProjectLog(projectRoot string, agentCfg *agent.Config, line string) {
	agentID := "agent"
	if agentCfg != nil {
		agentID = agentCfg.ID
	}
	ts := time.Now().Format("15:04:05")
	entry := fmt.Sprintf("[%s] [%s] %s\n", ts, agentID, line)

	projectLogMu.Lock()
	defer projectLogMu.Unlock()
	f, err := os.OpenFile(projectLogPath(projectRoot), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return
	}
	defer f.Close()
	f.WriteString(entry)
}

func logToolCall(projectRoot string, agentCfg *agent.Config, tc provider.ToolCall) {
	// Extract primary arg for readable logging
	arg := ""
	if tc.Input != "" {
		var parsed map[string]any
		if json.Unmarshal([]byte(tc.Input), &parsed) == nil {
			for _, key := range []string{"path", "pattern", "command", "agent_id"} {
				if v, ok := parsed[key].(string); ok && v != "" {
					arg = v
					break
				}
			}
		}
	}
	line := tc.Name
	if arg != "" {
		if len(arg) > 120 {
			arg = arg[:120] + "..."
		}
		line += "(" + arg + ")"
	}
	appendProjectLog(projectRoot, agentCfg, line)
}

// conversationLogger groups logs by session into a single JSONL file.
var conversationLogMu sync.Mutex

// logConversation appends a raw LLM request or response to a per-session log file.
// Format: one JSON object per line (JSONL) in logs/conversations/{date}_{agent}.jsonl
func logConversation(agentCfg *agent.Config, turn int, phase string, req *provider.Request, resp *provider.Response) {
	logsDir := filepath.Join(appdir.LogsDir(), "conversations")
	os.MkdirAll(logsDir, 0755)

	agentID := "unknown"
	if agentCfg != nil {
		agentID = agentCfg.ID
	}

	entry := map[string]any{
		"ts":    time.Now().Format(time.RFC3339),
		"agent": agentID,
		"turn":  turn,
		"phase": phase,
		"model": req.Model,
	}

	if phase == "request" {
		entry["system"] = req.System
		entry["messages"] = req.Messages
		// Log tool names only (schemas are too large)
		toolNames := make([]string, 0, len(req.Tools))
		for _, t := range req.Tools {
			toolNames = append(toolNames, t.Name)
		}
		entry["tools"] = toolNames
	}

	if phase == "response" && resp != nil {
		entry["content"] = resp.Content
		entry["reasoning"] = resp.ReasoningContent
		entry["stop_reason"] = resp.StopReason
		entry["tool_calls"] = resp.ToolCalls
		entry["input_tokens"] = resp.Usage.InputTokens
		entry["output_tokens"] = resp.Usage.OutputTokens
	}

	line, err := json.Marshal(entry)
	if err != nil {
		return
	}
	line = append(line, '\n')

	// Append to daily per-agent JSONL file
	date := time.Now().Format("2006-01-02")
	filename := filepath.Join(logsDir, fmt.Sprintf("%s_%s.jsonl", date, agentID))

	conversationLogMu.Lock()
	defer conversationLogMu.Unlock()
	f, err := os.OpenFile(filename, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return
	}
	defer f.Close()
	f.Write(line)
}
