package main

import (
	"strings"

	"construct-operator/internal/provider"
)

// isDesktopOnlySpaceTool returns true for space tools that need the desktop
// bridge and should be excluded when running headless (TUI/CLI mode).
func isDesktopOnlySpaceTool(name string) bool {
	suffixes := []string{"-dev", "-run-command", "-create_project"}
	for _, suffix := range suffixes {
		if strings.HasSuffix(name, suffix) {
			return true
		}
	}
	return false
}

func truncateLog(s string, max int) string {
	s = strings.TrimSpace(s)
	if len(s) <= max {
		return s
	}
	return s[:max] + "..."
}

func lastUserMessage(messages []provider.Message) string {
	for i := len(messages) - 1; i >= 0; i-- {
		if strings.EqualFold(messages[i].Role, "user") {
			if content := strings.TrimSpace(messages[i].Content); content != "" {
				return content
			}
		}
	}
	return ""
}
