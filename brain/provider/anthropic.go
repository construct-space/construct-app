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

	"github.com/construct-space/brain/skill"
)

const anthropicEndpoint = "https://api.anthropic.com/v1/messages"
const anthropicVersion = "2023-06-01"

// claudeCodeSystemPrompt is the magic string Anthropic checks for on
// OAuth (Claude Pro/Max) traffic. Without it the API returns 429
// rate_limit_error even on the first request — the server treats the
// call as non-Claude-Code traffic and rejects. Matches operator and the
// real Claude Code CLI verbatim.
const claudeCodeSystemPrompt = "You are Claude Code, Anthropic's official CLI for Claude."

// TokenSource yields short-lived access tokens (e.g. from an OAuth refresh
// flow). When set on Anthropic, brain prefers OAuth Bearer over API key.
type TokenSource interface {
	Token(ctx context.Context) (string, error)
}

// Anthropic implements Provider against the Messages API with streaming.
// No SDK dependency — the wire format is small.
//
// Auth precedence: OAuth (Bearer + anthropic-beta) when Tokens is set,
// otherwise x-api-key from APIKey.
type Anthropic struct {
	APIKey string
	Tokens TokenSource
	HTTP   *http.Client
}

func NewAnthropic(apiKey string) *Anthropic {
	return &Anthropic{APIKey: apiKey, HTTP: http.DefaultClient}
}

// WithOAuth returns a copy configured to use the given token source.
func (a *Anthropic) WithOAuth(src TokenSource) *Anthropic {
	cp := *a
	cp.Tokens = src
	return &cp
}

func (a *Anthropic) Name() string { return "anthropic" }

func (a *Anthropic) Stream(ctx context.Context, req Request, emit func(Event)) error {
	useOAuth := a.Tokens != nil
	if !useOAuth && a.APIKey == "" {
		return fmt.Errorf("anthropic: no credentials (set ANTHROPIC_API_KEY or link a Claude subscription)")
	}

	body, err := a.buildBody(req, useOAuth)
	if err != nil {
		return err
	}

	// OAuth requires the ?beta=true query param. Matches the Claude Code CLI
	// + operator's claude_oauth connector — without it, the server returns
	// 429 even with the right headers + system prompt.
	endpoint := anthropicEndpoint
	if useOAuth {
		endpoint += "?beta=true"
	}

	httpReq, err := http.NewRequestWithContext(ctx, "POST", endpoint, bytes.NewReader(body))
	if err != nil {
		return err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("anthropic-version", anthropicVersion)
	httpReq.Header.Set("Accept", "text/event-stream")

	if useOAuth {
		access, err := a.Tokens.Token(ctx)
		if err != nil {
			return fmt.Errorf("anthropic: oauth token: %w", err)
		}
		httpReq.Header.Set("Authorization", "Bearer "+access)
		httpReq.Header.Set("anthropic-beta", "oauth-2025-04-20")
		httpReq.Header.Set("User-Agent", "construct/1.0")
	} else {
		httpReq.Header.Set("x-api-key", a.APIKey)
	}

	resp, err := a.HTTP.Do(httpReq)
	if err != nil {
		return fmt.Errorf("anthropic: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("anthropic: HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(b)))
	}
	return parseSSE(resp.Body, emit)
}

func (a *Anthropic) buildBody(req Request, useOAuth bool) ([]byte, error) {
	maxTokens := req.MaxTokens
	if maxTokens == 0 {
		// OAuth subscriptions allow larger default; API key keeps 4096.
		if useOAuth {
			maxTokens = 8192
		} else {
			maxTokens = 4096
		}
	}
	// Some legacy callers pass models as "anthropic:claude-haiku-4-5"; the
	// Anthropic API only accepts the bare slug, so strip any provider prefix.
	model := req.Model
	if idx := strings.Index(model, ":"); idx >= 0 {
		model = model[idx+1:]
	}
	body := map[string]any{
		"model":      model,
		"max_tokens": maxTokens,
		"messages":   convertMessages(req.Messages),
		"stream":     true,
	}
	if req.Temperature != nil {
		body["temperature"] = *req.Temperature
	}

	// OAuth requires a metadata.user_id and a system prompt that begins
	// with the Claude Code identifier. Without these two together, the
	// server returns 429 rate_limit_error on the first call.
	if useOAuth {
		body["metadata"] = map[string]any{"user_id": "construct"}
	}

	caching := req.HasCap("caching")
	body["system"] = buildSystemBlocks(req.System, useOAuth, caching)

	if len(req.Tools) > 0 {
		if caching {
			// Mark the last tool with cache_control so tools + system share the cached prefix.
			tools := make([]map[string]any, len(req.Tools))
			for i, t := range req.Tools {
				entry := map[string]any{
					"name":         t.Name,
					"description":  t.Description,
					"input_schema": t.InputSchema,
				}
				if i == len(req.Tools)-1 {
					entry["cache_control"] = map[string]string{"type": "ephemeral"}
				}
				tools[i] = entry
			}
			body["tools"] = tools
		} else {
			body["tools"] = req.Tools
		}
	}
	return json.Marshal(body)
}

