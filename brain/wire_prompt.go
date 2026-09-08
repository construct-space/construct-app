// Prompt + streaming wire ops. The frontend speaks the canonical
// "prompt" op; handlePrompt below is the single agent loop.
//
// promptDeps bundles the dependencies these handlers need so the
// registerPromptHandlers signature doesn't grow to twenty arguments.
package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"path/filepath"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/construct-space/brain/agent"
	"github.com/construct-space/brain/agents"
	"github.com/construct-space/brain/bridge"
	"github.com/construct-space/brain/catalog"
	"github.com/construct-space/brain/hook"
	"github.com/construct-space/brain/identity"
	"github.com/construct-space/brain/paths"
	"github.com/construct-space/brain/provider"
	"github.com/construct-space/brain/session"
	"github.com/construct-space/brain/sidecar"
	"github.com/construct-space/brain/skill"
	"github.com/construct-space/brain/state"
	"github.com/construct-space/brain/telemetry"
	"github.com/construct-space/brain/tool"
	"github.com/construct-space/brain/wire"
)

// bindFrontend installs a tool-request emitter that pushes calls out
// via the current prompt's SSE stream as wire.Response{Type:"tool_request"}.
// Returns the release fn the caller must defer; nil-safe when no
// frontend is connected (CLI runs, tests).
func bindFrontend(f *bridge.Frontend, streamID string, emit func(wire.Response)) func() {
	if f == nil {
		return func() {}
	}
	return f.BindEmitter(func(callID, method string, params json.RawMessage) {
		emit(wire.Response{
			ID:   streamID,
			Type: "tool_request",
			Data: map[string]any{
				"id":     callID,
				"method": method,
				"params": params,
			},
		})
	})
}

// promptDeps is the bag of state every prompt-style handler needs.
// Treat it as immutable per-process — main.go builds one and threads it
// to register*. Don't tuck mutable state in here.
type promptDeps struct {
	Tools            *tool.Registry
	Skills           []skill.Skill
	Reg              *catalog.Registry
	AnthropicOAuth   provider.TokenSource
	OpenAICodexOAuth *codexAuth
	OrgKeys          *provider.OrgKeyStore
	Sessions         *session.Store
	Hooks            *hook.Set
	Telemetry        *telemetry.Sink
	IdLoader         *identity.Loader
	AgentReg         *agents.Registry
	Paths            paths.Paths
	Frontend         *bridge.Frontend
	HTTPBridge       *bridge.Client
	TaskStore        *tool.TaskStore
	StateStore       *state.Store
	Cancels          *cancelTracker
	PermissionMemory *permissionMemory
}

// registerPromptHandlers wires prompt + the legacy stream aliases.
// runPrompt is shared across every entry point — only the payload shape
// in front of it changes.
func registerPromptHandlers(s *sidecar.Server, d *promptDeps) {
	runPrompt := func(ctx context.Context, req wire.Request, emit func(wire.Response)) {
		pctx, cancel := context.WithCancel(ctx)
		d.Cancels.register(req.ID, cancel)
		defer d.Cancels.done(req.ID)
		release := bindFrontend(d.Frontend, req.ID, emit)
		defer release()
		// Pull skills + hooks from the live profile snapshot so prompts
		// fired after a profile.switch see the new dir without restart.
		// Paths is similarly swapped — needed for cwd-derived defaults.
		liveSkills := currentSkills()
		if liveSkills == nil {
			liveSkills = d.Skills
		}
		liveHooks := currentHooks()
		if liveHooks == nil {
			liveHooks = d.Hooks
		}
		livePaths := currentPaths()
		if livePaths.DataDir == "" {
			livePaths = d.Paths
		}
		handlePrompt(pctx, req, emit, d.Tools, liveSkills, d.Reg, d.AnthropicOAuth, d.OpenAICodexOAuth, d.OrgKeys, d.Sessions, liveHooks, d.Telemetry, d.IdLoader, d.AgentReg, livePaths, d.Frontend, d.HTTPBridge, d.TaskStore, d.StateStore, d.PermissionMemory)
	}

	s.Handle("prompt", runPrompt)
}

