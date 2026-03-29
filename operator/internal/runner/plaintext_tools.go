package runner

import (
	"encoding/json"
	"fmt"
	"strings"

	"construct-operator/internal/provider"
	"construct-operator/internal/tool"
)

func looksLikePlaintextToolDirective(content string, agentTools []*tool.Tool) bool {
	normalized := strings.ToLower(strings.TrimSpace(content))
	if normalized == "" {
		return false
	}

	for _, toolDef := range agentTools {
		if toolDef == nil {
			continue
		}
		name := strings.ToLower(strings.TrimSpace(toolDef.Def.Name))
		if name == "" {
			continue
		}
		aliases := []string{
			name,
			strings.ReplaceAll(name, "_", "-"),
			name + "_code",
			strings.ReplaceAll(name, "_", "") + "_code",
		}
		for _, alias := range aliases {
			alias = strings.TrimSpace(alias)
			if alias == "" {
				continue
			}
			if strings.Contains(normalized, "to="+alias) ||
				strings.Contains(normalized, "tool:"+alias) ||
				strings.Contains(normalized, "tool = "+alias) ||
				strings.Contains(normalized, "function:"+alias) ||
				strings.Contains(normalized, "function = "+alias) {
				return true
			}
		}
	}

	return false
}

type plaintextToolDirective struct {
	Name string
	Body string
}

func synthesizePlaintextToolCalls(content string, agentTools []*tool.Tool) []provider.ToolCall {
	directives := parsePlaintextToolDirectives(content, agentTools)
	if len(directives) == 0 {
		return synthesizeInlineJSONToolCalls(content, agentTools)
	}

	toolCalls := make([]provider.ToolCall, 0, len(directives))
	for index, directive := range directives {
		input, ok := plaintextToolInput(directive.Name, directive.Body)
		if !ok {
			return nil
		}
		toolCalls = append(toolCalls, provider.ToolCall{
			ID:    fmt.Sprintf("plaintext-tool-%d", index+1),
			Name:  directive.Name,
			Input: input,
		})
	}
	return toolCalls
}

func synthesizeInlineJSONToolCalls(content string, agentTools []*tool.Tool) []provider.ToolCall {
	remaining := content
	toolCalls := make([]provider.ToolCall, 0)
	for len(remaining) > 0 {
		idx := strings.Index(strings.ToLower(remaining), "to=")
		if idx == -1 {
			break
		}
		remaining = remaining[idx+3:]
		aliasPart := strings.TrimSpace(remaining)
		if aliasPart == "" {
			break
		}
		end := len(aliasPart)
		for index, r := range aliasPart {
			if r == ':' || r == ' ' || r == '\t' || r == '\n' {
				end = index
				break
			}
		}
		alias := strings.TrimSpace(aliasPart[:end])
		name, ok := canonicalToolName(alias, agentTools)
		if !ok {
			remaining = aliasPart[end:]
			continue
		}
		jsonOffset := strings.Index(aliasPart[end:], "{")
		if jsonOffset == -1 {
			remaining = aliasPart[end:]
			continue
		}
		jsonStart := aliasPart[end+jsonOffset:]
		payload, ok := extractLeadingJSONObject(jsonStart)
		if !ok {
			remaining = aliasPart[end+jsonOffset:]
			continue
		}
		toolCalls = append(toolCalls, provider.ToolCall{
			ID:    fmt.Sprintf("plaintext-inline-tool-%d", len(toolCalls)+1),
			Name:  name,
			Input: payload,
		})
		remaining = jsonStart[len(payload):]
	}
	if len(toolCalls) == 0 {
		return nil
	}
	return toolCalls
}

func parsePlaintextToolDirectives(content string, agentTools []*tool.Tool) []plaintextToolDirective {
	lines := strings.Split(strings.ReplaceAll(content, "\r\n", "\n"), "\n")
	directives := make([]plaintextToolDirective, 0)
	currentName := ""
	var bodyLines []string
	flush := func() {
		if currentName == "" {
			return
		}
		directives = append(directives, plaintextToolDirective{
			Name: currentName,
			Body: strings.TrimSpace(strings.Join(bodyLines, "\n")),
		})
		currentName = ""
		bodyLines = nil
	}

	for _, rawLine := range lines {
		if name, ok := parsePlaintextToolHeader(rawLine, agentTools); ok {
			flush()
			currentName = name
			bodyLines = nil
			continue
		}
		if currentName == "" {
			if strings.TrimSpace(rawLine) != "" {
				return nil
			}
			continue
		}
		bodyLines = append(bodyLines, rawLine)
	}
	flush()

	if len(directives) == 0 {
		return nil
	}
	for _, directive := range directives {
		if directive.Body == "" {
			return nil
		}
	}
	return directives
}

