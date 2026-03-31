// OpenAI Codex OAuth provider — uses ChatGPT OAuth tokens via chatgpt.com backend API.
// This is how ChatGPT Plus/Pro users access OpenAI models without a separate API key.
// Uses the Responses API at chatgpt.com/backend-api/codex/responses.
package connectors

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"construct-operator/internal/provider"
	"construct-operator/internal/provider/helpers"
)

const codexBaseURL = "https://chatgpt.com/backend-api/codex"

// CodexOAuthConfig configures the Codex OAuth provider.
type CodexOAuthConfig struct {
	AccessToken  string
	AccountID    string // ChatGPT account ID from JWT claims
	RefreshToken string
	Models       []string
}

type CodexOAuthProvider struct {
	config CodexOAuthConfig
}

// NewCodexOAuthFromFile loads Codex OAuth tokens from ~/.codex/auth.json
// and creates a CodexOAuthProvider for the chatgpt.com backend API.
// Returns nil if the file doesn't exist or has no token.
func NewCodexOAuthFromFile() *CodexOAuthProvider {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil
	}
	data, err := os.ReadFile(filepath.Join(home, ".codex", "auth.json"))
	if err != nil {
		return nil
	}

	var auth struct {
		Tokens struct {
			AccessToken  string `json:"access_token"`
			RefreshToken string `json:"refresh_token"`
		} `json:"tokens"`
		AccountID string `json:"account_id"`
	}
	if err := json.Unmarshal(data, &auth); err != nil || auth.Tokens.AccessToken == "" {
		return nil
	}

	return NewCodexOAuth(CodexOAuthConfig{
		AccessToken:  auth.Tokens.AccessToken,
		RefreshToken: auth.Tokens.RefreshToken,
		AccountID:    auth.AccountID,
	})
}

func NewCodexOAuth(cfg CodexOAuthConfig) *CodexOAuthProvider {
	if len(cfg.Models) == 0 {
		cfg.Models = []string{"gpt-5.4", "gpt-5.4-mini", "gpt-5.3-codex", "gpt-5.3-codex-spark", "gpt-5.2-codex", "gpt-5.2", "gpt-5.1-codex-max", "gpt-5.1-codex-mini"}
	}
	return &CodexOAuthProvider{config: cfg}
}

func (p *CodexOAuthProvider) ID() string       { return "openai-oauth" }
func (p *CodexOAuthProvider) Models() []string { return p.config.Models }

func (p *CodexOAuthProvider) Capabilities() provider.Capabilities {
	return provider.Capabilities{
		SupportsStructuredOutput: false, // Codex Responses API format differs
		SupportsTools:            true,
		SupportsStreaming:         true,
		MaxContextTokens:         128000,
	}
}

