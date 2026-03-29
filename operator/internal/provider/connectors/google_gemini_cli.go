package connectors

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
	"construct-operator/internal/provider"
	"construct-operator/internal/provider/helpers"
)

const googleGeminiCLIBaseURL = "https://cloudcode-pa.googleapis.com"

var googleGeminiCLIHeaders = map[string]string{
	"User-Agent":        "google-cloud-sdk vscode_cloudshelleditor/0.1",
	"X-Goog-Api-Client": "gl-node/22.17.0",
	"Client-Metadata":   `{"ideType":"IDE_UNSPECIFIED","platform":"PLATFORM_UNSPECIFIED","pluginType":"GEMINI"}`,
}

type GoogleGeminiCLIOAuthConfig struct {
	AccessToken  string
	RefreshToken string
	ProjectID    string
	ExpiresAt    time.Time
	Models       []string
}

type GoogleGeminiCLIOAuthProvider struct {
	mu           sync.RWMutex
	accessToken  string
	refreshToken string
	projectID    string
	tokenExpiry  time.Time
	models       []string
}

func NewGoogleGeminiCLIOAuth(cfg GoogleGeminiCLIOAuthConfig) *GoogleGeminiCLIOAuthProvider {
	if len(cfg.Models) == 0 {
		cfg.Models = []string{
			"gemini-2.5-pro",
			"gemini-2.5-flash",
			"gemini-2.0-flash",
			"gemini-3-pro-preview",
			"gemini-3-flash-preview",
			"gemini-3.1-pro-preview",
		}
	}
	if cfg.ExpiresAt.IsZero() {
		cfg.ExpiresAt = time.Now().Add(time.Hour)
	}

	return &GoogleGeminiCLIOAuthProvider{
		accessToken:  cfg.AccessToken,
		refreshToken: cfg.RefreshToken,
		projectID:    cfg.ProjectID,
		tokenExpiry:  cfg.ExpiresAt,
		models:       append([]string(nil), cfg.Models...),
	}
}

func (p *GoogleGeminiCLIOAuthProvider) ID() string       { return "google-gemini-cli" }
func (p *GoogleGeminiCLIOAuthProvider) Models() []string { return append([]string(nil), p.models...) }

func (p *GoogleGeminiCLIOAuthProvider) Complete(ctx context.Context, req *provider.Request) (*provider.Response, error) {
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
		case "tool_call_start", "tool_call_done":
			if event.ToolCall != nil {
				toolCalls = append(toolCalls, *event.ToolCall)
			}
		case "done":
			finalResp = event.Response
		case "error":
			return nil, fmt.Errorf("Google Gemini CLI stream error: %s", event.Error)
		}
	}

	if finalResp != nil {
		return finalResp, nil
	}

	stopReason := "end_turn"
	if len(toolCalls) > 0 {
		stopReason = "tool_use"
	}

	return &provider.Response{
		Content:    content,
		ToolCalls:  toolCalls,
		StopReason: stopReason,
	}, nil
}

func (p *GoogleGeminiCLIOAuthProvider) Stream(ctx context.Context, req *provider.Request) (<-chan provider.StreamEvent, error) {
	token, err := p.getToken()
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(p.projectID) == "" {
		return nil, fmt.Errorf("google gemini cli is missing projectId; re-authenticate")
	}

	body := p.buildBody(req)
	data, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}

	httpReq, err := http.NewRequestWithContext(ctx, "POST", googleGeminiCLIBaseURL+"/v1internal:streamGenerateContent?alt=sse", bytes.NewReader(data))
	if err != nil {
		return nil, err
	}

	httpReq.Header.Set("Authorization", "Bearer "+token)
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "text/event-stream")
	for key, value := range googleGeminiCLIHeaders {
		httpReq.Header.Set(key, value)
	}

	resp, err := http.DefaultClient.Do(httpReq)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		return nil, fmt.Errorf("Google Gemini CLI error %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	ch := make(chan provider.StreamEvent, 64)
	go p.readSSE(resp.Body, ch)
	return ch, nil
}