type promptPayload struct {
	Prompt    string `json:"prompt"`
	System    string `json:"system,omitempty"`
	Model     string `json:"model,omitempty"`
	Provider  string `json:"provider,omitempty"`
	MaxTokens int    `json:"max_tokens,omitempty"`
	SessionID string `json:"session_id,omitempty"`
	AgentID   string `json:"agent_id,omitempty"`
	// Skills, when non-empty, filters the tier-1 skill disclosure to
	// only the listed skill IDs. Used by space-scoped UIs (e.g. Pages,
	// Kanban) to load just that space's skill on first prompt rather
	// than pinning every skill to every system prompt.
	Skills []string `json:"skills,omitempty"`
	// SpaceID, when set, causes brain to fetch the active space's action
	// manifest via space_list_actions and inject it into the system prompt
	// so the model knows what space_run_action can do without a discovery turn.
	SpaceID string `json:"space_id,omitempty"`
	// ProjectDir is the working directory tools (bash, read, write, edit,
	// grep, …) resolve against for this turn. When empty brain falls back
	// to its process cwd. Set from the active project / space path so tool
	// calls operate inside the user's target dir.
	ProjectDir string `json:"project_dir,omitempty"`
	// Tier is a Construct-gateway hint for Source family routing.
	// Forwarded into the upstream chat body as `tier` so provider-api's
	// dispatcher picks the matching operator (large/medium/small). For
	// non-Construct providers the field is ignored — BYOK callers
	// already mapped tier → model id on the desktop side. Values:
	// "large" | "medium" | "small" | "". Empty = medium (default).
	Tier string `json:"tier,omitempty"`
	// Content, when present, carries the first user message as a mixed
	// text + image array. Brain prefers this over Prompt at the wire
	// boundary; Prompt remains a text-only summary for session storage
	// and providers that don't accept multimodal input.
	Content []promptContent `json:"content,omitempty"`
}

// promptContent is one entry inside promptPayload.Content. `Type` is
// "text" or "image"; "text" sets Text, "image" sets URL (which may be a
// data: URL — brain decodes it before handing to the provider).
type promptContent struct {
	Type string `json:"type"`
	Text string `json:"text,omitempty"`
	URL  string `json:"url,omitempty"`
}

