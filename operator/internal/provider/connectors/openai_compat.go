// OpenAI-compatible provider — works with DeepSeek, xAI, LM Studio, etc.
// Any provider that implements the OpenAI chat completions API.
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

// OpenAICompatConfig configures an OpenAI-compatible provider.
type OpenAICompatConfig struct {
	Name    string   // Display name (e.g. "DeepSeek")
	Key     string   // Provider key (e.g. "deepseek")
	BaseURL string   // API base URL
	APIKey  string   // API key
	Models  []string // Supported model IDs
}

type OpenAICompatProvider struct {
	config OpenAICompatConfig
}

func NewOpenAICompat(cfg OpenAICompatConfig) *OpenAICompatProvider {
	return &OpenAICompatProvider{config: cfg}
}

// NewOpenAIFromCodex loads OAuth tokens from Codex CLI (~/.codex/auth.json).
// Works with ChatGPT Plus subscriptions — the access_token is a Bearer token
// for the OpenAI API.
func NewOpenAIFromCodex() (*OpenAICompatProvider, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(filepath.Join(home, ".codex", "auth.json"))
	if err != nil {
		return nil, fmt.Errorf("codex auth not found: %w", err)
	}

	var auth struct {
		Tokens struct {
			AccessToken string `json:"access_token"`
		} `json:"tokens"`
	}
	if err := json.Unmarshal(data, &auth); err != nil {
		return nil, err
	}
	if auth.Tokens.AccessToken == "" {
		return nil, fmt.Errorf("no access token in codex auth.json")
	}

	return NewOpenAICompat(OpenAICompatConfig{
		Name:    "OpenAI",
		Key:     "openai",
		BaseURL: "https://api.openai.com/v1",
		APIKey:  auth.Tokens.AccessToken,
		Models:  []string{"gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano", "gpt-4o", "gpt-4o-mini", "o3", "o3-mini", "o4-mini"},
	}), nil
}

func (p *OpenAICompatProvider) ID() string       { return p.config.Key }
func (p *OpenAICompatProvider) Models() []string { return p.config.Models }

func (p *OpenAICompatProvider) Complete(ctx context.Context, req *provider.Request) (*provider.Response, error) {
	body := p.buildBody(req)

	data, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}

	httpReq, err := http.NewRequestWithContext(ctx, "POST", p.config.BaseURL+"/chat/completions", bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+p.config.APIKey)

	resp, err := http.DefaultClient.Do(httpReq)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	respData, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("%s API error %d: %s", p.config.Name, resp.StatusCode, string(respData))
	}

	return p.parseResponse(respData)
}

func (p *OpenAICompatProvider) Stream(ctx context.Context, req *provider.Request) (<-chan provider.StreamEvent, error) {
	body := p.buildBody(req)
	body["stream"] = true

	data, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}

	httpReq, err := http.NewRequestWithContext(ctx, "POST", p.config.BaseURL+"/chat/completions", bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+p.config.APIKey)

	resp, err := http.DefaultClient.Do(httpReq)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode != 200 {
		respData, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		return nil, fmt.Errorf("%s stream error %d: %s", p.config.Name, resp.StatusCode, string(respData))
	}

	ch := make(chan provider.StreamEvent, 64)
	go p.readSSE(resp.Body, ch)
	return ch, nil
}

func (p *OpenAICompatProvider) readSSE(body io.ReadCloser, ch chan<- provider.StreamEvent) {
	defer body.Close()
	defer close(ch)

	var textContent string
	var reasoningContent string
	toolCalls := map[int]*provider.ToolCall{} // index → tool call (OpenAI sends by index)

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

		var chunk struct {
			Choices []struct {
				Delta struct {
					Content          string `json:"content"`
					ReasoningContent string `json:"reasoning_content"`
					ToolCalls        []struct {
						Index    int    `json:"index"`
						ID       string `json:"id"`
						Function struct {
							Name      string `json:"name"`
							Arguments string `json:"arguments"`
						} `json:"function"`
					} `json:"tool_calls"`
				} `json:"delta"`
				FinishReason *string `json:"finish_reason"`
			} `json:"choices"`
		}
		if err := json.Unmarshal([]byte(data), &chunk); err != nil {
			continue
		}

		if len(chunk.Choices) == 0 {
			continue
		}

		delta := chunk.Choices[0].Delta

		// Reasoning content (DeepSeek reasoner thinking)
		if delta.ReasoningContent != "" {
			reasoningContent += delta.ReasoningContent
		}

		// Text content
		if delta.Content != "" {
			textContent += delta.Content
			ch <- provider.StreamEvent{Type: "text_delta", Text: delta.Content}
		}

		// Tool calls (streamed by index)
		for _, tc := range delta.ToolCalls {
			existing, ok := toolCalls[tc.Index]
			if !ok {
				existing = &provider.ToolCall{ID: tc.ID, Name: helpers.UnsanitizeToolName(tc.Function.Name)}
				toolCalls[tc.Index] = existing
				ch <- provider.StreamEvent{Type: "tool_call_start", ToolCall: existing}
			}
			if tc.Function.Arguments != "" {
				existing.Input += tc.Function.Arguments
			}
		}

		// Finish
		if fr := chunk.Choices[0].FinishReason; fr != nil {
			resp := &provider.Response{
				Content:          textContent,
				ReasoningContent: reasoningContent,
				StopReason:       *fr,
			}
			for i := 0; i < len(toolCalls); i++ {
				if tc, ok := toolCalls[i]; ok {
					resp.ToolCalls = append(resp.ToolCalls, *tc)
				}
			}
			ch <- provider.StreamEvent{Type: "done", Response: resp}
			return
		}
	}
}