func (p *GoogleGeminiCLIOAuthProvider) getToken() (string, error) {
	p.mu.RLock()
	token := p.accessToken
	expiry := p.tokenExpiry
	p.mu.RUnlock()

	if token != "" && time.Now().Before(expiry.Add(-5*time.Minute)) {
		return token, nil
	}

	if err := p.refresh(); err != nil {
		return "", err
	}

	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.accessToken, nil
}

func (p *GoogleGeminiCLIOAuthProvider) refresh() error {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.refreshToken == "" {
		return fmt.Errorf("cannot refresh Google Gemini CLI token: missing refresh token")
	}
	if strings.TrimSpace(p.projectID) == "" {
		return fmt.Errorf("cannot refresh Google Gemini CLI token: missing project id")
	}

	creds, err := constructoauth.RefreshGoogleCloudToken(p.refreshToken, p.projectID)
	if err != nil {
		return err
	}

	p.accessToken = creds.Access
	p.tokenExpiry = time.UnixMilli(creds.Expires)
	return nil
}

func (p *GoogleGeminiCLIOAuthProvider) buildBody(req *provider.Request) map[string]any {
	contents := make([]map[string]any, 0, len(req.Messages))
	toolNames := googleToolNameIndex(req.Messages)

	for _, message := range req.Messages {
		role := strings.ToLower(message.Role)

		if role == "tool" && message.ToolResult != nil {
			toolName := toolNames[message.ToolResult.CallID]
			if toolName == "" {
				toolName = message.ToolResult.CallID
			}

			contents = append(contents, map[string]any{
				"role": "user",
				"parts": []map[string]any{
					{
						"functionResponse": map[string]any{
							"name": helpers.SanitizeToolName(toolName),
							"id":   message.ToolResult.CallID,
							"response": map[string]any{
								"output": message.ToolResult.Content,
							},
						},
					},
				},
			})
			continue
		}

		parts := make([]map[string]any, 0, len(message.ToolCalls)+1)
		if strings.TrimSpace(message.Content) != "" {
			parts = append(parts, map[string]any{"text": message.Content})
		}
		for _, call := range message.ToolCalls {
			parts = append(parts, map[string]any{
				"functionCall": map[string]any{
					"name": helpers.SanitizeToolName(call.Name),
					"id":   call.ID,
					"args": parseGoogleToolArguments(call.Input),
				},
			})
		}
		if len(parts) == 0 {
			continue
		}

		googleRole := "user"
		if role == "assistant" {
			googleRole = "model"
		}
		contents = append(contents, map[string]any{
			"role":  googleRole,
			"parts": parts,
		})
	}

	request := map[string]any{
		"contents": contents,
	}
	if req.System != "" {
		request["systemInstruction"] = map[string]any{
			"parts": []map[string]any{{"text": req.System}},
		}
	}
	generationConfig := map[string]any{}
	if req.MaxTokens > 0 {
		generationConfig["maxOutputTokens"] = req.MaxTokens
	}
	if req.Temperature != nil {
		generationConfig["temperature"] = *req.Temperature
	}
	// Structured output: use responseMimeType + responseSchema for constrained decoding.
	if req.OutputSchema != nil {
		var schemaObj any
		json.Unmarshal(req.OutputSchema.Schema, &schemaObj)
		generationConfig["responseMimeType"] = "application/json"
		generationConfig["responseSchema"] = schemaObj
	}
	if len(generationConfig) > 0 {
		request["generationConfig"] = generationConfig
	}
	if len(req.Tools) > 0 {
		functionDeclarations := make([]map[string]any, len(req.Tools))
		for i, toolDef := range req.Tools {
			functionDeclarations[i] = map[string]any{
				"name":                 helpers.SanitizeToolName(toolDef.Name),
				"description":          toolDef.Description,
				"parametersJsonSchema": helpers.SanitizeToolSchema(toolDef.InputSchema),
			}
		}
		request["tools"] = []map[string]any{
			{"functionDeclarations": functionDeclarations},
		}
		request["toolConfig"] = map[string]any{
			"functionCallingConfig": map[string]any{
				"mode": "AUTO",
			},
		}
	}

	return map[string]any{
		"project":   p.projectID,
		"model":     req.Model,
		"request":   request,
		"userAgent": "construct-operator",
		"requestId": fmt.Sprintf("construct-%d", time.Now().UnixNano()),
	}
}