// parsePromptContent converts the wire content array into provider.Block
// values. Data URLs are decoded to base64 + media type; http(s) URLs are
// passed through. Unknown / malformed entries are skipped silently.
func parsePromptContent(in []promptContent) []provider.Block {
	if len(in) == 0 {
		return nil
	}
	out := make([]provider.Block, 0, len(in))
	for _, c := range in {
		switch c.Type {
		case "text":
			if c.Text == "" {
				continue
			}
			out = append(out, provider.Block{Type: "text", Text: c.Text})
		case "image":
			if c.URL == "" {
				continue
			}
			if strings.HasPrefix(c.URL, "data:") {
				// data:<media-type>;base64,<payload>
				rest := strings.TrimPrefix(c.URL, "data:")
				comma := strings.IndexByte(rest, ',')
				if comma < 0 {
					continue
				}
				meta, payload := rest[:comma], rest[comma+1:]
				mediaType := meta
				isBase64 := false
				if semi := strings.Index(meta, ";"); semi >= 0 {
					mediaType = meta[:semi]
					if strings.Contains(meta[semi:], "base64") {
						isBase64 = true
					}
				}
				if !isBase64 {
					// Non-base64 data URLs (urlencoded) aren't worth the
					// hassle for images; skip rather than guess.
					continue
				}
				// Trim any whitespace/newlines the browser slipped in.
				payload = strings.ReplaceAll(payload, "\n", "")
				// Validate it's real base64; if not, drop.
				if _, err := base64.StdEncoding.DecodeString(payload); err != nil {
					continue
				}
				out = append(out, provider.Block{
					Type: "image",
					Image: &provider.ImageBlock{
						MediaType: mediaType,
						Data:      payload,
					},
				})
			} else if strings.HasPrefix(c.URL, "http://") || strings.HasPrefix(c.URL, "https://") {
				out = append(out, provider.Block{
					Type:  "image",
					Image: &provider.ImageBlock{URL: c.URL},
				})
			}
		}
	}
	return out
}
func handlePrompt(ctx context.Context, req wire.Request, emit func(wire.Response), tools *tool.Registry, skills []skill.Skill, reg *catalog.Registry, anthropicOAuth provider.TokenSource, openaiCodexOAuth *codexAuth, orgKeys *provider.OrgKeyStore, sessions *session.Store, hooks *hook.Set, tele *telemetry.Sink, idLoader *identity.Loader, agentReg *agents.Registry, p paths.Paths, frontendBridge *bridge.Frontend, httpBridge *bridge.Client, taskStore *tool.TaskStore, stateStore *state.Store, permMem *permissionMemory) {
	var pl promptPayload
	if len(req.Payload) > 0 {
		if err := json.Unmarshal(req.Payload, &pl); err != nil {
			emit(wire.Response{ID: req.ID, Success: false, Error: "invalid payload: " + err.Error(), Done: true})
			return
		}
	}
	if pl.Prompt == "" && len(pl.Content) == 0 {
		emit(wire.Response{ID: req.ID, Success: false, Error: "payload.prompt is required", Done: true})
		return
	}
	// Provider + model resolution — resolveModelRoute (providers.go) is
	// the single source of truth for every dispatch path. A provider the
	// caller named is honored or errors with actionable guidance (no
	// silent substitution); only a provider-less request walks the
	// fallback chain.
	route, err := resolveModelRoute(pl.Provider, pl.Model, reg, anthropicOAuth, openaiCodexOAuth, orgKeys, stateStore, idLoader)
	if err != nil {
		emit(wire.Response{
			ID:      req.ID,
			Success: false,
			Error:   friendlyProviderError(err.Error()),
			Done:    true,
		})
		return
	}
	providerSlug := route.Slug
	pl.Model = route.Model
	// System prompt source-of-truth precedence:
	//   1. explicit pl.System from the caller (overrides everything)
	//   2. built-in agent prompt selected via pl.AgentID (with legacy
	//      "general"/"builder"/etc → "construct" fallback)
	//   3. defaultSystemPrompt
	// Agent's bundled skills are merged into the global skill list so the
	// model sees them in tier-1 disclosure.
	base := pl.System
	merged := skills
	// maxIterations is picked up from the resolved agent's frontmatter
	// (construct/prompt.md declares 80). Without this brain falls back
	// to agent.Options.MaxIterations==0, which the agent loop treats as
	// the default 25 — too tight for builder-style "read N files, edit,
	// verify" flows.
	var resolvedMaxTurns int
	if base == "" && agentReg != nil {
		id := pl.AgentID
		if id == "" {
			id = "construct"
		}
		a, ok := agentReg.Get(id)
		if !ok && pl.SpaceID != "" && httpBridge != nil && httpBridge.Available() {
			// Per-space agent: a space id isn't a built-in, so load the
			// installed space's own agent/config.md over the bridge and run
			// THAT as the system prompt (scoped identity, "what can you do",
			// etc.). Any failure falls through to the built-in below, so the
			// worst case is today's generic behavior — never a hard error.
			if md := fetchSpaceAgentPrompt(ctx, httpBridge, pl.SpaceID); md != "" {
				a = agents.FromMarkdown(pl.SpaceID, md)
				ok = true
			}
		}
		if !ok {
			// Legacy callers (general/builder/spacedev/etc.) — fall back to
			// the single built-in. Marketplace-space agents with non-builtin
			// ids still resolve via Get above; if a remote space sends a
			// truly unknown id, the construct prompt is a safe default.
			a, ok = agentReg.Get("construct")
		}
		if ok {
			base = a.SystemPrompt
			merged = skill.Merge(skills, a.Skills)
			resolvedMaxTurns = a.MaxTurns
		}
	}
	if base == "" {
		base = defaultSystemPrompt
	}
	// Caller-side skill filter — when the frontend passes `skills`, only
	// matching IDs are in-context for this turn. Matching is prefix-aware:
	// a filter of "board" pulls in every skill whose ID is "board" OR
	// starts with "board-" (so "board-default" + "board-data" both load
	// when the UI knows the space slug but not the per-skill suffixes).
	// When the caller pins skills like this, we inline their full bodies
	// into the system prompt instead of relying on list_skills/load_skill
	// discovery — the panel already knows which skills are relevant, no
	// reason to make the model probe.
	pinned := false
	if len(pl.Skills) > 0 {
		pinned = true
		prefixes := make([]string, 0, len(pl.Skills))
		for _, id := range pl.Skills {
			id = strings.ToLower(strings.TrimSpace(id))
			if id == "" {
				continue
			}
			prefixes = append(prefixes, id)
		}
		filtered := make([]skill.Skill, 0, len(merged))
		for _, s := range merged {
			sid := strings.ToLower(s.ID)
			for _, p := range prefixes {
				if sid == p || strings.HasPrefix(sid, p+"-") {
					filtered = append(filtered, s)
					break
				}
			}
		}
		merged = filtered
	}
	// Surface-scope filter. Skills carry an optional `scope:` frontmatter
	// (builder | spacekit | any). The current surface is derived from the
	// caller's agent_id. Empty scope = visible in every surface (legacy
	// skills keep working). Pinned skill bodies bypass the filter — the
	// caller has explicitly asked for them.
	if !pinned {
		surface := surfaceFromAgentID(pl.AgentID)
		if surface != "" {
			scoped := make([]skill.Skill, 0, len(merged))
			for _, s := range merged {
				if s.VisibleIn(surface) {
					scoped = append(scoped, s)
				}
			}
			merged = scoped
		}
	}
	if pinned {
		pl.System = skill.BuildSystemPromptWithInlined(base, merged)
	} else {
		// Trigger-based auto-loading. Build a single search haystack from
		// the user's text (pl.Prompt + any text blocks in pl.Content) and
		// inline the body of every skill whose `trigger:` / `triggers:`
		// keywords appear. Unmatched skills stay in the load_skill index.
		// This is the analogue of builder's design-skill auto-load — the
		// model shouldn't have to call load_skill when the user already
		// said "summarize my email" and a `mail-data` skill triggers on
		// "email|mail|inbox|...".
		hay := pl.Prompt
		for _, c := range pl.Content {
			if c.Type == "text" && c.Text != "" {
				hay += "\n" + c.Text
			}
		}
		matched, rest := skill.MatchTriggers(merged, hay)
		if len(matched) > 0 {
			pl.System = skill.BuildSystemPromptHybrid(base, rest, matched)
		} else {
			pl.System = skill.BuildSystemPrompt(base, merged)
		}
	}

	// Current-user injection: prepend name + email so the agent never has
	// to ask "what's your email?" for tasks like "send me a test email".
	// Placed before skills and space actions so the model sees identity
	// context first regardless of which section it reads. Shared with
	// the subagent runner via identity.CurrentUserBlock so delegated
	// runs (task tool) see the same context.
	if block := identity.CurrentUserBlock(idLoader); block != "" {
		pl.System = block + "\n" + pl.System
	}

	// Cross-session memory: inject the self-curated MEMORY.md / USER.md
	// snapshot (the "grows with you" loop). Frozen at turn start; the model
	// updates it via the `memory` tool. Placed after identity so "about the
	// user" reads as an extension of the current-user block.
	if mem := tool.LoadMemoryBlock(filepath.Join(p.BrainDir, "memory"), pl.ProjectDir); mem != "" {
		pl.System = pl.System + "\n\n" + mem
	}
	// Org-shared memory (source-api, resolved from the user's token). Cached
	// ~2min so this isn't a per-turn network call; silently empty when the
	// user isn't in an org or source is unreachable.
	if org := tool.NewOrgMemoryClient("", idLoader.Current().Token).Block(ctx); org != "" {
		pl.System = pl.System + "\n\n<org-memory>\n" + org + "</org-memory>"
	}

	// Space action injection: when the frontend tells us which space is
	// active, fetch its action manifest and PREPEND it to the system
	// prompt. Prepending matters — the section ends with a directive
	// ("If the user's request matches an action, call space_run_action
	// directly"), which the model only obeys reliably when it appears
	// before the long skill catalog. Earlier we appended and the model
	// still defaulted to a discovery loop.
	if pl.SpaceID != "" && httpBridge != nil && httpBridge.Available() {
		if section := fetchSpaceActionsSection(ctx, httpBridge, pl.SpaceID); section != "" {
			pl.System = section + "\n\n" + pl.System
		}
	}

	// Installed-spaces directory: always-on cross-space awareness. The
	// model gets a compact catalog of every installed space + its action
	// ids so "add a task to val" works from anywhere — including from
	// inside another space (the pinned skill / current-space section
	// above stays primary; this is the escape hatch to everything else).
	// Appended, not prepended: the current space's directive section must
	// keep winning when the request matches the active space.
	if httpBridge != nil && httpBridge.Available() {
		if dir := fetchSpacesDirectorySection(ctx, httpBridge, pl.SpaceID); dir != "" {
			pl.System = pl.System + "\n\n" + dir
		}
	}

	var capFlags []string
	if resolved, ok := reg.Lookup(providerSlug, pl.Model); ok {
		capFlags = resolved.Caps.Flags
	}

	prov, err := buildProvider(providerSlug, anthropicOAuth, openaiCodexOAuth, orgKeys, reg, stateStore, idLoader)
	if err != nil {
		emit(wire.Response{ID: req.ID, Success: false, Error: err.Error(), Done: true})
		return
	}
	prov = provider.BuildDebugLogger(prov, p.LogsDir)

	if pl.SessionID == "" {
		pl.SessionID = session.NewID()
	}
	// Bind the task tracker to this session so task_create/_update/_list
	// land in the right bucket for the model's current plan.
	if taskStore != nil {
		taskStore.SetSession(pl.SessionID)
	}
	history, err := sessions.Load(pl.SessionID)
	if err != nil {
		emit(wire.Response{ID: req.ID, Success: false, Error: "session load: " + err.Error(), Done: true})
		return
	}
	emit(wire.Response{ID: req.ID, Type: "session", Data: map[string]string{"session_id": pl.SessionID}})

	// Persist the new user prompt before calling the model so an early
	// abort still leaves a complete log.
	_ = sessions.Append(pl.SessionID, session.Entry{
		Role:    "user",
		Content: []provider.Block{{Type: "text", Text: pl.Prompt}},
		Time:    time.Now(),
	})

	a := agent.New(prov, tools).
		WithHooks(hooks).
		WithSummarizer(buildSummarizer(providerSlug, pl.Model, reg, anthropicOAuth, openaiCodexOAuth, orgKeys, stateStore, idLoader)).
		WithPermissionGate(buildPermissionGate(p.DataDir, frontendBridge, permMem))
	h := &streamHandler{
		id:        req.ID,
		emit:      emit,
		sessionID: pl.SessionID,
		sessions:  sessions,
		tele:      tele,
		userID:    idLoader.Current().User.ID,
		model:     pl.Model,
		provider:  providerSlug,
	}
	// Wrap ctx with the session id so per-tool state (filestate
	// read-before-write tracking, etc.) scopes to this session.
	runCtx := tool.WithSession(ctx, pl.SessionID)
	// Tag the run with the caller's surface so tools can self-filter
	// (e.g. spacedev hides list_spaces and the marketplace browser; ask
	// hides space-graph migrations). Same mapping used for skill scope.
	runCtx = tool.WithSurface(runCtx, surfaceFromAgentID(pl.AgentID))
	// And with the project_dir so bash/read/grep/glob/git/list_dir resolve
	// against the user's target space rather than wherever Tauri spawned
	// brain. Empty ProjectDir is a no-op.
	runCtx = tool.WithCwd(runCtx, pl.ProjectDir)
	// Multimodal user message: when the wire payload carries a content
	// array, decode it to provider.Block values. Falls back to the
	// text-only Prompt path when content is absent or empty.
	multiContent := parsePromptContent(pl.Content)
	a.Run(runCtx, agent.Options{
		Model:         pl.Model,
		System:        pl.System,
		Prompt:        pl.Prompt,
		Content:       multiContent,
		History:       session.AsMessages(history),
		MaxTokens:     pl.MaxTokens,
		MaxIterations: resolvedMaxTurns,
		CapFlags:      capFlags,
		Tier:          pl.Tier,
	}, h)
	if !h.ended {
		emit(wire.Response{ID: req.ID, Type: "end", Success: true, Done: true})
	}

	// Background review (the autonomous "grows with you" loop): after a turn
	// that did real work, fork a memory/skill-only agent to save anything
	// durable. Fire-and-forget — runs on its own context after this turn's
	// stream has closed, never touching it. Gated to tool-using turns to keep
	// cost down; disable with CONSTRUCT_BRAIN_REVIEW=off.
	if h.didTool && reviewEnabled() {
		go runBackgroundReview(prov, tools, sessions, pl.SessionID, pl.Model, capFlags)
	}
}

