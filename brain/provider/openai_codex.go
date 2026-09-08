package provider

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// OpenAICodex implements Provider against ChatGPT's Codex backend
// (chatgpt.com/backend-api/codex/responses) — the path ChatGPT Plus/Pro
// users get when they sign in with OAuth. Different from api.openai.com
// in two ways: Responses-API request shape (not chat completions), and
// SSE event names that need translation to brain's Event types.
//
// Auth: Bearer access token from the OAuth flow, plus an optional
// ChatGPT-Account-Id header parsed from the JWT.
type OpenAICodex struct {
	Tokens    TokenSource
	AccountID string
	HTTP      *http.Client
}

func NewOpenAICodex(tokens TokenSource, accountID string) *OpenAICodex {
	return &OpenAICodex{
		Tokens:    tokens,
		AccountID: accountID,
		HTTP:      http.DefaultClient,
	}
}

func (o *OpenAICodex) Name() string { return "openai-codex" }

const codexEndpoint = "https://chatgpt.com/backend-api/codex/responses"

func (o *OpenAICodex) Stream(ctx context.Context, req Request, emit func(Event)) error {
	if o.Tokens == nil {
		return fmt.Errorf("openai-codex: no token source (link ChatGPT via Settings → Providers)")
	}
	token, err := o.Tokens.Token(ctx)
	if err != nil {
		return fmt.Errorf("openai-codex: %w", err)
	}

	body, err := o.buildBody(req)
	if err != nil {
		return err
	}
	httpReq, err := http.NewRequestWithContext(ctx, "POST", codexEndpoint, bytes.NewReader(body))
	if err != nil {
		return err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "text/event-stream")
	httpReq.Header.Set("Authorization", "Bearer "+token)
	if o.AccountID != "" {
		httpReq.Header.Set("ChatGPT-Account-Id", o.AccountID)
	}
	httpReq.Header.Set("User-Agent", "construct-brain")

	resp, err := o.HTTP.Do(httpReq)
	if err != nil {
		return fmt.Errorf("openai-codex: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		raw, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("openai-codex: HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(raw)))
	}
	return parseCodexSSE(resp.Body, emit)
}

func (o *OpenAICodex) buildBody(req Request) ([]byte, error) {
	// Responses API: messages → flat `input` array. Tool calls become
	// `function_call` items; tool results become `function_call_output`.
	input := make([]map[string]any, 0, len(req.Messages))
	for _, m := range req.Messages {
		role := m.Role
		switch role {
		case "tool":
			for _, b := range m.Content {
				if b.Type == "tool_result" && b.ToolResult != nil {
					input = append(input, map[string]any{
						"type":    "function_call_output",
						"call_id": b.ToolResult.ToolUseID,
						"output":  b.ToolResult.Content,
					})
				}
			}
			continue
		case "user":
			var text strings.Builder
			var imageParts []map[string]any
			for _, b := range m.Content {
				if b.Type == "text" && b.Text != "" {
					if text.Len() > 0 {
						text.WriteByte('\n')
					}
					text.WriteString(b.Text)
				}
				if b.Type == "image" && b.Image != nil {
					// Responses API expects input_image with an image_url
					// (data: URLs are accepted in the same field).
					url := b.Image.URL
					if url == "" && b.Image.Data != "" {
						url = "data:" + b.Image.MediaType + ";base64," + b.Image.Data
					}
					if url != "" {
						imageParts = append(imageParts, map[string]any{
							"type":      "input_image",
							"image_url": url,
						})
					}
				}
				if b.Type == "tool_result" && b.ToolResult != nil {
					input = append(input, map[string]any{
						"type":    "function_call_output",
						"call_id": b.ToolResult.ToolUseID,
						"output":  b.ToolResult.Content,
					})
				}
			}
			if len(imageParts) > 0 {
				parts := make([]map[string]any, 0, 1+len(imageParts))
				if text.Len() > 0 {
					parts = append(parts, map[string]any{"type": "input_text", "text": text.String()})
				}
				parts = append(parts, imageParts...)
				input = append(input, map[string]any{"role": "user", "content": parts})
			} else if text.Len() > 0 {
				input = append(input, map[string]any{"role": "user", "content": text.String()})
			}
		case "assistant":
			var text strings.Builder
			var calls []map[string]any
			for _, b := range m.Content {
				if b.Type == "text" && b.Text != "" {
					if text.Len() > 0 {
						text.WriteByte('\n')
					}
					text.WriteString(b.Text)
				}
				if b.Type == "tool_use" && b.ToolUse != nil {
					argsJSON, _ := json.Marshal(b.ToolUse.Input)
					id := b.ToolUse.ID
					if id == "" {
						id = b.ToolUse.Name
					}
					calls = append(calls, map[string]any{
						"type":      "function_call",
						"name":      b.ToolUse.Name,
						"arguments": string(argsJSON),
						"call_id":   id,
					})
				}
			}
			if text.Len() > 0 {
				input = append(input, map[string]any{"role": "assistant", "content": text.String()})
			}
			input = append(input, calls...)
		}
	}
	if len(input) == 0 {
		input = []map[string]any{{"role": "user", "content": ""}}
	}

	instructions := "You are Construct, a helpful coding assistant."
	if req.System != "" {
		instructions = req.System
	}

	payload := map[string]any{
		"model":        stripProviderPrefix(req.Model),
		"instructions": instructions,
		"input":        input,
		"store":        false,
		"stream":       true,
	}
	if len(req.Tools) > 0 {
		tools := make([]map[string]any, 0, len(req.Tools))
		for _, t := range req.Tools {
			tools = append(tools, map[string]any{
				"type":        "function",
				"name":        t.Name,
				"description": t.Description,
				"parameters":  t.InputSchema,
				"strict":      false,
			})
		}
		payload["tools"] = tools
		payload["tool_choice"] = "auto"
	}
	return json.Marshal(payload)
}

