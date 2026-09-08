package tool

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
)

// Validate checks raw JSON input against a JSON-Schema subset (the bits
// every tool actually uses): type, required, properties, enum, items.
// Returns nil for valid input, otherwise a list of human-readable
// violation strings the model can act on.
//
// We deliberately don't pull in a full schema library — tool schemas
// stay simple by convention, and a focused validator gives us full
// control over error messages (which the model reads to self-correct).
func Validate(schema map[string]any, raw json.RawMessage) []string {
	var input any
	if len(raw) == 0 {
		input = nil
	} else if err := json.Unmarshal(raw, &input); err != nil {
		return []string{"input is not valid JSON: " + err.Error()}
	}
	return walk("", schema, input)
}

func walk(path string, schema map[string]any, val any) []string {
	if schema == nil {
		return nil
	}
	var out []string

	if t, ok := schema["type"].(string); ok && t != "" {
		if msg := checkType(path, t, val); msg != "" {
			out = append(out, msg)
			return out // can't dig deeper if type is already wrong
		}
	}

	if enum, ok := schema["enum"].([]any); ok && val != nil {
		match := false
		for _, e := range enum {
			if fmt.Sprintf("%v", e) == fmt.Sprintf("%v", val) {
				match = true
				break
			}
		}
		if !match {
			out = append(out, fmt.Sprintf("%s must be one of %v, got %v", fieldLabel(path), enum, val))
		}
	}

	if obj, ok := val.(map[string]any); ok {
		if req, ok := schema["required"].([]any); ok {
			for _, r := range req {
				name, _ := r.(string)
				if name == "" {
					continue
				}
				if _, present := obj[name]; !present {
					out = append(out, fmt.Sprintf("%s is missing required field %q", fieldLabel(path), name))
				}
			}
		}
		if props, ok := schema["properties"].(map[string]any); ok {
			for name, propSchema := range props {
				p, _ := propSchema.(map[string]any)
				if v, present := obj[name]; present {
					out = append(out, walk(joinPath(path, name), p, v)...)
				}
			}
		}
	}

	if arr, ok := val.([]any); ok {
		if items, ok := schema["items"].(map[string]any); ok {
			for i, v := range arr {
				out = append(out, walk(fmt.Sprintf("%s[%d]", path, i), items, v)...)
			}
		}
	}

	return out
}

func checkType(path, want string, val any) string {
	if val == nil {
		// JSON Schema treats null as a distinct type; we don't require
		// it elsewhere and allow null-as-omitted at top-level.
		if path == "" {
			return ""
		}
		return fmt.Sprintf("%s must be %s, got null", fieldLabel(path), want)
	}
	got := typeOf(val)
	if got == want {
		return ""
	}
	// number accepts integer
	if want == "number" && got == "integer" {
		return ""
	}
	if want == "integer" && got == "number" {
		// allow integer-valued numbers
		if f, ok := val.(float64); ok && f == float64(int64(f)) {
			return ""
		}
	}
	return fmt.Sprintf("%s must be %s, got %s", fieldLabel(path), want, got)
}

func typeOf(v any) string {
	switch x := v.(type) {
	case nil:
		return "null"
	case bool:
		return "boolean"
	case string:
		return "string"
	case float64:
		if x == float64(int64(x)) {
			return "integer"
		}
		return "number"
	case []any:
		return "array"
	case map[string]any:
		return "object"
	default:
		return fmt.Sprintf("%T", v)
	}
}

func fieldLabel(path string) string {
	if path == "" {
		return "input"
	}
	return "field " + strconv.Quote(path)
}

func joinPath(parent, name string) string {
	if parent == "" {
		return name
	}
	return parent + "." + name
}

// FormatViolations renders violations into a single block of text suitable
// for returning as a tool_result body. Includes a hint so the model knows
// what to do next.
func FormatViolations(toolName string, violations []string) string {
	var b strings.Builder
	fmt.Fprintf(&b, "input validation failed for tool %q:\n", toolName)
	for _, v := range violations {
		b.WriteString("  - ")
		b.WriteString(v)
		b.WriteByte('\n')
	}
	b.WriteString("hint: re-call the tool with arguments matching its input_schema; you can call space_list_actions first if you're unsure of the shape.")
	return b.String()
}