type streamHandler struct {
	id        string
	emit      func(wire.Response)
	sessionID string
	sessions  *session.Store
	tele      *telemetry.Sink
	userID    string
	model     string
	provider  string
	ended     bool
	didTool   bool // any tool ran this turn — gates background review
}

func (s *streamHandler) OnTextDelta(delta string) {
	s.emit(wire.Response{ID: s.id, Type: "text_delta", Data: map[string]string{"delta": delta}})
}

func (s *streamHandler) OnToolCall(id, name string, input json.RawMessage) {
	var inputObj any
	_ = json.Unmarshal(input, &inputObj)
	s.emit(wire.Response{
		ID:   s.id,
		Type: "tool_call",
		Data: map[string]any{"id": id, "name": name, "input": inputObj},
	})
}

func (s *streamHandler) OnToolResult(id, output string, isError bool) {
	s.didTool = true
	s.emit(wire.Response{
		ID:   s.id,
		Type: "tool_result",
		Data: map[string]any{"id": id, "output": output, "is_error": isError},
	})
}

func (s *streamHandler) OnStop(reason string) {
	s.emit(wire.Response{ID: s.id, Type: "end", Success: true, Data: map[string]string{"stop_reason": reason}, Done: true})
	s.ended = true
}

func (s *streamHandler) OnError(err error) {
	s.emit(wire.Response{ID: s.id, Success: false, Error: friendlyProviderError(err.Error()), Done: true})
	s.ended = true
}

