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

// Google implements Provider against Gemini's `streamGenerateContent` SSE
// endpoint. Auth is via API key passed in the URL — Google's OAuth path
// is more involved (Cloud project + service accounts) and not how the
// public AI Studio keys flow, so v0 is API-key only.
type Google struct {
	APIKey  string
	BaseURL string // override for testing; default https://generativelanguage.googleapis.com/v1beta
	HTTP    *http.Client
}

func NewGoogle(apiKey string) *Google {
	return &Google{
		APIKey:  apiKey,
		BaseURL: "https://generativelanguage.googleapis.com/v1beta",
		HTTP:    http.DefaultClient,
	}
}

func (g *Google) Name() string { return "google" }

func (g *Google) Stream(ctx context.Context, req Request, emit func(Event)) error {
	if g.APIKey == "" {
		return fmt.Errorf("google: GEMINI_API_KEY (or GOOGLE_API_KEY) is required")
	}
	model := stripProviderPrefix(req.Model)
	if model == "" {
		model = "gemini-2.5-flash"
	}

	body, err := g.buildBody(req)
	if err != nil {
		return err
	}

	url := fmt.Sprintf("%s/models/%s:streamGenerateContent?alt=sse&key=%s",
		strings.TrimRight(g.BaseURL, "/"), model, g.APIKey)
	httpReq, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "text/event-stream")

	resp, err := g.HTTP.Do(httpReq)
	if err != nil {
		return fmt.Errorf("google: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("google: HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(b)))
	}
	return parseGoogleSSE(resp.Body, emit)
}

func (g *Google) buildBody(req Request) ([]byte, error) {
	body := map[string]any{
		"contents": convertGoogleMessages(req.Messages),
	}
	if req.System != "" {
		body["systemInstruction"] = map[string]any{
			"parts": []map[string]any{{"text": req.System}},
		}
	}
	if len(req.Tools) > 0 {
		decls := make([]map[string]any, len(req.Tools))
		for i, t := range req.Tools {
			decls[i] = map[string]any{
				"name":        t.Name,
				"description": t.Description,
				"parameters":  sanitizeSchemaForGemini(t.InputSchema),
			}
		}
		body["tools"] = []map[string]any{{"functionDeclarations": decls}}
	}
	gen := map[string]any{}
	if req.MaxTokens > 0 {
		gen["maxOutputTokens"] = req.MaxTokens
	}
	if req.Temperature != nil {
		gen["temperature"] = *req.Temperature
	}
	if len(gen) > 0 {
		body["generationConfig"] = gen
	}
	return json.Marshal(body)
}

// Gemini rejects schemas that include `$schema`, `additionalProperties`,
// or unsupported types — strip them down to the subset it accepts.
func sanitizeSchemaForGemini(s map[string]any) map[string]any {
	if s == nil {
		return nil
	}
	out := map[string]any{}
	for k, v := range s {
		switch k {
		case "$schema", "additionalProperties", "definitions", "$defs":
			continue
		case "properties":
			if props, ok := v.(map[string]any); ok {
				cleaned := map[string]any{}
				for pk, pv := range props {
					if pm, ok := pv.(map[string]any); ok {
						cleaned[pk] = sanitizeSchemaForGemini(pm)
					} else {
						cleaned[pk] = pv
					}
				}
				out[k] = cleaned
				continue
			}
		case "items":
			if im, ok := v.(map[string]any); ok {
				out[k] = sanitizeSchemaForGemini(im)
				continue
			}
		}
		out[k] = v
	}
	return out
}

func convertGoogleMessages(msgs []Message) []map[string]any {
	out := make([]map[string]any, 0, len(msgs))
	for _, m := range msgs {
		role := m.Role
		switch role {
		case "assistant":
			role = "model"
		case "tool":
			role = "user"
		}
		parts := make([]map[string]any, 0, len(m.Content))
		for _, b := range m.Content {
			switch b.Type {
			case "text":
				if b.Text != "" {
					parts = append(parts, map[string]any{"text": b.Text})
				}
			case "image":
				// Gemini accepts inlineData (base64) or fileData (URI). We
				// only have a URL or base64 from the frontend; for http(s)
				// URLs there's no Gemini-side fetch so we drop with a TODO
				// rather than send something that 400s.
				if b.Image != nil && b.Image.Data != "" {
					parts = append(parts, map[string]any{
						"inlineData": map[string]any{
							"mimeType": b.Image.MediaType,
							"data":     b.Image.Data,
						},
					})
				}
				// TODO: support remote URLs via files.upload before emitting fileData.
			case "tool_use":
				if b.ToolUse != nil {
					parts = append(parts, map[string]any{
						"functionCall": map[string]any{
							"name": b.ToolUse.Name,
							"args": b.ToolUse.Input,
						},
					})
				}
			case "tool_result":
				if b.ToolResult != nil {
					// Gemini expects a structured response object — wrap
					// the (string) content under a `content` key so the
					// schema is uniform across tools.
					parts = append(parts, map[string]any{
						"functionResponse": map[string]any{
							"name": b.ToolResult.ToolUseID, // brain stores tool name in ID for these
							"response": map[string]any{
								"content":  b.ToolResult.Content,
								"is_error": b.ToolResult.IsError,
							},
						},
					})
				}
			}
		}
		if len(parts) == 0 {
			continue
		}
		out = append(out, map[string]any{"role": role, "parts": parts})
	}
	return out
}

