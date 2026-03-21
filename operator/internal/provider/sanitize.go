// Package provider — tool name and schema sanitization.
//
// LLM providers have different rules for tool names and schemas.
// These functions normalize them for API compatibility:
//   - Anthropic: ^[a-zA-Z0-9_-]{1,128}$
//   - OpenAI/DeepSeek: similar restrictions
//   - All: input_schema must be valid JSON Schema with no extra fields
package provider

import "strings"

// SanitizeToolName replaces characters not allowed by LLM APIs with a
// reversible `__hh__` hex escape. Allowed characters are preserved as-is so
// normal tool names like `read_file` remain stable.
func SanitizeToolName(name string) string {
	if name == "" {
		return ""
	}

	var b strings.Builder
	b.Grow(len(name))

	for i := 0; i < len(name); i++ {
		ch := name[i]
		if isAllowedToolNameChar(ch) {
			b.WriteByte(ch)
			continue
		}
		b.WriteString("__")
		b.WriteByte(lowerHex[ch>>4])
		b.WriteByte(lowerHex[ch&0x0f])
		b.WriteString("__")
	}

	return b.String()
}

// UnsanitizeToolName restores `__hh__` escapes emitted by SanitizeToolName.
func UnsanitizeToolName(name string) string {
	if !strings.Contains(name, "__") {
		return name
	}

	var b strings.Builder
	b.Grow(len(name))

	for i := 0; i < len(name); {
		if i+6 <= len(name) &&
			name[i] == '_' &&
			name[i+1] == '_' &&
			isHexChar(name[i+2]) &&
			isHexChar(name[i+3]) &&
			name[i+4] == '_' &&
			name[i+5] == '_' {
			b.WriteByte(hexNibble(name[i+2])<<4 | hexNibble(name[i+3]))
			i += 6
			continue
		}

		b.WriteByte(name[i])
		i++
	}

	return b.String()
}

// SanitizeToolSchema normalizes a tool's input schema for strict LLM APIs.
// Ensures: type=object, properties exist, additionalProperties=false, valid required.
func SanitizeToolSchema(schema any) map[string]any {
	result := map[string]any{
		"type":                 "object",
		"properties":           map[string]any{},
		"additionalProperties": false,
	}
	m, ok := schema.(map[string]any)
	if !ok || m == nil {
		return result
	}

	properties := map[string]any{}
	if rawProps, ok := m["properties"].(map[string]any); ok {
		for key, value := range rawProps {
			properties[key] = sanitizeToolProperty(value)
		}
	}
	result["properties"] = properties

	required := sanitizeRequiredFields(m["required"], properties)
	if len(required) > 0 {
		result["required"] = required
	}

	return result
}

func sanitizeToolProperty(value any) map[string]any {
	property := map[string]any{}
	raw, _ := value.(map[string]any)

	if desc, _ := raw["description"].(string); strings.TrimSpace(desc) != "" {
		property["description"] = strings.TrimSpace(desc)
	}

	switch strings.TrimSpace(strings.ToLower(stringVal(raw["type"]))) {
	case "string", "number", "integer", "boolean":
		property["type"] = strings.TrimSpace(strings.ToLower(stringVal(raw["type"])))
		if enum := sanitizeEnum(raw["enum"]); len(enum) > 0 {
			property["enum"] = enum
		}
	case "array":
		property["type"] = "array"
		property["items"] = sanitizeToolArrayItems(raw["items"])
	case "object":
		property["type"] = "object"
		if nestedProps, ok := raw["properties"].(map[string]any); ok && len(nestedProps) > 0 {
			sanitized := map[string]any{}
			for key, nested := range nestedProps {
				sanitized[key] = sanitizeToolProperty(nested)
			}
			property["properties"] = sanitized
			property["additionalProperties"] = false
		} else {
			property["additionalProperties"] = true
		}
	default:
		property["type"] = "string"
	}

	return property
}

func sanitizeToolArrayItems(value any) map[string]any {
	raw, _ := value.(map[string]any)
	itemType := strings.TrimSpace(strings.ToLower(stringVal(raw["type"])))
	switch itemType {
	case "number", "integer", "boolean", "object":
		if itemType == "object" {
			return map[string]any{"type": "object", "additionalProperties": true}
		}
		return map[string]any{"type": itemType}
	default:
		return map[string]any{"type": "string"}
	}
}

func sanitizeRequiredFields(value any, properties map[string]any) []string {
	if len(properties) == 0 {
		return nil
	}
	allowed := make(map[string]bool, len(properties))
	for key := range properties {
		allowed[key] = true
	}

	var required []string
	switch typed := value.(type) {
	case []string:
		for _, item := range typed {
			if allowed[item] {
				required = append(required, item)
			}
		}
	case []any:
		for _, item := range typed {
			if text, ok := item.(string); ok && allowed[text] {
				required = append(required, text)
			}
		}
	}
	return required
}

func sanitizeEnum(value any) []string {
	switch typed := value.(type) {
	case []string:
		return append([]string{}, typed...)
	case []any:
		result := make([]string, 0, len(typed))
		for _, item := range typed {
			if text, ok := item.(string); ok && strings.TrimSpace(text) != "" {
				result = append(result, strings.TrimSpace(text))
			}
		}
		return result
	default:
		return nil
	}
}

func stringVal(value any) string {
	text, _ := value.(string)
	return text
}

var lowerHex = []byte("0123456789abcdef")

func isAllowedToolNameChar(ch byte) bool {
	return (ch >= 'a' && ch <= 'z') ||
		(ch >= 'A' && ch <= 'Z') ||
		(ch >= '0' && ch <= '9') ||
		ch == '_' ||
		ch == '-'
}

func isHexChar(ch byte) bool {
	return (ch >= '0' && ch <= '9') ||
		(ch >= 'a' && ch <= 'f') ||
		(ch >= 'A' && ch <= 'F')
}

func hexNibble(ch byte) byte {
	switch {
	case ch >= '0' && ch <= '9':
		return ch - '0'
	case ch >= 'a' && ch <= 'f':
		return ch - 'a' + 10
	case ch >= 'A' && ch <= 'F':
		return ch - 'A' + 10
	default:
		return 0
	}
}