func (p *GoogleGeminiCLIOAuthProvider) readSSE(body io.ReadCloser, ch chan<- provider.StreamEvent) {
	defer body.Close()
	defer close(ch)

	var textContent string
	var toolCalls []provider.ToolCall
	stopReason := "end_turn"
	usage := provider.Usage{}
	toolCallCounter := 0

	scanner := bufio.NewScanner(body)
	scanner.Buffer(make([]byte, 0, 1024*1024), 10*1024*1024)

	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "data:") {
			continue
		}

		data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if data == "" {
			continue
		}

		var chunk struct {
			Response struct {
				Candidates []struct {
					Content struct {
						Parts []struct {
							Text         string `json:"text"`
							FunctionCall *struct {
								Name string         `json:"name"`
								ID   string         `json:"id"`
								Args map[string]any `json:"args"`
							} `json:"functionCall"`
						} `json:"parts"`
					} `json:"content"`
					FinishReason string `json:"finishReason"`
				} `json:"candidates"`
				UsageMetadata struct {
					PromptTokenCount        int `json:"promptTokenCount"`
					CandidatesTokenCount    int `json:"candidatesTokenCount"`
					ThoughtsTokenCount      int `json:"thoughtsTokenCount"`
					CachedContentTokenCount int `json:"cachedContentTokenCount"`
				} `json:"usageMetadata"`
			} `json:"response"`
		}
		if err := json.Unmarshal([]byte(data), &chunk); err != nil {
			continue
		}
		if len(chunk.Response.Candidates) == 0 {
			continue
		}

		candidate := chunk.Response.Candidates[0]
		for _, part := range candidate.Content.Parts {
			if part.Text != "" {
				textContent += part.Text
				ch <- provider.StreamEvent{Type: "text_delta", Text: part.Text}
			}
			if part.FunctionCall != nil {
				callID := strings.TrimSpace(part.FunctionCall.ID)
				if callID == "" {
					toolCallCounter++
					callID = fmt.Sprintf("%s_%d", part.FunctionCall.Name, toolCallCounter)
				}
				args, _ := json.Marshal(part.FunctionCall.Args)
				call := provider.ToolCall{
					ID:    callID,
					Name:  helpers.UnsanitizeToolName(part.FunctionCall.Name),
					Input: string(args),
				}
				toolCalls = append(toolCalls, call)
				ch <- provider.StreamEvent{Type: "tool_call_start", ToolCall: &call}
			}
		}

		if candidate.FinishReason != "" {
			stopReason = mapGoogleGeminiStopReason(candidate.FinishReason, len(toolCalls) > 0)
		}

		usage = provider.Usage{
			InputTokens:  chunk.Response.UsageMetadata.PromptTokenCount - chunk.Response.UsageMetadata.CachedContentTokenCount,
			OutputTokens: chunk.Response.UsageMetadata.CandidatesTokenCount + chunk.Response.UsageMetadata.ThoughtsTokenCount,
			CacheRead:    chunk.Response.UsageMetadata.CachedContentTokenCount,
		}
	}

	ch <- provider.StreamEvent{
		Type: "done",
		Response: &provider.Response{
			Content:    textContent,
			ToolCalls:  toolCalls,
			StopReason: stopReason,
			Usage:      usage,
		},
	}
}

func parseGoogleToolArguments(raw string) any {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return map[string]any{}
	}

	var parsed any
	if err := json.Unmarshal([]byte(trimmed), &parsed); err == nil {
		return parsed
	}

	return map[string]any{"input": trimmed}
}

func googleToolNameIndex(messages []provider.Message) map[string]string {
	names := map[string]string{}
	for _, message := range messages {
		for _, call := range message.ToolCalls {
			if strings.TrimSpace(call.ID) == "" {
				continue
			}
			names[call.ID] = call.Name
		}
	}
	return names
}

func mapGoogleGeminiStopReason(reason string, hasToolCalls bool) string {
	if hasToolCalls {
		return "tool_use"
	}

	switch strings.ToUpper(strings.TrimSpace(reason)) {
	case "STOP", "":
		return "end_turn"
	case "MAX_TOKENS":
		return "max_tokens"
	default:
		return "end_turn"
	}
}
