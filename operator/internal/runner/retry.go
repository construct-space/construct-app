package runner

import (
	"strings"

	"construct-operator/internal/agent"
	"construct-operator/internal/tool"
)

func shouldRetryForToolUse(agentTools []*tool.Tool, content string) bool {
	trimmed := strings.TrimSpace(content)
	if len(agentTools) == 0 {
		return false
	}
	// Don't retry on empty content — streaming may have already delivered the text
	if trimmed == "" {
		return false
	}
	return looksLikePlaintextToolDirective(trimmed, agentTools)
}

func requiresInitialToolUse(agentCfg *agent.Config) bool {
	if agentCfg == nil {
		return false
	}
	switch strings.TrimSpace(strings.ToLower(agentCfg.ID)) {
	case "vibe", "space:vibe":
		return true
	default:
		return false
	}
}

func toolUseNudge(agentCfg *agent.Config) string {
	if agentCfg != nil {
		switch strings.TrimSpace(strings.ToLower(agentCfg.ID)) {
		case "vibe", "space:vibe":
			return "You must issue a real tool call now. Use bash only for shell commands, write_file to create files, and edit_file for targeted edits. Do not narrate commands, and do not pass path/content payloads to bash."
		}
	}
	return "You must use tool calls, not text. Call the bash tool to run commands and write_file to create files. Do not output commands as plain text — invoke the tools."
}

func retryNudge(agentCfg *agent.Config, recoveringToolError bool) string {
	if recoveringToolError {
		if agentCfg != nil {
			switch strings.TrimSpace(strings.ToLower(agentCfg.ID)) {
			case "vibe", "space:vibe":
				return "The environment does support tool execution. The previous tool call failed because its input was malformed. Fix the tool input and call the appropriate tool again now. Do not apologize, do not stop, and do not claim tool access is unavailable."
			}
		}
		return "The previous tool call failed because its input was malformed. Fix the tool input and call the correct tool now."
	}
	return toolUseNudge(agentCfg)
}

func toolUseRetryLimit(agentCfg *agent.Config, hasUsedTools bool) int {
	if !hasUsedTools && requiresInitialToolUse(agentCfg) {
		return 4
	}
	return 2
}

func shouldRetryAfterToolError(agentCfg *agent.Config, content string) bool {
	if agentCfg == nil {
		return false
	}
	switch strings.TrimSpace(strings.ToLower(agentCfg.ID)) {
	case "vibe", "space:vibe":
	default:
		return false
	}

	normalized := strings.ToLower(strings.TrimSpace(content))
	if normalized == "" {
		return true
	}
	for _, phrase := range []string{
		"can't continue this task",
		"cannot continue this task",
		"don't have access to valid tool execution",
		"do not have access to valid tool execution",
		"don't have access to tool execution",
		"do not have access to tool execution",
		"tool execution in this environment",
	} {
		if strings.Contains(normalized, phrase) {
			return true
		}
	}
	return false
}