// buildSystemBlocks assembles the system field for the messages request.
// When caching is enabled, the user's system prompt is split at the
// first dynamic marker (## Project Context / ## Memory / etc.) so only
// the stable prefix gets cache_control — Anthropic re-bills the dynamic
// suffix every turn but reuses the cached prefix, which is the whole
// point of prompt caching.
//
// OAuth callers MUST lead with the Claude Code identifier; the identifier
// itself counts as static and gets cached alongside the stable prefix.
func buildSystemBlocks(userSystem string, useOAuth, caching bool) any {
	if !useOAuth {
		if userSystem == "" {
			return nil
		}
		if !caching {
			return userSystem
		}
		parts := skill.SplitSystemPrompt(userSystem)
		if parts.Dynamic == "" {
			return []map[string]any{
				{"type": "text", "text": parts.Static, "cache_control": map[string]string{"type": "ephemeral"}},
			}
		}
		return []map[string]any{
			{"type": "text", "text": parts.Static, "cache_control": map[string]string{"type": "ephemeral"}},
			{"type": "text", "text": parts.Dynamic},
		}
	}

	// OAuth path. The Claude Code identifier is always block #1 and
	// always static. User prompt gets split as above; cached prefix
	// covers identifier + stable user prefix in a single block-pair.
	if userSystem == "" {
		block := map[string]any{"type": "text", "text": claudeCodeSystemPrompt}
		if caching {
			block["cache_control"] = map[string]string{"type": "ephemeral"}
		}
		return []map[string]any{block}
	}
	if !caching {
		return []map[string]any{
			{"type": "text", "text": claudeCodeSystemPrompt},
			{"type": "text", "text": userSystem},
		}
	}
	parts := skill.SplitSystemPrompt(userSystem)
	if parts.Dynamic == "" {
		// Both blocks static — cache the trailing one (Anthropic caches up
		// to the marked block, so caching the last covers both).
		return []map[string]any{
			{"type": "text", "text": claudeCodeSystemPrompt},
			{"type": "text", "text": parts.Static, "cache_control": map[string]string{"type": "ephemeral"}},
		}
	}
	return []map[string]any{
		{"type": "text", "text": claudeCodeSystemPrompt},
		{"type": "text", "text": parts.Static, "cache_control": map[string]string{"type": "ephemeral"}},
		{"type": "text", "text": parts.Dynamic},
	}
}

func convertMessages(msgs []Message) []map[string]any {
	out := make([]map[string]any, 0, len(msgs))
	for _, m := range msgs {
		role := m.Role
		if role == "tool" {
			role = "user"
		}
		blocks := make([]map[string]any, 0, len(m.Content))
		for _, b := range m.Content {
			switch b.Type {
			case "text":
				// Empty text blocks make Anthropic 400 with
				// "messages.N: must have non-empty content". Skip them —
				// the message-level guard below substitutes a placeholder
				// if every block was empty.
				if b.Text == "" {
					continue
				}
				blocks = append(blocks, map[string]any{"type": "text", "text": b.Text})
			case "image":
				if b.Image == nil {
					continue
				}
				if b.Image.URL != "" {
					blocks = append(blocks, map[string]any{
						"type":   "image",
						"source": map[string]any{"type": "url", "url": b.Image.URL},
					})
				} else if b.Image.Data != "" {
					blocks = append(blocks, map[string]any{
						"type": "image",
						"source": map[string]any{
							"type":       "base64",
							"media_type": b.Image.MediaType,
							"data":       b.Image.Data,
						},
					})
				}
			case "tool_use":
				if b.ToolUse != nil {
					// Anthropic requires tool_use.input to be a JSON object,
					// not null. When a no-arg tool (list_tools, etc.) is
					// invoked the model emits zero partial_json and
					// b.ToolUse.Input stays nil — substitute {} so the
					// request validates.
					input := b.ToolUse.Input
					if input == nil {
						input = map[string]any{}
					}
					blocks = append(blocks, map[string]any{
						"type":  "tool_use",
						"id":    b.ToolUse.ID,
						"name":  b.ToolUse.Name,
						"input": input,
					})
				}
			case "tool_result":
				if b.ToolResult != nil {
					// Anthropic rejects tool_result blocks with empty
					// content. Replayed history from before the agent-level
					// placeholder landed will have these; substitute here
					// as a safety net.
					content := b.ToolResult.Content
					if content == "" {
						content = "(no output)"
					}
					tr := map[string]any{
						"type":        "tool_result",
						"tool_use_id": b.ToolResult.ToolUseID,
						"is_error":    b.ToolResult.IsError,
					}
					// When the tool attached images, send content as an array
					// of blocks (text + image) so the model can see them.
					// Otherwise keep the plain string form.
					if len(b.ToolResult.Images) > 0 {
						parts := []map[string]any{{"type": "text", "text": content}}
						for _, img := range b.ToolResult.Images {
							if img.URL != "" {
								parts = append(parts, map[string]any{
									"type":   "image",
									"source": map[string]any{"type": "url", "url": img.URL},
								})
							} else if img.Data != "" {
								parts = append(parts, map[string]any{
									"type": "image",
									"source": map[string]any{
										"type":       "base64",
										"media_type": img.MediaType,
										"data":       img.Data,
									},
								})
							}
						}
						tr["content"] = parts
					} else {
						tr["content"] = content
					}
					blocks = append(blocks, tr)
				}
			}
		}
		// Final guard: every message must have at least one content block.
		// If every original block was empty/nil, drop in a stable
		// placeholder so the conversation keeps moving.
		if len(blocks) == 0 {
			blocks = append(blocks, map[string]any{"type": "text", "text": "(no content)"})
		}
		out = append(out, map[string]any{"role": role, "content": blocks})
	}
	return out
}

