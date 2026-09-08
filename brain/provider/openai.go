package provider

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
)

// OpenAI implements Provider against the chat-completions SSE API. Same
// wire format powers DeepSeek, Xiaomi (MiMo), OpenRouter, Together, and
// any OpenAI-compatible vLLM/llama.cpp server — they only differ in
// BaseURL and APIKey. Construct in main.go for each `provider` slug.
type OpenAI struct {
	APIKey  string
	BaseURL string // e.g. https://api.openai.com/v1
	HTTP    *http.Client

	// Slug is the provider's catalog id ("openai" | "deepseek" | …).
	// Used as the Name() so telemetry / logs say the right thing.
	Slug string
}

func NewOpenAI(slug, baseURL, apiKey string) *OpenAI {
	if baseURL == "" {
		baseURL = "https://api.openai.com/v1"
	}
	return &OpenAI{Slug: slug, APIKey: apiKey, BaseURL: baseURL, HTTP: http.DefaultClient}
}

func (o *OpenAI) Name() string {
	if o.Slug != "" {
		return o.Slug
	}
	return "openai"
}

func (o *OpenAI) Stream(ctx context.Context, req Request, emit func(Event)) error {
	if o.APIKey == "" {
		return fmt.Errorf("%s: API key is required", o.Name())
	}
	body, err := o.buildBody(req)
	if err != nil {
		return err
	}
	url := strings.TrimRight(o.BaseURL, "/") + "/chat/completions"
	httpReq, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "text/event-stream")
	httpReq.Header.Set("Authorization", "Bearer "+o.APIKey)

	resp, err := o.HTTP.Do(httpReq)
	if err != nil {
		return fmt.Errorf("%s: %w", o.Name(), err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("%s: HTTP %d: %s", o.Name(), resp.StatusCode, strings.TrimSpace(string(b)))
	}

	// Surface Construct gateway routing metadata if present (set by
	// provider-api's Source Family dispatcher). The UI renders these as
	// a chip under the assistant message. Other OpenAI-compat upstreams
	// (Together, Fireworks direct, etc.) don't emit X-Construct-* headers
	// so this is silently a no-op.
	if op := resp.Header.Get("X-Construct-Operator"); op != "" {
		emit(Event{
			Type: "routing",
			Routing: Routing{
				Operator:              op,
				Slot:                  resp.Header.Get("X-Construct-Routing-Slot"),
				RoutingTarget:         resp.Header.Get("X-Construct-Routing-Target"),
				Upstream:              resp.Header.Get("X-Construct-Upstream"),
				CreditsUsed:      headerInt(resp.Header, "X-Construct-Credits-Daily-Used"),
				CreditsAllowance: headerInt(resp.Header, "X-Construct-Credits-Daily-Allowance"),
				CreditsBalance:   headerInt(resp.Header, "X-Construct-Credits-Paid-Balance"),
			},
		})
	}

	return parseOpenAISSE(resp.Body, emit)
}

// headerInt parses a response header as a non-negative int; returns 0
// when missing or malformed. Used for the X-Construct-Credits-* headers
// the gateway emits alongside routing decisions.
func headerInt(h http.Header, key string) int {
	v := strings.TrimSpace(h.Get(key))
	if v == "" {
		return 0
	}
	n, err := strconv.Atoi(v)
	if err != nil || n < 0 {
		return 0
	}
	return n
}

