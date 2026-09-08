// Package agent runs the message loop: stream the provider, accumulate
// content blocks, dispatch tool calls, append results, loop until the
// model signals end_turn (or max iterations is hit).
package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/construct-space/brain/hook"
	"github.com/construct-space/brain/provider"
	"github.com/construct-space/brain/tool"
)

// Options drives a single prompt session.
type Options struct {
	Model  string
	System string
	Prompt string
	// Content, when non-empty, replaces the text-only Prompt as the
	// blocks of the next user message. Used to deliver multimodal
	// content (text + images) on the first turn; for plain text turns
	// callers leave this nil and Prompt is wrapped in a single text block.
	Content       []provider.Block
	History       []provider.Message // prior turns; the new Prompt is appended as the next user message
	MaxTokens     int
	MaxIterations int      // safety cap on tool loops; default 25
	CapFlags      []string // resolved capabilities for the chosen model
	// Tier is a Construct-gateway hint ("large" | "medium" | "small"
	// | ""). Forwarded into provider.Request.Tier; only the Construct
	// provider's body builder reads it. Other providers ignore the
	// field. Omit / empty = medium (default).
	Tier string
}

// Handler observes streaming events.
type Handler interface {
	OnTextDelta(delta string)
	OnToolCall(id, name string, input json.RawMessage)
	OnToolResult(id, output string, isError bool)
	OnStop(reason string)
	OnError(err error)
	// OnMessages reports the complete assistant + (optional) tool-result
	// messages after each provider round, so callers can persist them.
	OnMessages(assistant provider.Message, toolResults *provider.Message)
	// OnUsage reports provider-reported token accounting at the end of
	// each provider round. Useful for telemetry; ignore in UI handlers.
	OnUsage(u provider.Usage, durationMs int64)
	// OnRouting carries Construct gateway routing metadata when the
	// upstream is provider-api (X-Construct-* response headers). Emitted
	// once per turn, before the first text_delta. UI handlers render
	// a chip; non-UI handlers can ignore.
	OnRouting(r provider.Routing)
}

// PermissionGate is consulted before each tool execution. Return {Allow:false,
// Reason} to refuse the call — the model sees the reason as the tool's error
// output and decides what to do. Optional; nil means "always allow".
type PermissionGate func(ctx context.Context, tool string, input json.RawMessage) PermissionDecision

type PermissionDecision struct {
	Allow  bool
	Reason string
}

type Agent struct {
	prov       provider.Provider
	tools      *tool.Registry
	hooks      *hook.Set
	summarizer Summarizer
	gate       PermissionGate
}

func New(prov provider.Provider, tools *tool.Registry) *Agent {
	return &Agent{prov: prov, tools: tools}
}

// WithHooks attaches a pre/post hook set; nil-safe.
func (a *Agent) WithHooks(h *hook.Set) *Agent {
	a.hooks = h
	return a
}

// WithSummarizer enables LLM-summarised compaction. When nil, falls back
// to the lossy "elide middle + sentinel" strategy.
func (a *Agent) WithSummarizer(s Summarizer) *Agent {
	a.summarizer = s
	return a
}

// WithPermissionGate installs a per-call gate that runs before tool
// execution. Used to route "ask"/"strict" permission modes through the
// frontend modal flow.
func (a *Agent) WithPermissionGate(g PermissionGate) *Agent {
	a.gate = g
	return a
}

