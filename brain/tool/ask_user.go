package tool

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/construct-space/brain/bridge"
)

// AskUser surfaces a question to the user mid-turn and waits for the
// answer. Routes through the frontend SSE channel (brain.Frontend.Call
// with method "user.ask"), which the desktop app's bridgeListener turns
// into a modal. The model gets the user's reply as the tool result.
//
// Should only be used when truly blocked — operator's prompt language is
// "do NOT use to offer options; only when you cannot proceed without an
// answer". We carry that through verbatim.
type AskUser struct {
	Frontend *bridge.Frontend
}

func (AskUser) Name() string { return "ask_user" }

func (AskUser) Description() string {
	return "Ask the user a question when you genuinely need their input to proceed. Use this when you're blocked and need clarification, a decision, or information that can't be found in the codebase. Do NOT use this to offer options or suggestions — only when you cannot proceed without the user's answer."
}

func (AskUser) InputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"question": map[string]any{
				"type":        "string",
				"description": "The question to ask the user. Be specific about what you need to know and why.",
			},
		},
		"required": []string{"question"},
	}
}

func (a AskUser) Execute(ctx context.Context, raw json.RawMessage) (string, error) {
	var in struct {
		Question string `json:"question"`
	}
	if err := json.Unmarshal(raw, &in); err != nil {
		return "", fmt.Errorf("invalid input: %w", err)
	}
	if in.Question == "" {
		return "", fmt.Errorf("question is required")
	}
	if a.Frontend == nil || !a.Frontend.Available() {
		return "", fmt.Errorf("ask_user requires an active prompt stream (frontend channel not connected)")
	}
	out, err := a.Frontend.Call(ctx, "user.ask", map[string]any{"question": in.Question})
	if err != nil {
		return "", err
	}
	var resp struct {
		Answer string `json:"answer"`
	}
	if err := json.Unmarshal(out, &resp); err != nil {
		// Frontend can return bare string too — accept that as the answer.
		var s string
		if json.Unmarshal(out, &s) == nil && s != "" {
			return s, nil
		}
		return "", fmt.Errorf("invalid user.ask response: %w", err)
	}
	if resp.Answer == "" {
		return "(user dismissed without answer)", nil
	}
	return resp.Answer, nil
}
