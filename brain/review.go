// Background review — the autonomous half of the "grows with you" loop.
//
// After a substantive turn (one that used tools), handlePrompt fires
// runBackgroundReview in a goroutine. It forks a lightweight agent restricted
// to the `memory` and `skill_manage` tools, replays the just-finished
// conversation, and asks itself whether anything durable should be saved. The
// writes go straight to the memory/skill stores; the main turn's stream and
// session are never touched (a no-op handler, so the review's own messages
// aren't persisted to the user's session).
//
// Disable with CONSTRUCT_BRAIN_REVIEW=off.
package main

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"time"

	"github.com/construct-space/brain/agent"
	"github.com/construct-space/brain/provider"
	"github.com/construct-space/brain/session"
	"github.com/construct-space/brain/tool"
)

const reviewSystemPrompt = `You are a background reviewer for the Construct agent. You are NOT talking to the user — they will never see this. Review the conversation that just happened and decide whether anything durable is worth saving for future sessions.

You have two tools:
- memory — persist facts about the user (scope=user) or the active project (scope=project).
- skill_manage — save a reusable procedure as a skill (create), or refine one (patch).

Be conservative but active: most substantive sessions yield at least one small update. Save only durable, reusable knowledge. NEVER save secrets, tokens, ephemera, or easily re-discoverable facts. When done, reply with a one-line summary of what you saved, or "Nothing to save."`

const reviewUserPrompt = `Review the conversation above and update long-term memory / skills if warranted:
1. Did the user reveal durable preferences, identity, or working style? → memory (scope=user).
2. Did you learn a durable convention or fact about the active project? → memory (scope=project).
3. Did you work out a non-trivial multi-step workflow, recover from a tricky error, or get corrected by the user? → skill_manage (create a skill, or patch an existing one).

Do NOT re-save anything the conversation already saved this turn — if you see a memory or skill_manage tool call above that already captured the point, leave it; saving a reworded copy just creates duplicates.

Make the updates with the tools, then stop. If nothing is worth saving, reply "Nothing to save." and do nothing.`

// reviewEnabled gates the background review. On by default; opt out with
// CONSTRUCT_BRAIN_REVIEW=off (or 0/false).
func reviewEnabled() bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv("CONSTRUCT_BRAIN_REVIEW"))) {
	case "off", "0", "false", "no":
		return false
	}
	return true
}

// runBackgroundReview forks a memory/skill-only agent over the finished
// conversation. Fire-and-forget; safe to call in a goroutine. Caps itself
// with a timeout and recovers from panics so it can never take down a turn.
func runBackgroundReview(prov provider.Provider, tools *tool.Registry, sessions *session.Store, sessionID, model string, caps []string) {
	defer func() { _ = recover() }()

	// Restricted, VISIBLE toolset so the reviewer can call them directly
	// (no list_tools/call_tool discovery). Reuses the same store instances as
	// the main registry, so writes land in the same MEMORY.md / SkillsDir.
	rt := tool.NewRegistry()
	if t, ok := tools.Get("memory"); ok {
		rt.Register(t)
	}
	if t, ok := tools.Get("skill_manage"); ok {
		rt.Register(t)
	}
	if len(rt.Names()) == 0 {
		return // nothing to write with — skip
	}

	hist, err := sessions.Load(sessionID)
	if err != nil || len(hist) == 0 {
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()

	agent.New(prov, rt).Run(ctx, agent.Options{
		Model:         model,
		System:        reviewSystemPrompt,
		Prompt:        reviewUserPrompt,
		History:       session.AsMessages(hist),
		MaxIterations: 6,
		CapFlags:      caps,
	}, noopHandler{})
}

// noopHandler satisfies agent.Handler without streaming or persisting — the
// review runs silently and its messages are not saved to the user's session.
type noopHandler struct{}

func (noopHandler) OnTextDelta(string)                            {}
func (noopHandler) OnToolCall(string, string, json.RawMessage)    {}
func (noopHandler) OnToolResult(string, string, bool)             {}
func (noopHandler) OnStop(string)                                 {}
func (noopHandler) OnError(error)                                 {}
func (noopHandler) OnMessages(provider.Message, *provider.Message) {}
func (noopHandler) OnUsage(provider.Usage, int64)                 {}
func (noopHandler) OnRouting(provider.Routing)                    {}