// parseGoogleSSE reads Gemini's SSE stream and translates each chunk
// into provider Events. Gemini emits one JSON object per `data:` line
// containing the full incremental state — we diff per-part to emit
// text/tool deltas in the same shape the agent loop already handles.
func parseGoogleSSE(body io.Reader, emit func(Event)) error {
	scanner := bufio.NewScanner(body)
	scanner.Buffer(make([]byte, 1<<20), 1<<24)

	// Track which part-indexes we've opened so we can emit text_start /
	// tool_use_start once per block.
	opened := map[int]string{} // index -> "text"|"tool_use"
	toolBufs := map[int]string{}

	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		payload := strings.TrimPrefix(line, "data: ")
		if payload == "" {
			continue
		}
		var chunk struct {
			Candidates []struct {
				Content struct {
					Parts []struct {
						Text         string `json:"text"`
						FunctionCall *struct {
							Name string          `json:"name"`
							Args json.RawMessage `json:"args"`
						} `json:"functionCall"`
					} `json:"parts"`
				} `json:"content"`
				FinishReason string `json:"finishReason"`
			} `json:"candidates"`
			UsageMetadata struct {
				PromptTokenCount        int `json:"promptTokenCount"`
				CandidatesTokenCount    int `json:"candidatesTokenCount"`
				CachedContentTokenCount int `json:"cachedContentTokenCount"`
			} `json:"usageMetadata"`
		}
		if err := json.Unmarshal([]byte(payload), &chunk); err != nil {
			continue
		}
		if len(chunk.Candidates) == 0 {
			continue
		}
		cand := chunk.Candidates[0]
		for i, p := range cand.Content.Parts {
			switch {
			case p.FunctionCall != nil:
				if opened[i] != "tool_use" {
					// Synthesize an id — Gemini doesn't supply one. The
					// agent loop only needs uniqueness within the turn.
					emit(Event{
						Type:      "tool_use_start",
						Index:     i,
						ToolUseID: fmt.Sprintf("g_tool_%d", i),
						ToolName:  p.FunctionCall.Name,
					})
					opened[i] = "tool_use"
				}
				// Gemini delivers args as a complete object per chunk; emit
				// once when we first see it so the agent gets the full input.
				if string(p.FunctionCall.Args) != "" && toolBufs[i] == "" {
					toolBufs[i] = string(p.FunctionCall.Args)
					emit(Event{Type: "tool_use_input_delta", Index: i, InputDelta: string(p.FunctionCall.Args)})
				}
			case p.Text != "":
				if opened[i] != "text" {
					emit(Event{Type: "text_start", Index: i})
					opened[i] = "text"
				}
				emit(Event{Type: "text_delta", Index: i, TextDelta: p.Text})
			}
		}
		if u := chunk.UsageMetadata; u.PromptTokenCount > 0 || u.CandidatesTokenCount > 0 {
			emit(Event{Type: "usage", Usage: Usage{
				InputTokens:  u.PromptTokenCount,
				OutputTokens: u.CandidatesTokenCount,
				CacheRead:    u.CachedContentTokenCount,
			}})
		}
		if cand.FinishReason != "" {
			// Close any open blocks before stop.
			for idx := range opened {
				emit(Event{Type: "block_stop", Index: idx})
			}
			emit(Event{Type: "stop", StopReason: mapGoogleStopReason(cand.FinishReason)})
		}
	}
	return scanner.Err()
}

func mapGoogleStopReason(r string) string {
	switch r {
	case "STOP":
		return "end_turn"
	case "MAX_TOKENS":
		return "max_tokens"
	case "SAFETY", "RECITATION":
		return "refusal"
	}
	return strings.ToLower(r)
}

func stripProviderPrefix(model string) string {
	// Strip only a leading "provider:" segment. A prefix containing '/'
	// is a model path, not a slug — OpenRouter ids like
	// "openai/gpt-oss-20b:free" must reach the wire intact, not as
	// "free". Mirrors the guard in wire_prompt's composite peel.
	if idx := strings.Index(model, ":"); idx > 0 && !strings.Contains(model[:idx], "/") {
		return model[idx+1:]
	}
	return model
}