func (o *OpenAI) buildBody(req Request) ([]byte, error) {
	body := map[string]any{
		"model":    stripProviderPrefix(req.Model),
		"messages": convertOpenAIMessages(req.System, req.Messages),
		"stream":   true,
	}
	if req.MaxTokens > 0 {
		body["max_tokens"] = req.MaxTokens
	}
	if req.Temperature != nil {
		body["temperature"] = *req.Temperature
	}
	// Forward the Construct gateway tier hint — but ONLY to the
	// Construct gateway. provider-api's /api/inference/v1 dispatcher
	// strips it before forwarding upstream, so it never leaks from
	// there; sending it to a foreign OpenAI-compat endpoint directly
	// (api.openai.com, strict clones) is a hard 400 "unrecognized
	// request argument".
	if t := req.Tier; o.Name() == "construct" && (t == "large" || t == "medium" || t == "small") {
		body["tier"] = t
	}
	if len(req.Tools) > 0 {
		tools := make([]map[string]any, len(req.Tools))
		for i, t := range req.Tools {
			tools[i] = map[string]any{
				"type": "function",
				"function": map[string]any{
					"name":        t.Name,
					"description": t.Description,
					"parameters":  t.InputSchema,
				},
			}
		}
		body["tools"] = tools
	}
	// Ask the server to include usage in the final chunk (OpenAI + most clones).
	body["stream_options"] = map[string]any{"include_usage": true}
	return json.Marshal(body)
}

func convertOpenAIMessages(system string, msgs []Message) []map[string]any {
	out := make([]map[string]any, 0, len(msgs)+1)
	if system != "" {
		out = append(out, map[string]any{"role": "system", "content": system})
	}
	for _, m := range msgs {
		role := m.Role
		// Split mixed assistant content: OpenAI wants text under `content`
		// and tool calls under `tool_calls`. Tool results are their own
		// message with role "tool".
		switch role {
		case "user":
			parts := []string{}
			var imageParts []map[string]any
			for _, b := range m.Content {
				if b.Type == "text" && b.Text != "" {
					parts = append(parts, b.Text)
				}
				if b.Type == "image" && b.Image != nil {
					url := b.Image.URL
					if url == "" && b.Image.Data != "" {
						url = "data:" + b.Image.MediaType + ";base64," + b.Image.Data
					}
					if url != "" {
						imageParts = append(imageParts, map[string]any{
							"type":      "image_url",
							"image_url": map[string]any{"url": url},
						})
					}
				}
				if b.Type == "tool_result" && b.ToolResult != nil {
					out = append(out, map[string]any{
						"role":         "tool",
						"tool_call_id": b.ToolResult.ToolUseID,
						"content":      b.ToolResult.Content,
					})
				}
			}
			if len(imageParts) > 0 {
				content := make([]map[string]any, 0, 1+len(imageParts))
				if len(parts) > 0 {
					content = append(content, map[string]any{"type": "text", "text": strings.Join(parts, "\n")})
				}
				content = append(content, imageParts...)
				out = append(out, map[string]any{"role": "user", "content": content})
			} else if len(parts) > 0 {
				out = append(out, map[string]any{"role": "user", "content": strings.Join(parts, "\n")})
			}
		case "assistant":
			msg := map[string]any{"role": "assistant"}
			var text []string
			var calls []map[string]any
			for _, b := range m.Content {
				if b.Type == "text" && b.Text != "" {
					text = append(text, b.Text)
				}
				if b.Type == "tool_use" && b.ToolUse != nil {
					inputJSON, _ := json.Marshal(b.ToolUse.Input)
					calls = append(calls, map[string]any{
						"id":   b.ToolUse.ID,
						"type": "function",
						"function": map[string]any{
							"name":      b.ToolUse.Name,
							"arguments": string(inputJSON),
						},
					})
				}
			}
			if len(text) > 0 {
				msg["content"] = strings.Join(text, "\n")
			}
			if len(calls) > 0 {
				msg["tool_calls"] = calls
			}
			if msg["content"] == nil && msg["tool_calls"] == nil {
				continue
			}
			out = append(out, msg)
		case "tool":
			for _, b := range m.Content {
				if b.Type == "tool_result" && b.ToolResult != nil {
					out = append(out, map[string]any{
						"role":         "tool",
						"tool_call_id": b.ToolResult.ToolUseID,
						"content":      b.ToolResult.Content,
					})
				}
			}
		}
	}
	return out
}

