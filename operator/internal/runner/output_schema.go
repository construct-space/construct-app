package runner

import (
	"encoding/json"

	"construct-operator/internal/provider"
)

// builtinOutputSchema returns the structured output config for a builtin
// schema key, or nil if the key is not recognized. Only builtin schemas
// are supported in v1 — space-defined schemas are display-time only.
func builtinOutputSchema(key string) *provider.OutputSchemaConfig {
	switch key {
	case "architect.v1":
		return &provider.OutputSchemaConfig{
			Name:   "architect.v1",
			Strict: true,
			Schema: json.RawMessage(architectV1Schema),
		}
	default:
		return nil
	}
}

// architectV1Schema is the JSON Schema for the architect.v1 envelope.
// Matches the Zod schema in frontend/spaces/architect/assistant/schema.ts.
const architectV1Schema = `{
  "type": "object",
  "required": ["version", "state"],
  "additionalProperties": false,
  "properties": {
    "version": { "type": "string", "enum": ["architect.v1"] },
    "state": { "type": "string", "enum": ["questions", "plan", "progress"] },
    "questions": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "question", "type", "options"],
        "additionalProperties": false,
        "properties": {
          "id": { "type": "string" },
          "question": { "type": "string" },
          "type": { "type": "string", "enum": ["single", "multi"] },
          "options": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["value", "label"],
              "additionalProperties": false,
              "properties": {
                "value": { "type": "string" },
                "label": { "type": "string" },
                "description": { "type": "string" },
                "icon": { "type": "string" }
              }
            }
          }
        }
      }
    },
    "title": { "type": "string" },
    "summary": { "type": "string" },
    "decisions": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["label", "value"],
        "additionalProperties": false,
        "properties": {
          "label": { "type": "string" },
          "value": { "type": "string" }
        }
      }
    },
    "docs": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["path", "title"],
        "additionalProperties": false,
        "properties": {
          "path": { "type": "string" },
          "title": { "type": "string" }
        }
      }
    },
    "next_actions": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "label"],
        "additionalProperties": false,
        "properties": {
          "id": { "type": "string" },
          "label": { "type": "string" }
        }
      }
    },
    "message": { "type": "string" }
  }
}`
