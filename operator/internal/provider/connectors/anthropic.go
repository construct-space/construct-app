// Anthropic provider — Claude models via the Anthropic API.
package connectors

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"construct-operator/internal/provider"
	"construct-operator/internal/provider/helpers"
)

type AnthropicProvider struct {
	apiKey  string
	baseURL string
}

func NewAnthropic(apiKey string) *AnthropicProvider {
	return &AnthropicProvider{
		apiKey:  apiKey,
		baseURL: "https://api.anthropic.com",
	}
}

func (p *AnthropicProvider) ID() string { return "anthropic" }

func (p *AnthropicProvider) Models() []string {
	return []string{
		"claude-opus-4-6",
		"claude-sonnet-4-6",
		"claude-haiku-4-5-20251001",
	}
}

func (p *AnthropicProvider) Capabilities() provider.Capabilities {
	return provider.Capabilities{
		SupportsStructuredOutput: true,
		SupportsTools:            true,
		SupportsStreaming:         true,
		MaxContextTokens:         200000,
	}
}

func (p *AnthropicProvider) HealthCheck(ctx context.Context) error {
	httpReq, err := http.NewRequestWithContext(ctx, "POST", p.baseURL+"/v1/messages", strings.NewReader(`{"model":"claude-haiku-4-5-20251001","max_tokens":1,"messages":[{"role":"user","content":"ping"}]}`))
	if err != nil {
		return err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("x-api-key", p.apiKey)
	httpReq.Header.Set("anthropic-version", "2025-01-01")
	resp, err := http.DefaultClient.Do(httpReq)
	if err != nil {
		return fmt.Errorf("anthropic health check failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode == 401 || resp.StatusCode == 403 {
		return fmt.Errorf("anthropic auth error: %d", resp.StatusCode)
	}
	// 200 or 400 (invalid request) both mean the API is reachable
	return nil
}

func (p *AnthropicProvider) Complete(ctx context.Context, req *provider.Request) (*provider.Response, error) {
	resp, err := p.doComplete(ctx, req)
	if err != nil {
		// Rate limit: wait and retry once
		var rlErr *provider.RateLimitError
		if errors.As(err, &rlErr) && rlErr.RetryAfter > 0 {
			fmt.Fprintf(os.Stderr, "[anthropic] rate limited, retrying after %s\n", rlErr.RetryAfter)
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-time.After(rlErr.RetryAfter):
			}
			return p.doComplete(ctx, req)
		}
	}
	return resp, err
}

func (p *AnthropicProvider) doComplete(ctx context.Context, req *provider.Request) (*provider.Response, error) {
	// Convert to Anthropic format
	body := p.buildBody(req)

	data, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}

	httpReq, err := http.NewRequestWithContext(ctx, "POST", p.baseURL+"/v1/messages", bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("x-api-key", p.apiKey)
	httpReq.Header.Set("anthropic-version", "2025-01-01")

	resp, err := http.DefaultClient.Do(httpReq)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	respData, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode == 429 {
		rlErr := helpers.CheckRateLimit("anthropic", resp, fmt.Errorf("%s", string(respData)))
		if rlErr != nil {
			return nil, rlErr
		}
	}

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("anthropic API error %d: %s", resp.StatusCode, string(respData))
	}

	return p.parseResponse(respData)
}

func (p *AnthropicProvider) Stream(ctx context.Context, req *provider.Request) (<-chan provider.StreamEvent, error) {
	resp, err := p.startStream(ctx, req)
	if err != nil {
		// Rate limit: wait and retry once
		var rlErr *provider.RateLimitError
		if errors.As(err, &rlErr) && rlErr.RetryAfter > 0 {
			fmt.Fprintf(os.Stderr, "[anthropic] stream rate limited, retrying after %s\n", rlErr.RetryAfter)
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-time.After(rlErr.RetryAfter):
			}
			resp, err = p.startStream(ctx, req)
			if err != nil {
				return nil, err
			}
		} else {
			return nil, err
		}
	}

	ch := make(chan provider.StreamEvent, 64)
	go p.readSSE(resp.Body, ch)
	return ch, nil
}

func (p *AnthropicProvider) startStream(ctx context.Context, req *provider.Request) (*http.Response, error) {
	body := p.buildBody(req)
	body["stream"] = true

	data, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}

	httpReq, err := http.NewRequestWithContext(ctx, "POST", p.baseURL+"/v1/messages", bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("x-api-key", p.apiKey)
	httpReq.Header.Set("anthropic-version", "2025-01-01")

	resp, err := http.DefaultClient.Do(httpReq)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode == 429 {
		respData, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		rlErr := helpers.CheckRateLimit("anthropic", resp, fmt.Errorf("%s", string(respData)))
		if rlErr != nil {
			return nil, rlErr
		}
	}

	if resp.StatusCode != 200 {
		respData, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		return nil, fmt.Errorf("anthropic stream error %d: %s", resp.StatusCode, string(respData))
	}

	return resp, nil
}