// friendlyProviderError rewrites cryptic upstream "model not available" errors
// (e.g. the gateway's `unknown model: source`, or "gpt-5.4 not supported when
// using Codex") into actionable guidance, keeping the raw text appended for
// debugging. Credential errors are left as-is — buildProvider already emits
// actionable "set X in Settings" messages for those.
func friendlyProviderError(raw string) string {
	low := strings.ToLower(raw)
	if strings.Contains(low, "unknown model") ||
		strings.Contains(low, "model not found") ||
		strings.Contains(low, "model_not_found") ||
		strings.Contains(low, "not supported when using") {
		return "The selected model isn't available — pick a model in Settings → Providers. (" + raw + ")"
	}
	// Expired OAuth surfaced as the raw "anthropic: oauth token: oauth:
	// re-login required" — users read it as "my chat is broken" with no
	// hint which credential or where to fix it.
	if strings.Contains(low, "re-login required") {
		provider := "The provider"
		switch {
		case strings.Contains(low, "anthropic") || strings.Contains(low, "claude"):
			provider = "Claude"
		case strings.Contains(low, "codex") || strings.Contains(low, "openai"):
			provider = "ChatGPT"
		}
		return provider + " sign-in expired — reconnect it in Settings → Providers. (" + raw + ")"
	}
	return raw
}