func (p *CodexOAuthProvider) HealthCheck(ctx context.Context) error {
	// Verify the token works by checking the Codex endpoint is reachable
	httpReq, err := http.NewRequestWithContext(ctx, "GET", codexBaseURL, nil)
	if err != nil {
		return err
	}
	httpReq.Header.Set("Authorization", "Bearer "+p.config.AccessToken)
	resp, err := http.DefaultClient.Do(httpReq)
	if err != nil {
		return fmt.Errorf("openai-oauth health check failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode == 401 || resp.StatusCode == 403 {
		return fmt.Errorf("openai-oauth auth error: %d", resp.StatusCode)
	}
	return nil
}

func (p *CodexOAuthProvider) Complete(ctx context.Context, req *provider.Request) (*provider.Response, error) {
	// Collect streaming response into a single response
	ch, err := p.Stream(ctx, req)
	if err != nil {
		return nil, err
	}

	var content string
	var toolCalls []provider.ToolCall
	var finalResp *provider.Response

	for event := range ch {
		switch event.Type {
		case "text_delta":
			content += event.Text
		case "tool_call_done":
			if event.ToolCall != nil {
				toolCalls = append(toolCalls, *event.ToolCall)
			}
		case "done":
			finalResp = event.Response
		case "error":
			return nil, fmt.Errorf("Codex stream error: %s", event.Error)
		}
	}

	if finalResp != nil {
		return finalResp, nil
	}

	return &provider.Response{
		Content:    content,
		ToolCalls:  toolCalls,
		StopReason: "end_turn",
	}, nil
}

func (p *CodexOAuthProvider) Stream(ctx context.Context, req *provider.Request) (<-chan provider.StreamEvent, error) {
	// Build Codex Responses API payload
	payload := p.buildPayload(req)

	data, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}

	httpReq, err := http.NewRequestWithContext(ctx, "POST", codexBaseURL+"/responses", bytes.NewReader(data))
	if err != nil {
		return nil, err
	}

	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "text/event-stream")
	httpReq.Header.Set("Authorization", "Bearer "+p.config.AccessToken)
	if p.config.AccountID != "" {
		httpReq.Header.Set("ChatGPT-Account-Id", p.config.AccountID)
	}
	httpReq.Header.Set("User-Agent", "construct-operator")

	resp, err := http.DefaultClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("Codex API error: %v", err)
	}

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		return nil, fmt.Errorf("Codex API error %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	ch := make(chan provider.StreamEvent, 64)
	go p.readCodexSSE(resp.Body, ch)
	return ch, nil
}

func (p *CodexOAuthProvider) buildPayload(req *provider.Request) map[string]any {
	// Build input array from messages (Codex Responses API format)
	input := make([]map[string]any, 0, len(req.Messages))

	for _, m := range req.Messages {
		role := strings.ToLower(m.Role)

		// Tool results → function_call_output
		if role == "tool" && m.ToolResult != nil {
			input = append(input, map[string]any{
				"type":    "function_call_output",
				"call_id": m.ToolResult.CallID,
				"output":  m.ToolResult.Content,
			})
			continue
		}

		// Assistant with tool calls → content + function_call items
		if role == "assistant" && len(m.ToolCalls) > 0 {
			if strings.TrimSpace(m.Content) != "" {
				input = append(input, map[string]any{
					"role":    "assistant",
					"content": m.Content,
				})
			}
			for _, tc := range m.ToolCalls {
				callID := tc.ID
				if callID == "" {
					callID = tc.Name
				}
				args := tc.Input
				if args == "" {
					args = "{}"
				}
				input = append(input, map[string]any{
					"type":      "function_call",
					"name":      helpers.SanitizeToolName(tc.Name),
					"arguments": args,
					"call_id":   callID,
				})
			}
			continue
		}

		// Skip system messages (handled via instructions)
		if role == "system" {
			continue
		}

		input = append(input, map[string]any{
			"role":    role,
			"content": m.Content,
		})
	}

	if len(input) == 0 {
		input = []map[string]any{{"role": "user", "content": ""}}
	}

	instructions := "You are Construct, a helpful coding assistant."
	if req.System != "" {
		instructions = req.System
	}

	payload := map[string]any{
		"model":        req.Model,
		"instructions": instructions,
		"input":        input,
		"store":        false,
		"stream":       true,
	}

	if len(req.Tools) > 0 {
		tools := make([]map[string]any, 0, len(req.Tools))
		for _, toolDef := range req.Tools {
			if strings.TrimSpace(toolDef.Name) == "" {
				continue
			}
			tools = append(tools, map[string]any{
				"type":        "function",
				"name":        helpers.SanitizeToolName(toolDef.Name),
				"description": toolDef.Description,
				"parameters":  helpers.SanitizeToolSchema(toolDef.InputSchema),
				"strict":      false,
			})
		}
		if len(tools) > 0 {
			payload["tools"] = tools
			toolChoice := strings.TrimSpace(req.ToolChoice)
			if toolChoice == "" {
				toolChoice = "auto"
			}
			payload["tool_choice"] = toolChoice
		}
	}

	return payload
}

// Old sanitize functions moved to sanitize.go