func (p *AnthropicProvider) buildBody(req *provider.Request) map[string]any {
	messages := make([]map[string]any, 0, len(req.Messages))
	for _, m := range req.Messages {
		msg := map[string]any{"role": m.Role}

		if m.Role == "tool" && m.ToolResult != nil {
			msg["role"] = "user"
			msg["content"] = []map[string]any{{
				"type":        "tool_result",
				"tool_use_id": m.ToolResult.CallID,
				"content":     m.ToolResult.Content,
				"is_error":    m.ToolResult.IsError,
			}}
		} else if len(m.ToolCalls) > 0 {
			content := []map[string]any{}
			if m.Content != "" {
				content = append(content, map[string]any{"type": "text", "text": m.Content})
			}
			for _, tc := range m.ToolCalls {
				var inputObj any
				json.Unmarshal([]byte(tc.Input), &inputObj)
				content = append(content, map[string]any{
					"type":  "tool_use",
					"id":    tc.ID,
					"name":  helpers.SanitizeToolName(tc.Name),
					"input": inputObj,
				})
			}
			msg["content"] = content
		} else {
			msg["content"] = m.Content
		}

		messages = append(messages, msg)
	}

	body := map[string]any{
		"model":      req.Model,
		"messages":   messages,
		"max_tokens": max(req.MaxTokens, 8192),
	}

	if req.System != "" {
		body["system"] = req.System
	}
	if len(req.Tools) > 0 {
		tools := make([]map[string]any, len(req.Tools))
		for i, t := range req.Tools {
			tools[i] = map[string]any{
				"name":         helpers.SanitizeToolName(t.Name),
				"description":  t.Description,
				"input_schema": helpers.SanitizeToolSchema(t.InputSchema),
			}
		}
		body["tools"] = tools
		if strings.EqualFold(strings.TrimSpace(req.ToolChoice), "required") {
			body["tool_choice"] = map[string]any{"type": "any"}
		}
	}
	if req.Temperature != nil {
		body["temperature"] = *req.Temperature
	}

	// Structured output: use native output_config for schema-constrained decoding.
	if req.OutputSchema != nil {
		var schemaObj any
		json.Unmarshal(req.OutputSchema.Schema, &schemaObj)
		body["output_config"] = map[string]any{
			"format": map[string]any{
				"type": "json_schema",
				"json_schema": map[string]any{
					"name":   req.OutputSchema.Name,
					"schema": schemaObj,
				},
			},
		}
	}

	return body
}

func (p *AnthropicProvider) parseResponse(data []byte) (*provider.Response, error) {
	var raw struct {
		Content []struct {
			Type  string          `json:"type"`
			Text  string          `json:"text,omitempty"`
			ID    string          `json:"id,omitempty"`
			Name  string          `json:"name,omitempty"`
			Input json.RawMessage `json:"input,omitempty"`
		} `json:"content"`
		StopReason string `json:"stop_reason"`
		Usage      struct {
			InputTokens  int `json:"input_tokens"`
			OutputTokens int `json:"output_tokens"`
		} `json:"usage"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, err
	}

	resp := &provider.Response{
		StopReason: raw.StopReason,
		Usage: provider.Usage{
			InputTokens:  raw.Usage.InputTokens,
			OutputTokens: raw.Usage.OutputTokens,
		},
	}

	for _, block := range raw.Content {
		switch block.Type {
		case "text":
			resp.Content += block.Text
		case "tool_use":
			resp.ToolCalls = append(resp.ToolCalls, provider.ToolCall{
				ID:    block.ID,
				Name:  helpers.UnsanitizeToolName(block.Name),
				Input: string(block.Input),
			})
		}
	}

	return resp, nil
}

func (p *AnthropicProvider) readSSE(body io.ReadCloser, ch chan<- provider.StreamEvent) {
	defer body.Close()
	defer close(ch)

	var currentToolCall *provider.ToolCall
	var toolCalls []provider.ToolCall
	var textContent string
	usage := provider.Usage{}

	scanner := bufio.NewScanner(body)
	scanner.Buffer(make([]byte, 0, 1024*1024), 1024*1024)

	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		data := strings.TrimPrefix(line, "data: ")
		if data == "[DONE]" {
			break
		}

		var event map[string]any
		if err := json.Unmarshal([]byte(data), &event); err != nil {
			log.Printf("[anthropic] SSE parse error: %v (data: %.200s)", err, data)
			continue
		}

		eventType, _ := event["type"].(string)

		switch eventType {
		case "message_start":
			// Anthropic sends usage in the initial message_start event
			if msg, ok := event["message"].(map[string]any); ok {
				if u, ok := msg["usage"].(map[string]any); ok {
					if v, ok := u["input_tokens"].(float64); ok {
						usage.InputTokens = int(v)
					}
				}
			}

		case "content_block_start":
			if cb, ok := event["content_block"].(map[string]any); ok {
				if bt, _ := cb["type"].(string); bt == "tool_use" {
					name, _ := cb["name"].(string)
					id, _ := cb["id"].(string)
					currentToolCall = &provider.ToolCall{ID: id, Name: helpers.UnsanitizeToolName(name)}
					ch <- provider.StreamEvent{Type: "tool_call_start", ToolCall: currentToolCall}
				}
			}

		case "content_block_delta":
			if delta, ok := event["delta"].(map[string]any); ok {
				dt, _ := delta["type"].(string)
				if dt == "text_delta" {
					text, _ := delta["text"].(string)
					textContent += text
					ch <- provider.StreamEvent{Type: "text_delta", Text: text}
				} else if dt == "input_json_delta" && currentToolCall != nil {
					partial, _ := delta["partial_json"].(string)
					currentToolCall.Input += partial
				}
			}

		case "content_block_stop":
			if currentToolCall != nil {
				toolCalls = append(toolCalls, *currentToolCall)
				currentToolCall = nil
			}

		case "message_stop":
			resp := &provider.Response{Content: textContent, Usage: usage}
			for _, tc := range toolCalls {
				resp.ToolCalls = append(resp.ToolCalls, tc)
			}
			if len(resp.ToolCalls) > 0 {
				resp.StopReason = "tool_use"
			} else {
				resp.StopReason = "end_turn"
			}
			ch <- provider.StreamEvent{Type: "done", Response: resp}
			return

		case "message_delta":
			if delta, ok := event["delta"].(map[string]any); ok {
				if u, ok := delta["usage"].(map[string]any); ok {
					if v, ok := u["output_tokens"].(float64); ok {
						usage.OutputTokens = int(v)
					}
				}
			}
		}
	}
}