func (p *OpenAICompatProvider) buildBody(req *provider.Request) map[string]any {
	messages := make([]map[string]any, 0, len(req.Messages))

	// System message
	if req.System != "" {
		messages = append(messages, map[string]any{
			"role":    "system",
			"content": req.System,
		})
	}

	isReasonerModel := strings.Contains(strings.ToLower(req.Model), "reasoner")

	for _, m := range req.Messages {
		msg := map[string]any{"role": m.Role}

		if m.Role == "tool" && m.ToolResult != nil {
			msg["role"] = "tool"
			msg["tool_call_id"] = m.ToolResult.CallID
			msg["content"] = m.ToolResult.Content
		} else if len(m.ToolCalls) > 0 {
			msg["content"] = m.Content
			tcs := make([]map[string]any, len(m.ToolCalls))
			for i, tc := range m.ToolCalls {
				tcs[i] = map[string]any{
					"id":   tc.ID,
					"type": "function",
					"function": map[string]any{
						"name":      helpers.SanitizeToolName(tc.Name),
						"arguments": tc.Input,
					},
				}
			}
			msg["tool_calls"] = tcs
			// DeepSeek reasoner requires reasoning_content on assistant messages
			if isReasonerModel && m.Role == "assistant" {
				msg["reasoning_content"] = m.ReasoningContent
			}
		} else {
			msg["content"] = m.Content
			// DeepSeek reasoner requires reasoning_content on assistant messages
			if isReasonerModel && m.Role == "assistant" {
				msg["reasoning_content"] = m.ReasoningContent
			}
		}

		messages = append(messages, msg)
	}

	body := map[string]any{
		"model":    req.Model,
		"messages": messages,
	}

	if req.MaxTokens > 0 {
		body["max_tokens"] = req.MaxTokens
	}
	if req.Temperature != nil {
		body["temperature"] = *req.Temperature
	}
	// Structured output: OpenAI-compatible providers support response_format
	if req.OutputSchema != nil {
		body["response_format"] = map[string]any{
			"type": "json_schema",
			"json_schema": map[string]any{
				"name":   req.OutputSchema.Name,
				"schema": json.RawMessage(req.OutputSchema.Schema),
				"strict": req.OutputSchema.Strict,
			},
		}
	}

	if len(req.Tools) > 0 {
		tools := make([]map[string]any, len(req.Tools))
		for i, t := range req.Tools {
			tools[i] = map[string]any{
				"type": "function",
				"function": map[string]any{
					"name":        helpers.SanitizeToolName(t.Name),
					"description": t.Description,
					"parameters":  helpers.SanitizeToolSchema(t.InputSchema),
				},
			}
		}
		body["tools"] = tools
		if strings.TrimSpace(req.ToolChoice) != "" {
			body["tool_choice"] = strings.TrimSpace(req.ToolChoice)
		}
	}

	return body
}

func (p *OpenAICompatProvider) parseResponse(data []byte) (*provider.Response, error) {
	var raw struct {
		Choices []struct {
			Message struct {
				Content          string `json:"content"`
				ReasoningContent string `json:"reasoning_content"`
				ToolCalls        []struct {
					ID       string `json:"id"`
					Function struct {
						Name      string `json:"name"`
						Arguments string `json:"arguments"`
					} `json:"function"`
				} `json:"tool_calls"`
			} `json:"message"`
			FinishReason string `json:"finish_reason"`
		} `json:"choices"`
		Usage struct {
			PromptTokens     int `json:"prompt_tokens"`
			CompletionTokens int `json:"completion_tokens"`
		} `json:"usage"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, err
	}

	if len(raw.Choices) == 0 {
		return nil, fmt.Errorf("no choices in response")
	}

	choice := raw.Choices[0]
	resp := &provider.Response{
		Content:          choice.Message.Content,
		ReasoningContent: choice.Message.ReasoningContent,
		StopReason:       choice.FinishReason,
		Usage: provider.Usage{
			InputTokens:  raw.Usage.PromptTokens,
			OutputTokens: raw.Usage.CompletionTokens,
		},
	}

	for _, tc := range choice.Message.ToolCalls {
		resp.ToolCalls = append(resp.ToolCalls, provider.ToolCall{
			ID:    tc.ID,
			Name:  helpers.UnsanitizeToolName(tc.Function.Name),
			Input: tc.Function.Arguments,
		})
	}

	return resp, nil
}