// Run executes one prompt. Returns after the model stops with end_turn,
// max_tokens is hit, max iterations is exceeded, or ctx is cancelled.
func (a *Agent) Run(ctx context.Context, opts Options, h Handler) {
	maxIter := opts.MaxIterations
	if maxIter == 0 {
		maxIter = 25
	}

	msgs := append([]provider.Message{}, opts.History...)
	var userContent []provider.Block
	if len(opts.Content) > 0 {
		userContent = opts.Content
	} else {
		userContent = []provider.Block{{Type: "text", Text: opts.Prompt}}
	}
	msgs = append(msgs, provider.Message{
		Role:    "user",
		Content: userContent,
	})

	compactCfg := DefaultCompactConfig()

	for i := 0; i < maxIter; i++ {
		compacted, stats := CompactIfNeeded(ctx, msgs, compactCfg, a.summarizer)
		if stats.Triggered {
			msgs = compacted
		}
		// Emergency fallback: if a single tool result was huge enough
		// that even after normal compaction we're still over budget,
		// strip tool_result bodies from older turns. Better to lose
		// detail than crash the turn with a context overflow error.
		if totalChars(msgs) > compactCfg.MaxChars {
			msgs = EmergencyCompact(msgs, 4)
		}
		req := provider.Request{
			Model:     opts.Model,
			System:    opts.System,
			MaxTokens: opts.MaxTokens,
			Messages:  msgs,
			// Surface-scoped: hides tools the calling surface opted out of
			// (e.g. spacekit never sees list_spaces). Surface flows in via
			// ctx (tool.WithSurface) so legacy callers without a surface
			// get the full set.
			Tools:    a.tools.AsProviderToolsForSurface(tool.SurfaceFromCtx(ctx)),
			CapFlags: opts.CapFlags,
			Tier:     opts.Tier,
		}

		assistant, stop, err := a.streamOne(ctx, req, h)
		if err != nil {
			h.OnError(err)
			return
		}

		assistantMsg := provider.Message{Role: "assistant", Content: assistant}
		msgs = append(msgs, assistantMsg)

		if stop != "tool_use" {
			// The model can stop mid-tool-call (max_tokens, gateway
			// adapters reporting "stop" despite emitting tool_use blocks).
			// Persisting the assistant message with unpaired tool_use
			// blocks bricks the session: every later prompt replays the
			// history and the API 400s on the dangling ids. Synthesize
			// error tool_results so the persisted history stays paired.
			var interrupted []provider.Block
			for _, blk := range assistant {
				if blk.Type == "tool_use" && blk.ToolUse != nil {
					interrupted = append(interrupted, provider.Block{
						Type: "tool_result",
						ToolResult: &provider.ToolResultBlock{
							ToolUseID: blk.ToolUse.ID,
							Content:   "interrupted: stream stopped (" + stop + ") before this tool ran",
							IsError:   true,
						},
					})
				}
			}
			if len(interrupted) > 0 {
				h.OnMessages(assistantMsg, &provider.Message{Role: "user", Content: interrupted})
			} else {
				h.OnMessages(assistantMsg, nil)
			}
			h.OnStop(stop)
			return
		}

		// Execute tools and build the next user message.
		results := make([]provider.Block, 0)
		for _, blk := range assistant {
			if blk.Type != "tool_use" || blk.ToolUse == nil {
				continue
			}
			inputRaw, _ := json.Marshal(blk.ToolUse.Input)
			h.OnToolCall(blk.ToolUse.ID, blk.ToolUse.Name, inputRaw)
			var output string
			var isError bool
			if a.hooks != nil {
				if d := a.hooks.Pre(ctx, blk.ToolUse.Name, inputRaw); d.Block {
					output = "blocked by hook: " + d.Message
					isError = true
				}
			}
			if !isError && a.gate != nil {
				if d := a.gate(ctx, blk.ToolUse.Name, inputRaw); !d.Allow {
					reason := d.Reason
					if reason == "" {
						reason = "user denied"
					}
					output = "blocked by permission gate: " + reason
					isError = true
				}
			}
			var resultImages []provider.ImageBlock
			if !isError {
				output, isError = a.tools.Execute(ctx, blk.ToolUse.Name, inputRaw)
				if a.hooks != nil {
					a.hooks.Post(ctx, blk.ToolUse.Name, inputRaw)
				}
				// Tools that produce something visual (screenshot_window)
				// attach images to the result so the model can look at it.
				if !isError {
					if t, ok := a.tools.Get(blk.ToolUse.Name); ok {
						if ir, ok := t.(tool.ImagingResult); ok {
							resultImages = ir.ResultImages(output)
						}
					}
				}
			}
			// Cap individual tool results so a runaway Read/Bash/Grep
			// doesn't blow the context window. Matches operator's 10K
			// head + 5K tail strategy in runner/compact.go.
			output = truncateToolResult(output)
			// Anthropic + most providers reject user messages with empty
			// content (`messages.N: must have non-empty content`). bash
			// returning silently / read of an empty file land here a lot —
			// substitute a stable placeholder so the loop keeps moving.
			if output == "" {
				output = "(no output)"
			}
			h.OnToolResult(blk.ToolUse.ID, output, isError)
			results = append(results, provider.Block{
				Type: "tool_result",
				ToolResult: &provider.ToolResultBlock{
					ToolUseID: blk.ToolUse.ID,
					Content:   output,
					IsError:   isError,
					Images:    resultImages,
				},
			})
		}
		toolMsg := provider.Message{Role: "user", Content: results}
		msgs = append(msgs, toolMsg)
		h.OnMessages(assistantMsg, &toolMsg)
	}

	h.OnError(fmt.Errorf("max iterations (%d) exceeded", maxIter))
}