func (s *streamHandler) OnRouting(r provider.Routing) {
	s.emit(wire.Response{
		ID:   s.id,
		Type: "routing",
		Data: map[string]any{
			"operator":          r.Operator,
			"slot":              r.Slot,
			"routing_target":    r.RoutingTarget,
			"upstream":          r.Upstream,
			"credits_used":      r.CreditsUsed,
			"credits_allowance": r.CreditsAllowance,
			"credits_balance":   r.CreditsBalance,
		},
	})
}

func (s *streamHandler) OnUsage(u provider.Usage, durationMs int64) {
	if s.tele == nil {
		return
	}
	s.tele.Record(telemetry.Event{
		Type:         "turn",
		UserID:       s.userID,
		SessionID:    s.sessionID,
		Model:        s.model,
		Provider:     s.provider,
		InputTokens:  u.InputTokens,
		OutputTokens: u.OutputTokens,
		CacheRead:    u.CacheRead,
		CacheWrite:   u.CacheWrite,
		DurationMs:   durationMs,
	})
}

func (s *streamHandler) OnMessages(assistant provider.Message, toolResults *provider.Message) {
	if s.sessions == nil || s.sessionID == "" {
		return
	}
	_ = s.sessions.Append(s.sessionID, session.Entry{
		Role: assistant.Role, Content: assistant.Content, Time: time.Now(),
	})
	if toolResults != nil {
		_ = s.sessions.Append(s.sessionID, session.Entry{
			Role: toolResults.Role, Content: toolResults.Content, Time: time.Now(),
		})
	}
}

// fetchSpaceActionsSection calls space.list_actions for the given space
// and returns a system-prompt section describing the available actions.
// Returns "" if the bridge is unavailable or the space has no actions.
//
// The section is written as an imperative instruction, not a footnote,
// because earlier "Available actions: …" framing wasn't directive enough
// — the model would still default to list_tools/list_spaces discovery
// even with the section present. Reading the section, the LLM should
// pattern-match the user's intent to one of these action names and emit
// a single space_run_action call.
//
// Includes the exact param shape (`space`, not `space_id`) since the
// model previously guessed wrong and burned a turn on retry.
// fetchSpaceAgentPrompt pulls an installed space's agent/config.md (raw
// markdown) from the host over the bridge. Empty on any error — callers fall
// back to the built-in agent.
func fetchSpaceAgentPrompt(ctx context.Context, br *bridge.Client, spaceID string) string {
	data, err := br.Call(ctx, "space.agent", map[string]string{"space_id": spaceID})
	if err != nil {
		return ""
	}
	var resp struct {
		Markdown string `json:"markdown"`
	}
	if err := json.Unmarshal(data, &resp); err != nil {
		return ""
	}
	return resp.Markdown
}