// parseCodexSSE translates the Responses-API event stream into brain's
// Event types. Codex emits one `event: <name>` line followed by `data:`,
// unlike chat-completions which only sends `data:` lines — we track the
// current event name across iterations.
func parseCodexSSE(body io.Reader, emit func(Event)) error {
	scanner := bufio.NewScanner(body)
	scanner.Buffer(make([]byte, 1<<20), 1<<24)

	currentEvent := ""
	textOpenAt := -1
	toolIdx := 0
	openTools := map[string]int{} // call_id → block index
	for scanner.Scan() {
		line := scanner.Text()
		if rest, ok := strings.CutPrefix(line, "event: "); ok {
			currentEvent = strings.TrimSpace(rest)
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
			var pl struct {
				Delta string `json:"delta"`
			}
			if json.Unmarshal([]byte(data), &pl) == nil && pl.Delta != "" {
				if textOpenAt == -1 {
					textOpenAt = 0
					emit(Event{Type: "text_start", Index: 0})
				}
				emit(Event{Type: "text_delta", Index: 0, TextDelta: pl.Delta})
			}
		case "response.output_item.done":
			var pl struct {
				Item struct {
					Type      string `json:"type"`
					ID        string `json:"id"`
					CallID    string `json:"call_id"`
					Name      string `json:"name"`
					Arguments string `json:"arguments"`
				} `json:"item"`
			}
			if json.Unmarshal([]byte(data), &pl) == nil && pl.Item.Type == "function_call" {
				callID := pl.Item.CallID
				if callID == "" {
					callID = pl.Item.ID
				}
				toolIdx++
				idx := toolIdx
				openTools[callID] = idx
				emit(Event{Type: "tool_use_start", Index: idx, ToolUseID: callID, ToolName: pl.Item.Name})
				if pl.Item.Arguments != "" {
					emit(Event{Type: "tool_use_input_delta", Index: idx, InputDelta: pl.Item.Arguments})
				}
				emit(Event{Type: "block_stop", Index: idx})
			}
		case "response.failed", "error":
			var pl struct {
				Error struct {
					Message string `json:"message"`
				} `json:"error"`
			}
			msg := data
			if json.Unmarshal([]byte(data), &pl) == nil && pl.Error.Message != "" {
				msg = pl.Error.Message
			}
			return fmt.Errorf("codex stream error: %s", msg)
		case "response.completed":
			var pl struct {
				Response struct {
					Usage struct {
						InputTokens        int `json:"input_tokens"`
						OutputTokens       int `json:"output_tokens"`
						InputTokensDetails struct {
							CachedTokens int `json:"cached_tokens"`
						} `json:"input_tokens_details"`
					} `json:"usage"`
				} `json:"response"`
			}
			if json.Unmarshal([]byte(data), &pl) == nil {
				u := pl.Response.Usage
				if u.InputTokens > 0 || u.OutputTokens > 0 {
					emit(Event{Type: "usage", Usage: Usage{
						InputTokens:  u.InputTokens,
						OutputTokens: u.OutputTokens,
						CacheRead:    u.InputTokensDetails.CachedTokens,
					}})
				}
			}
			if textOpenAt != -1 {
				emit(Event{Type: "block_stop", Index: 0})
			}
			stop := "end_turn"
			if len(openTools) > 0 {
				stop = "tool_use"
			}
			emit(Event{Type: "stop", StopReason: stop})
			return scanner.Err()
		}
	}
	return scanner.Err()
}
