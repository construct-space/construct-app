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
	"sync"
	"time"

	constructoauth "construct-operator/internal/oauth"
)

var githubCopilotHeaders = map[string]string{
	"User-Agent":             "GitHubCopilotChat/0.35.0",
	"Editor-Version":         "vscode/1.107.0",
	"Editor-Plugin-Version":  "copilot-chat/0.35.0",
	"Copilot-Integration-Id": "vscode-chat",
}

type GitHubCopilotOAuthConfig struct {
	AccessToken      string
	RefreshToken     string
	EnterpriseDomain string
	ExpiresAt        time.Time
	Models           []string
}

type GitHubCopilotOAuthProvider struct {
	mu               sync.RWMutex
	accessToken      string
	refreshToken     string
	enterpriseDomain string
	baseURL          string
	tokenExpiry      time.Time
	models           []string
}

func NewGitHubCopilotOAuth(cfg GitHubCopilotOAuthConfig) *GitHubCopilotOAuthProvider {
	if len(cfg.Models) == 0 {
		cfg.Models = []string{
			"claude-sonnet-4",
			"gpt-5.4",
			"gpt-4.1",
			"o3",
			"gemini-2.5-pro",
			"gemini-2.5-flash",
		}
	}
	if cfg.ExpiresAt.IsZero() {
		cfg.ExpiresAt = time.Now().Add(time.Hour)
	}

	return &GitHubCopilotOAuthProvider{
		accessToken:      cfg.AccessToken,
		refreshToken:     cfg.RefreshToken,
		enterpriseDomain: cfg.EnterpriseDomain,
		baseURL:          constructoauth.GetGitHubCopilotBaseURL(cfg.AccessToken, cfg.EnterpriseDomain),
		tokenExpiry:      cfg.ExpiresAt,
		models:           append([]string(nil), cfg.Models...),
	}
}

func (p *GitHubCopilotOAuthProvider) ID() string       { return "github-copilot" }
func (p *GitHubCopilotOAuthProvider) Models() []string { return append([]string(nil), p.models...) }

func (p *GitHubCopilotOAuthProvider) Complete(ctx context.Context, req *Request) (*Response, error) {
	ch, err := p.Stream(ctx, req)
	if err != nil {
		return nil, err
	}

	var content string
	var toolCalls []ToolCall
	var finalResp *Response

	for event := range ch {
		switch event.Type {
		case "text_delta":
			content += event.Text
		case "tool_call_start", "tool_call_done":
			if event.ToolCall != nil {
				toolCalls = append(toolCalls, *event.ToolCall)
			}
		case "done":
			finalResp = event.Response
		case "error":
			return nil, fmt.Errorf("GitHub Copilot stream error: %s", event.Error)
		}
	}

	if finalResp != nil {
		return finalResp, nil
	}

	return &Response{
		Content:    content,
		ToolCalls:  toolCalls,
		StopReason: "end_turn",
	}, nil
}

func (p *GitHubCopilotOAuthProvider) Stream(ctx context.Context, req *Request) (<-chan StreamEvent, error) {
	token, baseURL, err := p.getToken()
	if err != nil {
		return nil, err
	}

	body := p.buildBody(req)
	body["stream"] = true

	data, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}

	httpReq, err := http.NewRequestWithContext(ctx, "POST", baseURL+"/chat/completions", bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "text/event-stream")
	httpReq.Header.Set("Authorization", "Bearer "+token)
	for key, value := range githubCopilotHeaders {
		httpReq.Header.Set(key, value)
	}
	for key, value := range buildGitHubCopilotDynamicHeaders(req.Messages) {
		httpReq.Header.Set(key, value)
	}

	resp, err := http.DefaultClient.Do(httpReq)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode != http.StatusOK {
		respData, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		return nil, fmt.Errorf("GitHub Copilot stream error %d: %s", resp.StatusCode, string(respData))
	}

	ch := make(chan StreamEvent, 64)
	go p.readSSE(resp.Body, ch)
	return ch, nil
}