func (p *CodexOAuthProvider) readCodexSSE(body io.ReadCloser, ch chan<- provider.StreamEvent) {
	defer body.Close()
	defer close(ch)

	var textContent string
	var toolCalls []provider.ToolCall
	textPartsWithDelta := make(map[string]bool)
	currentEvent := ""

	scanner := bufio.NewScanner(body)
	scanner.Buffer(make([]byte, 0, 64*1024), 10*1024*1024)

	for scanner.Scan() {
		line := scanner.Text()

		if after, found := strings.CutPrefix(line, "event: "); found {
			currentEvent = strings.TrimSpace(after)
			continue
		}

		if !strings.HasPrefix(line, "data: ") {
			continue
		}

		data := strings.TrimSpace(strings.TrimPrefix(line, "data: "))
		if data == "" || data == "[DONE]" {
			continue
		}

		switch currentEvent {
		case "response.output_text.delta":
			var payload struct {
				Delta        string `json:"delta"`
				ItemID       string `json:"item_id"`
				ContentIndex int    `json:"content_index"`
			}
			if err := json.Unmarshal([]byte(data), &payload); err == nil && payload.Delta != "" {
				key := fmt.Sprintf("%s:%d", payload.ItemID, payload.ContentIndex)
				textPartsWithDelta[key] = true
				textContent += payload.Delta
				ch <- provider.StreamEvent{Type: "text_delta", Text: payload.Delta}
			}

		case "response.output_text.done":
			var payload struct {
				Text         string `json:"text"`
				ItemID       string `json:"item_id"`
				ContentIndex int    `json:"content_index"`
			}
			if err := json.Unmarshal([]byte(data), &payload); err == nil && payload.Text != "" {
				key := fmt.Sprintf("%s:%d", payload.ItemID, payload.ContentIndex)
				if !textPartsWithDelta[key] {
					textPartsWithDelta[key] = true
					textContent += payload.Text
					ch <- provider.StreamEvent{Type: "text_delta", Text: payload.Text}
				}
			}

		case "response.output_item.done":
			var payload struct {
				Item struct {
					ID        string `json:"id"`
					Type      string `json:"type"`
					CallID    string `json:"call_id"`
					Name      string `json:"name"`
					Arguments string `json:"arguments"`
				} `json:"item"`
			}
			if err := json.Unmarshal([]byte(data), &payload); err == nil && payload.Item.Type == "function_call" {
				callID := payload.Item.CallID
				if callID == "" {
					callID = payload.Item.ID
				}
				toolCall := provider.ToolCall{
					ID:    callID,
					Name:  helpers.UnsanitizeToolName(payload.Item.Name),
					Input: payload.Item.Arguments,
				}
				toolCalls = append(toolCalls, toolCall)
				ch <- provider.StreamEvent{
					Type:     "tool_call_done",
					ToolCall: &toolCall,
				}
			}

		case "response.failed", "error":
			var payload struct {
				Error struct {
					Message string `json:"message"`
				} `json:"error"`
			}
			if err := json.Unmarshal([]byte(data), &payload); err == nil && payload.Error.Message != "" {
				ch <- provider.StreamEvent{Type: "error", Error: payload.Error.Message}
			} else {
				ch <- provider.StreamEvent{Type: "error", Error: data}
			}
			return

		case "response.completed":
			stopReason := "end_turn"
			if len(toolCalls) > 0 {
				stopReason = "tool_use"
			}
			ch <- provider.StreamEvent{
				Type: "done",
				Response: &provider.Response{
					Content:    textContent,
					ToolCalls:  append([]provider.ToolCall(nil), toolCalls...),
					StopReason: stopReason,
				},
			}
			return
		}
	}

	// EOF without explicit completion
	stopReason := "end_turn"
	if len(toolCalls) > 0 {
		stopReason = "tool_use"
	}
	ch <- provider.StreamEvent{
		Type: "done",
		Response: &provider.Response{
			Content:    textContent,
			ToolCalls:  append([]provider.ToolCall(nil), toolCalls...),
			StopReason: stopReason,
		},
	}
}