// streamOne runs a single provider call, accumulating content blocks while
// forwarding text deltas to the handler. Returns the assistant content and
// the stop reason from message_delta.
func (a *Agent) streamOne(ctx context.Context, req provider.Request, h Handler) ([]provider.Block, string, error) {
	started := time.Now()
	var usage provider.Usage
	defer func() {
		h.OnUsage(usage, time.Since(started).Milliseconds())
	}()
	type accum struct {
		kind      string // "text" | "tool_use"
		text      string
		toolID    string
		toolName  string
		toolInput string // accumulating partial_json
	}
	blocks := map[int]*accum{}
	maxIdx := -1
	stopReason := ""

	err := a.prov.Stream(ctx, req, func(ev provider.Event) {
		if ev.Index > maxIdx {
			maxIdx = ev.Index
		}
		switch ev.Type {
		case "text_start":
			blocks[ev.Index] = &accum{kind: "text"}
		case "tool_use_start":
			blocks[ev.Index] = &accum{kind: "tool_use", toolID: ev.ToolUseID, toolName: ev.ToolName}
			// Fire OnToolCall with empty input the moment the tool block
			// opens so the UI can render the "running" card before the
			// model finishes streaming the args JSON. A second OnToolCall
			// later (line ~171) will carry the assembled input; the
			// frontend's upsertTool merges them by callId.
			h.OnToolCall(ev.ToolUseID, ev.ToolName, nil)
		case "text_delta":
			if b := blocks[ev.Index]; b != nil {
				b.text += ev.TextDelta
			}
			h.OnTextDelta(ev.TextDelta)
		case "tool_use_input_delta":
			if b := blocks[ev.Index]; b != nil {
				b.toolInput += ev.InputDelta
			}
		case "block_stop":
			// nothing to do; block is complete in its accum
		case "usage":
			// merge — later events report final totals.
			if ev.Usage.InputTokens > 0 {
				usage.InputTokens = ev.Usage.InputTokens
			}
			if ev.Usage.OutputTokens > 0 {
				usage.OutputTokens = ev.Usage.OutputTokens
			}
			if ev.Usage.CacheRead > 0 {
				usage.CacheRead = ev.Usage.CacheRead
			}
			if ev.Usage.CacheWrite > 0 {
				usage.CacheWrite = ev.Usage.CacheWrite
			}
		case "stop":
			stopReason = ev.StopReason
		case "routing":
			h.OnRouting(ev.Routing)
		}
	})
	if err != nil {
		return nil, "", err
	}
	// Belt-and-braces behind the parsers' own empty-stream checks: a
	// "successful" stream with no content and no stop reason is an
	// upstream failure. Returning it as success persisted blank
	// assistant turns with stop="".
	if stopReason == "" && len(blocks) == 0 {
		return nil, "", fmt.Errorf("provider returned an empty response (no content, no stop reason)")
	}

	out := make([]provider.Block, 0, maxIdx+1)
	for i := 0; i <= maxIdx; i++ {
		b := blocks[i]
		if b == nil {
			continue
		}
		switch b.kind {
		case "text":
			if b.text != "" {
				out = append(out, provider.Block{Type: "text", Text: b.text})
			}
		case "tool_use":
			var input map[string]any
			if b.toolInput != "" {
				_ = json.Unmarshal([]byte(b.toolInput), &input)
			}
			out = append(out, provider.Block{
				Type: "tool_use",
				ToolUse: &provider.ToolUseBlock{
					ID:    b.toolID,
					Name:  b.toolName,
					Input: input,
				},
			})
		}
	}
	return out, stopReason, nil
}