func fetchSpaceActionsSection(ctx context.Context, br *bridge.Client, spaceID string) string {
	data, err := br.Call(ctx, "space.list_actions", map[string]string{"space_id": spaceID})
	if err != nil {
		return ""
	}
	var resp struct {
		Actions []struct {
			ID          string         `json:"id"`
			Description string         `json:"description"`
			Params      map[string]any `json:"params"`
		} `json:"actions"`
	}
	if err := json.Unmarshal(data, &resp); err != nil || len(resp.Actions) == 0 {
		return ""
	}
	var sb strings.Builder
	fmt.Fprintf(&sb, "## You are inside the **%s** space\n\n", spaceID)
	sb.WriteString("If the user's request maps to any of the actions below, DO NOT call list_tools, list_spaces, or space_list_actions — those are discovery tools and the discovery is already done. ")
	sb.WriteString("Call `space_run_action` directly in one step:\n\n")
	fmt.Fprintf(&sb, "```\nspace_run_action({\n  space: \"%s\",\n  action: \"<one of the action ids below>\",\n  args: { ... }\n})\n```\n\n", spaceID)
	sb.WriteString("Note: the param is `space` (NOT `space_id`) and `args` (NOT `params`).\n\n")
	sb.WriteString("### Available actions\n\n")
	for _, a := range resp.Actions {
		sb.WriteString("- `")
		sb.WriteString(a.ID)
		sb.WriteString("`")
		if a.Description != "" {
			sb.WriteString(" — ")
			sb.WriteString(a.Description)
		}
		if len(a.Params) > 0 {
			// Compact JSON of the params schema. Keeps a single source of
			// truth (the action's declared schema) instead of re-formatting
			// here. Truncated at 800 chars per action so a wide schema can't
			// blow the prompt.
			if pj, err := json.Marshal(a.Params); err == nil {
				p := string(pj)
				if len(p) > 800 {
					p = p[:800] + "…"
				}
				sb.WriteString("\n  Schema: ")
				sb.WriteString(p)
			}
		}
		sb.WriteString("\n")
	}
	sb.WriteString("\nWhen the user's message matches an action's purpose, invoke it. Ask for clarification only if required args are genuinely ambiguous.\n")
	return sb.String()
}

// spacesDirCache caches the rendered installed-spaces directory body.
// The directory only changes on install/uninstall — the frontend pings
// spaces.reload / spaces.actions_ready, both of which invalidate — but a
// bridge roundtrip per prompt is real latency, so cache for a minute as
// a belt-and-braces TTL on top of the explicit invalidation.
//
// Three hazards this structure guards against (all hit in review):
//   - lost invalidation: a build that started before invalidate() must
//     not overwrite the cleared cache — `gen` is bumped on invalidate
//     and a build only stores its result if gen is unchanged.
//   - thundering herd: concurrent prompts on a cold/expired cache must
//     not each pay a bridge roundtrip — `building` lets followers serve
//     the stale body (or skip the section) while one build is in flight.
//   - failure stall: a failing bridge must not add a blocking roundtrip
//     to every prompt — `fetched` is stamped even on failure, so retries
//     happen at most once per TTL, and the stale body keeps serving.
var spacesDirCache struct {
	mu       sync.Mutex
	body     string
	fetched  time.Time
	gen      uint64
	building bool
}

func invalidateSpacesDirectory() {
	spacesDirCache.mu.Lock()
	spacesDirCache.gen++
	spacesDirCache.fetched = time.Time{}
	spacesDirCache.mu.Unlock()
}

// fetchSpacesDirectorySection returns the "Installed spaces" system-prompt
// section: every installed space's id, name, one-line description, and
// action ids, plus the cross-space routine. Action ids only — full schemas
// stay one space_list_actions call away, so a machine with thirty spaces
// doesn't pay thirty schema dumps per turn. currentSpace (may be empty)
// adds a per-prompt closing line and is NOT part of the cached body.
func fetchSpacesDirectorySection(ctx context.Context, br *bridge.Client, currentSpace string) string {
	spacesDirCache.mu.Lock()
	body := spacesDirCache.body
	stale := time.Since(spacesDirCache.fetched) >= time.Minute
	startGen := spacesDirCache.gen
	if stale && !spacesDirCache.building {
		spacesDirCache.building = true
		spacesDirCache.mu.Unlock()

		built := buildSpacesDirectoryBody(ctx, br)

		spacesDirCache.mu.Lock()
		spacesDirCache.building = false
		if spacesDirCache.gen == startGen {
			// Stamp the attempt even on failure — a broken bridge retries
			// once per TTL instead of once per prompt. Keep the stale body
			// when the rebuild came back empty.
			spacesDirCache.fetched = time.Now()
			if built != "" {
				spacesDirCache.body = built
			}
		}
		body = spacesDirCache.body
	}
	spacesDirCache.mu.Unlock()

	if body == "" {
		return ""
	}
	if currentSpace == "" {
		return body
	}
	return body + fmt.Sprintf("\nYou are currently inside the **%s** space — its actions take priority when they match the request. Every other space above stays reachable via space_run_action without leaving it.\n", currentSpace)
}

