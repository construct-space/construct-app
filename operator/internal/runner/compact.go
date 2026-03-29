package runner

import (
	"fmt"

	"construct-operator/internal/provider"
)

func compactToolResultForModelContext(result provider.ToolResult) provider.ToolResult {
	compacted := result
	compacted.Content = compactTextForModelContext(result.Content)
	return compacted
}

func compactTextForModelContext(content string) string {
	if len(content) <= maxToolResultContextChars {
		return content
	}

	headChars := toolResultContextHeadChars
	tailChars := toolResultContextTailChars
	if headChars > len(content) {
		headChars = len(content)
	}
	if tailChars > len(content)-headChars {
		tailChars = len(content) - headChars
	}
	if tailChars < 0 {
		tailChars = 0
	}

	truncatedChars := len(content) - headChars - tailChars
	if truncatedChars < 0 {
		truncatedChars = 0
	}

	head := content[:headChars]
	tail := ""
	if tailChars > 0 {
		tail = content[len(content)-tailChars:]
	}
	return head + fmt.Sprintf("\n\n...[truncated %d chars for model context]...\n\n", truncatedChars) + tail
}