func (p *GitHubCopilotOAuthProvider) getToken() (string, string, error) {
	p.mu.RLock()
	token := p.accessToken
	baseURL := p.baseURL
	expiry := p.tokenExpiry
	p.mu.RUnlock()

	if token != "" && time.Now().Before(expiry.Add(-5*time.Minute)) {
		return token, baseURL, nil
	}

	if err := p.refresh(); err != nil {
		return "", "", err
	}

	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.accessToken, p.baseURL, nil
}

func (p *GitHubCopilotOAuthProvider) refresh() error {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.refreshToken == "" {
		return fmt.Errorf("cannot refresh GitHub Copilot token: missing refresh token")
	}

	domain := "github.com"
	if strings.TrimSpace(p.enterpriseDomain) != "" {
		domain = p.enterpriseDomain
	}

	creds, err := constructoauth.RefreshGitHubCopilotToken(p.refreshToken, domain)
	if err != nil {
		return err
	}

	p.accessToken = creds.Access
	p.tokenExpiry = time.UnixMilli(creds.Expires)
	p.baseURL = constructoauth.GetGitHubCopilotBaseURL(creds.Access, p.enterpriseDomain)
	return nil
}

func (p *GitHubCopilotOAuthProvider) readSSE(body io.ReadCloser, ch chan<- StreamEvent) {
	defer body.Close()
	defer close(ch)

	var textContent string
	var reasoningContent string
	toolCalls := map[int]*ToolCall{}

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
		if delta.ReasoningContent != "" {
			reasoningContent += delta.ReasoningContent
		}
		if delta.Content != "" {
			textContent += delta.Content
			ch <- StreamEvent{Type: "text_delta", Text: delta.Content}
		}

		for _, tc := range delta.ToolCalls {
			existing, ok := toolCalls[tc.Index]
			if !ok {
				existing = &ToolCall{ID: tc.ID, Name: UnsanitizeToolName(tc.Function.Name)}
				toolCalls[tc.Index] = existing
				ch <- StreamEvent{Type: "tool_call_start", ToolCall: existing}
			}
			if tc.Function.Arguments != "" {
				existing.Input += tc.Function.Arguments
			}
		}

		if fr := chunk.Choices[0].FinishReason; fr != nil {
			resp := &Response{
				Content:          textContent,
				ReasoningContent: reasoningContent,
				StopReason:       *fr,
			}
			for i := 0; i < len(toolCalls); i++ {
				if tc, ok := toolCalls[i]; ok {
					resp.ToolCalls = append(resp.ToolCalls, *tc)
				}
			}
			ch <- StreamEvent{Type: "done", Response: resp}
			return
		}
	}
}

func (p *GitHubCopilotOAuthProvider) buildBody(req *Request) map[string]any {
	messages := make([]map[string]any, 0, len(req.Messages)+1)

	if req.System != "" {
		messages = append(messages, map[string]any{
			"role":    "system",
			"content": req.System,
		})
	}

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
						"name":      SanitizeToolName(tc.Name),
						"arguments": tc.Input,
					},
				}
			}
			msg["tool_calls"] = tcs
		} else {
			msg["content"] = m.Content
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
	if len(req.Tools) > 0 {
		tools := make([]map[string]any, len(req.Tools))
		for i, t := range req.Tools {
			tools[i] = map[string]any{
				"type": "function",
				"function": map[string]any{
					"name":        SanitizeToolName(t.Name),
					"description": t.Description,
					"parameters":  SanitizeToolSchema(t.InputSchema),
				},
			}
		}
		body["tools"] = tools
	}

	return body
}

func buildGitHubCopilotDynamicHeaders(messages []Message) map[string]string {
	initiator := "user"
	if len(messages) > 0 {
		last := messages[len(messages)-1]
		if strings.ToLower(last.Role) != "user" {
			initiator = "agent"
		}
	}

	return map[string]string{
		"X-Initiator":   initiator,
		"Openai-Intent": "conversation-edits",
	}
}
