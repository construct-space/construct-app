// tools.call — single-tool execution from the frontend. Used by space
// composables that need to read directory listings, run a quick shell
// command, etc. without spinning up a full agent prompt. Mirrors the
// operator-era `tools.call` surface so the project space composables
// can swap from useOperator.callTool to brain.request('tools.call')
// without rewriting their callsites.
//
// Wire shape — accepts BOTH the legacy operator format and a flat name+args:
//
//	{ "name": "list_dir", "arguments": { "path": "/tmp" } }
//	{ "toolCall": { "id": "...", "type": "function",
//	  "function": { "name": "list_dir", "arguments": "{...}" } } }
//
// `arguments` may arrive as a JSON object OR a string that needs
// re-parsing — operator clients quote the args field; flat callers don't.
package main

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/construct-space/brain/bridge"
	"github.com/construct-space/brain/sidecar"
	"github.com/construct-space/brain/tool"
	"github.com/construct-space/brain/wire"
)

type toolsCallDeps struct {
	Tools *tool.Registry
	// Permission gating inputs — the agent loop runs every tool through
	// buildPermissionGate, but tools.call is a separate, direct entry point
	// (space composables call it for list_dir/path_exists). Without these it
	// would let a caller run bash/write/edit in strict/ask mode, bypassing
	// the gate entirely. Same inputs as the agent-loop gate.
	DataDir  string
	Frontend *bridge.Frontend
	PermMem  *permissionMemory
}

func registerToolsCallHandler(s *sidecar.Server, deps toolsCallDeps) {
	s.Handle("tools.call", func(ctx context.Context, req wire.Request, emit func(wire.Response)) {
		var raw map[string]json.RawMessage
		_ = json.Unmarshal(req.Payload, &raw)

		name, args, err := extractToolCall(raw)
		if err != nil {
			emit(wire.Response{ID: req.ID, Success: false, Error: err.Error(), Done: true})
			return
		}

		// Apply the same permission gate the agent loop uses. nil gate
		// (default/yolo mode) is the common case and skips the check.
		if gate := buildPermissionGate(deps.DataDir, deps.Frontend, deps.PermMem); gate != nil {
			if decision := gate(ctx, name, args); !decision.Allow {
				emit(wire.Response{
					ID:      req.ID,
					Success: true,
					Data: map[string]any{
						"content":  fmt.Sprintf("permission denied for tool %q: %s", name, decision.Reason),
						"is_error": true,
					},
					Done: true,
				})
				return
			}
		}

		t, ok := deps.Tools.Get(name)
		if !ok {
			emit(wire.Response{
				ID:      req.ID,
				Success: true,
				Data: map[string]any{
					"content":  fmt.Sprintf("unknown tool: %s", name),
					"is_error": true,
				},
				Done: true,
			})
			return
		}

		content, execErr := t.Execute(ctx, args)
		if execErr != nil {
			emit(wire.Response{
				ID:      req.ID,
				Success: true,
				Data: map[string]any{
					"content":  execErr.Error(),
					"is_error": true,
				},
				Done: true,
			})
			return
		}
		emit(wire.Response{
			ID:      req.ID,
			Success: true,
			Data: map[string]any{
				"content":  content,
				"is_error": false,
			},
			Done: true,
		})
	})
}

// extractToolCall handles both the flat shape ({name, arguments}) and
// the operator function-call envelope ({toolCall:{function:{name, arguments}}}).
// `arguments` may be a raw JSON object or a stringified JSON blob.
func extractToolCall(raw map[string]json.RawMessage) (string, json.RawMessage, error) {
	if tcRaw, ok := raw["toolCall"]; ok {
		var tc struct {
			Function struct {
				Name      string          `json:"name"`
				Arguments json.RawMessage `json:"arguments"`
			} `json:"function"`
		}
		if err := json.Unmarshal(tcRaw, &tc); err != nil {
			return "", nil, fmt.Errorf("parse toolCall: %w", err)
		}
		if tc.Function.Name == "" {
			return "", nil, fmt.Errorf("toolCall.function.name is required")
		}
		return tc.Function.Name, decodeMaybeQuotedJSON(tc.Function.Arguments), nil
	}

	var name string
	if n, ok := raw["name"]; ok {
		_ = json.Unmarshal(n, &name)
	}
	if name == "" {
		return "", nil, fmt.Errorf("name is required")
	}
	args := raw["arguments"]
	if args == nil {
		args = raw["input"]
	}
	return name, decodeMaybeQuotedJSON(args), nil
}

// decodeMaybeQuotedJSON handles operator clients that send the
// `arguments` field as a JSON-encoded string of JSON. If `raw` is a
// quoted string that parses as JSON, return the inner bytes; otherwise
// return raw as-is. Lets tool Execute methods receive a stable
// object-shaped json.RawMessage regardless of caller convention.
func decodeMaybeQuotedJSON(raw json.RawMessage) json.RawMessage {
	if len(raw) == 0 {
		return raw
	}
	if raw[0] != '"' {
		return raw
	}
	var s string
	if err := json.Unmarshal(raw, &s); err != nil {
		return raw
	}
	return json.RawMessage(s)
}