// parseSSE reads Anthropic's SSE stream and emits provider Events.
func parseSSE(body io.Reader, emit func(Event)) error {
	scanner := bufio.NewScanner(body)
	scanner.Buffer(make([]byte, 1<<20), 1<<24)
	sawEvent := false
	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		payload := strings.TrimPrefix(line, "data: ")
		if payload == "" || payload == "[DONE]" {
			continue
		}
		var raw struct {
			Type  string `json:"type"`
			Index int    `json:"index"`
			Delta struct {
				Type        string `json:"type"`
				Text        string `json:"text"`
				PartialJSON string `json:"partial_json"`
				StopReason  string `json:"stop_reason"`
			} `json:"delta"`
			ContentBlock struct {
				Type string `json:"type"`
				ID   string `json:"id"`
				Name string `json:"name"`
			} `json:"content_block"`
			Message struct {
				Usage struct {
					InputTokens              int `json:"input_tokens"`
					OutputTokens             int `json:"output_tokens"`
					CacheCreationInputTokens int `json:"cache_creation_input_tokens"`
					CacheReadInputTokens     int `json:"cache_read_input_tokens"`
				} `json:"usage"`
			} `json:"message"`
			Error struct {
				Type    string `json:"type"`
				Message string `json:"message"`
			} `json:"error"`
			Usage struct {
				InputTokens              int `json:"input_tokens"`
				OutputTokens             int `json:"output_tokens"`
				CacheCreationInputTokens int `json:"cache_creation_input_tokens"`
				CacheReadInputTokens     int `json:"cache_read_input_tokens"`
			} `json:"usage"`
		}
		if err := json.Unmarshal([]byte(payload), &raw); err != nil {
			continue
		}
		sawEvent = true
		switch raw.Type {
		case "error":
			// Mid-stream errors (overloaded_error, api_error) arrive as
			// events inside a 200 stream. Swallowing them surfaced as a
			// blank/truncated reply with no explanation.
			if raw.Error.Message != "" {
				return fmt.Errorf("anthropic stream error (%s): %s", raw.Error.Type, raw.Error.Message)
			}
			return fmt.Errorf("anthropic stream error")
		case "message_start":
			u := raw.Message.Usage
			emit(Event{Type: "usage", Usage: Usage{
				InputTokens: u.InputTokens, OutputTokens: u.OutputTokens,
				CacheRead: u.CacheReadInputTokens, CacheWrite: u.CacheCreationInputTokens,
			}})
		case "content_block_start":
			switch raw.ContentBlock.Type {
			case "text":
				emit(Event{Type: "text_start", Index: raw.Index})
			case "tool_use":
				emit(Event{
					Type:      "tool_use_start",
					Index:     raw.Index,
					ToolUseID: raw.ContentBlock.ID,
					ToolName:  raw.ContentBlock.Name,
				})
			}
		case "content_block_delta":
			switch raw.Delta.Type {
			case "text_delta":
				emit(Event{Type: "text_delta", Index: raw.Index, TextDelta: raw.Delta.Text})
			case "input_json_delta":
				emit(Event{Type: "tool_use_input_delta", Index: raw.Index, InputDelta: raw.Delta.PartialJSON})
			}
		case "content_block_stop":
			emit(Event{Type: "block_stop", Index: raw.Index})
		case "message_delta":
			if raw.Usage.OutputTokens > 0 || raw.Usage.InputTokens > 0 {
				emit(Event{Type: "usage", Usage: Usage{
					InputTokens: raw.Usage.InputTokens, OutputTokens: raw.Usage.OutputTokens,
					CacheRead: raw.Usage.CacheReadInputTokens, CacheWrite: raw.Usage.CacheCreationInputTokens,
				}})
			}
			if raw.Delta.StopReason != "" {
				emit(Event{Type: "stop", StopReason: raw.Delta.StopReason})
			}
		}
	}
	if err := scanner.Err(); err != nil {
		return err
	}
	// Clean EOF with zero recognised events = upstream failure, not a
	// completion. Without this, a 200 + empty body rendered as a blank
	// reply with no error.
	if !sawEvent {
		return fmt.Errorf("anthropic: upstream returned an empty stream (no events)")
	}
	return nil
}