func parsePlaintextToolHeader(line string, agentTools []*tool.Tool) (string, bool) {
	trimmed := strings.TrimSpace(line)
	if !strings.HasPrefix(strings.ToLower(trimmed), "to=") {
		return "", false
	}
	aliasPart := strings.TrimSpace(trimmed[3:])
	if aliasPart == "" {
		return "", false
	}
	end := len(aliasPart)
	for index, r := range aliasPart {
		if r == ':' || r == ' ' || r == '\t' {
			end = index
			break
		}
	}
	alias := strings.TrimSpace(aliasPart[:end])
	if alias == "" {
		return "", false
	}
	if name, ok := canonicalToolName(alias, agentTools); ok {
		return name, true
	}
	return "", false
}

func canonicalToolName(alias string, agentTools []*tool.Tool) (string, bool) {
	normalizedAlias := normalizePlaintextToolAlias(alias)
	if normalizedAlias == "" {
		return "", false
	}
	for _, toolDef := range agentTools {
		if toolDef == nil {
			continue
		}
		name := strings.TrimSpace(toolDef.Def.Name)
		if name == "" {
			continue
		}
		for _, candidate := range []string{
			name,
			strings.ReplaceAll(name, "_", "-"),
			name + "_code",
			strings.ReplaceAll(name, "_", "") + "_code",
			name + " code",
		} {
			if normalizePlaintextToolAlias(candidate) == normalizedAlias {
				return name, true
			}
		}
	}
	return "", false
}

func normalizePlaintextToolAlias(alias string) string {
	normalized := strings.ToLower(strings.TrimSpace(alias))
	normalized = strings.TrimSuffix(normalized, ":")
	normalized = strings.TrimSpace(normalized)
	normalized = strings.TrimPrefix(normalized, "functions.")
	normalized = strings.TrimSuffix(normalized, "_code")
	normalized = strings.TrimSuffix(normalized, " code")
	normalized = strings.ReplaceAll(normalized, "-", "_")
	return strings.TrimSpace(normalized)
}

func plaintextToolInput(name, body string) (string, bool) {
	trimmed := strings.TrimSpace(body)
	if trimmed == "" {
		return "", false
	}
	if strings.HasPrefix(trimmed, "{") {
		if candidate, ok := extractLeadingJSONObject(trimmed); ok {
			var raw map[string]any
			if err := json.Unmarshal([]byte(candidate), &raw); err == nil {
				return candidate, true
			}
		}
	}

	switch name {
	case "bash":
		command := sanitizePlaintextBashBody(trimmed)
		if command == "" {
			return "", false
		}
		payload, err := json.Marshal(map[string]string{"command": command})
		return string(payload), err == nil
	case "write_file":
		fields := parsePlaintextToolFields(trimmed, map[string]bool{"path": true, "content": true})
		if fields["path"] == "" || fields["content"] == "" {
			return "", false
		}
		payload, err := json.Marshal(map[string]string{
			"path":    fields["path"],
			"content": fields["content"],
		})
		return string(payload), err == nil
	case "edit_file":
		fields := parsePlaintextToolFields(trimmed, map[string]bool{"path": true, "old_string": true, "new_string": true})
		if fields["path"] == "" || fields["old_string"] == "" || fields["new_string"] == "" {
			return "", false
		}
		payload, err := json.Marshal(map[string]string{
			"path":       fields["path"],
			"old_string": fields["old_string"],
			"new_string": fields["new_string"],
		})
		return string(payload), err == nil
	case "read_file", "list_dir":
		fields := parsePlaintextToolFields(trimmed, map[string]bool{"path": true})
		pathValue := fields["path"]
		if pathValue == "" {
			pathValue = firstNonEmptyLine(trimmed)
		}
		if pathValue == "" {
			return "", false
		}
		payload, err := json.Marshal(map[string]string{"path": pathValue})
		return string(payload), err == nil
	case "glob":
		fields := parsePlaintextToolFields(trimmed, map[string]bool{"pattern": true})
		pattern := fields["pattern"]
		if pattern == "" {
			pattern = firstNonEmptyLine(trimmed)
		}
		if pattern == "" {
			return "", false
		}
		payload, err := json.Marshal(map[string]string{"pattern": pattern})
		return string(payload), err == nil
	case "grep":
		fields := parsePlaintextToolFields(trimmed, map[string]bool{"pattern": true, "path": true})
		if fields["pattern"] == "" {
			return "", false
		}
		payload, err := json.Marshal(map[string]string{
			"pattern": fields["pattern"],
			"path":    fields["path"],
		})
		return string(payload), err == nil
	case "spawn_agent":
		fields := parsePlaintextToolFields(trimmed, map[string]bool{"agent_id": true, "task": true})
		if fields["agent_id"] == "" || fields["task"] == "" {
			return "", false
		}
		payload, err := json.Marshal(map[string]string{
			"agent_id": fields["agent_id"],
			"task":     fields["task"],
		})
		return string(payload), err == nil
	default:
		return "", false
	}
}