// parseOpenAISSE reads chat-completion deltas and reconstructs the same
// Event stream the rest of brain expects. Tool calls arrive as
// `tool_calls[i].function.arguments` partial-json strings — we forward
// each delta as it lands so the UI sees streaming input.
func parseOpenAISSE(body io.Reader, emit func(Event)) error {
	scanner := bufio.NewScanner(body)
	scanner.Buffer(make([]byte, 1<<20), 1<<24)

	textOpenAt := -1
	toolStarted := map[int]bool{}
	sawStop := false
	sawContent := false

	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		payload := strings.TrimPrefix(line, "data: ")
		if payload == "" || payload == "[DONE]" {
			continue
		}
		var chunk struct {
			// Some upstreams (OpenRouter, gateways) report failures as an
			// error object INSIDE a 200 stream instead of a non-200 status.
			Error *struct {
				Message string `json:"message"`
				Code    any    `json:"code"`
			} `json:"error"`
			Choices []struct {
				Index int `json:"index"`
				Delta struct {
					Content   string `json:"content"`
					ToolCalls []struct {
						Index    int    `json:"index"`
						ID       string `json:"id"`
						Type     string `json:"type"`
						Function struct {
							Name      string `json:"name"`
							Arguments string `json:"arguments"`
						} `json:"function"`
					} `json:"tool_calls"`
				} `json:"delta"`
				FinishReason string `json:"finish_reason"`
			} `json:"choices"`
			Usage struct {
				PromptTokens     int `json:"prompt_tokens"`
				CompletionTokens int `json:"completion_tokens"`
			} `json:"usage"`
		}
		if err := json.Unmarshal([]byte(payload), &chunk); err != nil {
			continue
		}
		if chunk.Error != nil && chunk.Error.Message != "" {
			return fmt.Errorf("upstream stream error: %s", chunk.Error.Message)
		}

		if chunk.Usage.PromptTokens > 0 || chunk.Usage.CompletionTokens > 0 {
			emit(Event{Type: "usage", Usage: Usage{
				InputTokens:  chunk.Usage.PromptTokens,
				OutputTokens: chunk.Usage.CompletionTokens,
			}})
		}

		for _, c := range chunk.Choices {
			if c.Delta.Content != "" {
				sawContent = true
				if textOpenAt == -1 {
					textOpenAt = 0
					emit(Event{Type: "text_start", Index: 0})
				}
				emit(Event{Type: "text_delta", Index: 0, TextDelta: c.Delta.Content})
			}
			for _, tc := range c.Delta.ToolCalls {
				sawContent = true
				idx := tc.Index + 1 // offset to keep text at index 0
				if !toolStarted[idx] && (tc.ID != "" || tc.Function.Name != "") {
					toolStarted[idx] = true
					emit(Event{
						Type:      "tool_use_start",
						Index:     idx,
						ToolUseID: tc.ID,
						ToolName:  tc.Function.Name,
					})
				}
				if tc.Function.Arguments != "" {
					emit(Event{Type: "tool_use_input_delta", Index: idx, InputDelta: tc.Function.Arguments})
				}
			}
			if c.FinishReason != "" {
				sawStop = true
				if textOpenAt != -1 {
					emit(Event{Type: "block_stop", Index: 0})
				}
				for idx := range toolStarted {
					emit(Event{Type: "block_stop", Index: idx})
				}
				emit(Event{Type: "stop", StopReason: mapOpenAIStopReason(c.FinishReason)})
			}
		}
	}
	if err := scanner.Err(); err != nil {
		return err
	}
	// A clean EOF with zero events is an upstream failure, not a
	// completion — treating it as success surfaced blank replies with no
	// error when a gateway hiccuped with 200 + empty body.
	if !sawStop && !sawContent {
		return fmt.Errorf("upstream returned an empty stream (no events)")
	}
	return nil
}

func mapOpenAIStopReason(r string) string {
	switch r {
	case "stop":
		return "end_turn"
	case "length":
		return "max_tokens"
	case "tool_calls":
		return "tool_use"
	case "content_filter":
		return "refusal"
	}
	return r
}