func buildSpacesDirectoryBody(ctx context.Context, br *bridge.Client) string {
	data, err := br.Call(ctx, "space.directory", map[string]string{})
	if err != nil {
		return ""
	}
	var resp struct {
		Spaces []struct {
			ID          string `json:"id"`
			Name        string `json:"name"`
			Description string `json:"description"`
			Actions     []struct {
				ID          string `json:"id"`
				Description string `json:"description"`
			} `json:"actions"`
		} `json:"spaces"`
	}
	if err := json.Unmarshal(data, &resp); err != nil || len(resp.Spaces) == 0 {
		return ""
	}

	var sb strings.Builder
	sb.WriteString("## Installed spaces\n\n")
	sb.WriteString("The user's installed spaces and the actions each exposes. You can act in ANY of them right now — the space does not need to be open, and you do not need to navigate to it. Routine: `space_run_action({ space: \"<id>\", action: \"<action id>\", args: { ... } })`; when you need an action's args schema first, `space_list_actions({ space: \"<id>\" })`.\n\n")
	const maxSpaces = 40
	const maxActions = 20
	for i, s := range resp.Spaces {
		if i >= maxSpaces {
			// Don't point at list_spaces here — it scans dev source dirs
			// (~/Spaces), a different catalog than this bridge-backed one.
			fmt.Fprintf(&sb, "- …and %d more installed spaces (ask the user which one they mean)\n", len(resp.Spaces)-maxSpaces)
			break
		}
		sb.WriteString("- `")
		sb.WriteString(s.ID)
		sb.WriteString("`")
		if s.Name != "" && !strings.EqualFold(s.Name, s.ID) {
			sb.WriteString(" (" + s.Name + ")")
		}
		if d := s.Description; d != "" {
			if len(d) > 120 {
				// Rune-safe cut — d[:120] alone can split a multi-byte
				// UTF-8 sequence and inject mojibake into the prompt.
				cut := 120
				for cut > 0 && !utf8.RuneStart(d[cut]) {
					cut--
				}
				d = d[:cut] + "…"
			}
			sb.WriteString(" — " + d)
		}
		if len(s.Actions) > 0 {
			sb.WriteString(". actions: ")
			for j, a := range s.Actions {
				if j >= maxActions {
					fmt.Fprintf(&sb, ", +%d more", len(s.Actions)-maxActions)
					break
				}
				if j > 0 {
					sb.WriteString(", ")
				}
				sb.WriteString(a.ID)
			}
		}
		sb.WriteString("\n")
	}
	sb.WriteString("\nMulti-space requests are normal: look data up in one space to fill another space's args. \"Add a task for Val\" = resolve the person via the org space (`org.list_members`), then create the task in the tasks/board space with the matched member as assignee. Resolve fuzzy names (people, projects, boards) against this directory and the relevant lookup action BEFORE asking the user; ask only when a match is genuinely ambiguous. Never invent a space id — `space_run_action` and `navigate_space` only accept ids from this directory. If no installed space fits the request, say so rather than improvising.\n")
	return sb.String()
}

// detectMime guesses a MIME type for a content_blocks file. Uses the
// extension first (cheap, deterministic) and falls back to a content
// sniff for files with no extension. Returns "application/octet-stream"
// when nothing matches.
func detectMime(path string, data []byte) string {
	ext := strings.ToLower(filepath.Ext(path))
	switch ext {
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".gif":
		return "image/gif"
	case ".webp":
		return "image/webp"
	case ".svg":
		return "image/svg+xml"
	}
	if len(data) > 0 {
		if t := http.DetectContentType(data); t != "" && t != "application/octet-stream" {
			return t
		}
	}
	return "application/octet-stream"
}

// surfaceFromAgentID maps the caller's agent_id to a skill-visibility
// surface. The surface is used to filter tier-1 skill discovery so
// builder-shaped agents don't see space-authoring skills and vice
// versa. Unknown agent ids default to "builder" — that's the largest
// surface and matches today's general-purpose loop. Returning empty
// disables filtering (legacy callers).
func surfaceFromAgentID(agentID string) string {
	switch strings.ToLower(strings.TrimSpace(agentID)) {
	case "", "construct", "builder", "general", "architect", "coder", "vibe":
		return "builder"
	case "ask":
		return "ask"
	case "spacekit", "space-developer", "spacedev", "space":
		return "spacekit"
	default:
		return "builder"
	}
}