func sanitizePlaintextBashBody(body string) string {
	lines := strings.Split(body, "\n")
	commands := make([]string, 0, len(lines))
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			if len(commands) > 0 {
				commands = append(commands, "")
			}
			continue
		}
		if !looksLikeShellCommandLine(trimmed) {
			break
		}
		commands = append(commands, line)
	}
	return strings.TrimSpace(strings.Join(commands, "\n"))
}

func looksLikeShellCommandLine(line string) bool {
	if line == "" {
		return false
	}
	for _, prefix := range []string{
		"#", "$", "./", "../", "/", "cd ", "mkdir ", "npm ", "npx ", "pnpm ", "yarn ", "git ", "go ", "flutter ", "rails ",
		"ruby ", "bundle ", "gem ", "cat ", "tee ", "echo ", "printf ", "cp ", "mv ", "rm ", "touch ", "export ", "set ", "if ",
		"then", "fi", "for ", "do", "done", "while ", "pwd", "ls ", "find ", "sed ", "awk ", "chmod ", "source ", "brew ", "sudo ",
		"cargo ", "rustc ", "python ", "python3 ", "pip ", "uv ", "composer ", "docker ", "make ", "env ", "test ", "[", "{", "}",
	} {
		if strings.HasPrefix(line, prefix) {
			return true
		}
	}
	if strings.Contains(line, "&&") || strings.Contains(line, "||") || strings.Contains(line, ";") ||
		strings.Contains(line, " | ") || strings.Contains(line, ">") || strings.Contains(line, "<") ||
		strings.Contains(line, "$(") || strings.HasSuffix(line, "\\") {
		return true
	}
	if index := strings.Index(line, "="); index > 0 {
		left := line[:index]
		if isSimpleShellWord(left) {
			return true
		}
	}
	return false
}

func isSimpleShellWord(value string) bool {
	if value == "" {
		return false
	}
	for _, r := range value {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '_' {
			continue
		}
		return false
	}
	return true
}

func parsePlaintextToolFields(body string, allowed map[string]bool) map[string]string {
	result := make(map[string]string)
	currentKey := ""
	for _, line := range strings.Split(body, "\n") {
		trimmed := strings.TrimSpace(line)
		if key, value, ok := strings.Cut(line, ":"); ok {
			normalizedKey := strings.TrimSpace(strings.ToLower(key))
			if allowed[normalizedKey] {
				currentKey = normalizedKey
				result[currentKey] = strings.TrimLeft(value, " ")
				continue
			}
		}
		if currentKey == "" {
			if trimmed == "" {
				continue
			}
			continue
		}
		if result[currentKey] != "" {
			result[currentKey] += "\n"
		}
		result[currentKey] += line
	}
	for key, value := range result {
		result[key] = strings.TrimSpace(value)
	}
	return result
}

func extractLeadingJSONObject(content string) (string, bool) {
	depth := 0
	inString := false
	escaped := false
	started := false
	for index, r := range content {
		if !started {
			if r == '{' {
				started = true
				depth = 1
			}
			continue
		}

		if escaped {
			escaped = false
			continue
		}
		if r == '\\' {
			escaped = true
			continue
		}
		if r == '"' {
			inString = !inString
			continue
		}
		if inString {
			continue
		}
		switch r {
		case '{':
			depth++
		case '}':
			depth--
			if depth == 0 {
				return content[:index+1], true
			}
		}
	}
	return "", false
}

func firstNonEmptyLine(content string) string {
	for _, line := range strings.Split(content, "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed != "" {
			return trimmed
		}
	}
	return ""
}
