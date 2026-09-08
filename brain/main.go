// brain is Construct's agent sidecar. Tauri spawns it with --port N and
// CONSTRUCT_DATA_DIR set; brain serves a JSON-line protocol on loopback.
//
// main.go is the boot sequence — flag parsing, lifecycle, wiring. Every
// handler definition lives in a wire_*.go file by domain; every helper
// that takes more than a few lines lives in its own file (tools.go,
// subagent_tool.go, providers.go, permissions.go, cancels.go, etc.).
// If main.go grows past ~250 lines again, something needs to leave.
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/construct-space/brain/agents"
	"github.com/construct-space/brain/bridge"
	"github.com/construct-space/brain/catalog"
	"github.com/construct-space/brain/hook"
	"github.com/construct-space/brain/identity"
	"github.com/construct-space/brain/oauth"
	"github.com/construct-space/brain/paths"
	"github.com/construct-space/brain/provider"
	"github.com/construct-space/brain/session"
	"github.com/construct-space/brain/sidecar"
	"github.com/construct-space/brain/skill"
	"github.com/construct-space/brain/state"
	"github.com/construct-space/brain/telemetry"
	"github.com/construct-space/brain/tool"
)

// skillDirs collects --skills-dir flag values (repeatable).
type skillDirs []string

func (s *skillDirs) String() string     { return strings.Join(*s, ",") }
func (s *skillDirs) Set(v string) error { *s = append(*s, v); return nil }

// activeSkillDirs is set once at boot from --skills-dir flags so
// profile.switch can re-resolve with the same explicit overrides
// against a new data dir.
var activeSkillDirs []string

func main() {
	port := flag.Int("port", 0, "TCP port to listen on (loopback)")
	httpPort := flag.Int("http-port", 0, "HTTP+SSE port for browser/Tauri webview clients. 0 = disabled.")
	var sdirs skillDirs
	flag.Var(&sdirs, "skills-dir", "Directory to scan for skill markdown files. Repeatable.")
	flag.Parse()
	if *port == 0 {
		fmt.Fprintln(os.Stderr, "usage: brain --port <N> [--http-port <N>] [--skills-dir DIR]...")
		os.Exit(1)
	}

	p, err := paths.Resolve()
	if err != nil {
		fmt.Fprintln(os.Stderr, "paths:", err)
		os.Exit(1)
	}
	fmt.Fprintf(os.Stderr, "[brain] data dir: %s\n", p.DataDir)
	fmt.Fprintf(os.Stderr, "[brain] brain dir: %s\n", p.BrainDir)

	// Catalog of providers/models cached from the gateway. ETag-aware;
	// works offline once seeded. Refresher runs every 5 min (defer'd below).
	reg := catalog.New(p.StateDir, "")
	if err := reg.LoadCache(); err != nil {
		fmt.Fprintf(os.Stderr, "[catalog] cache load: %v\n", err)
	}
	if snap := reg.Snapshot(); snap != nil {
		fmt.Fprintf(os.Stderr, "[catalog] loaded cached catalog (version=%s)\n", snap.Version)
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		if err := reg.Refresh(ctx); err != nil {
			fmt.Fprintf(os.Stderr, "[catalog] initial refresh: %v\n", err)
		} else if snap := reg.Snapshot(); snap != nil {
			fmt.Fprintf(os.Stderr, "[catalog] refreshed catalog (version=%s)\n", snap.Version)
		}
	}()

	idLoader := identity.New(p.AuthFile, p.ProvidersAuth)
	id := idLoader.Load()
	if id.Authenticated {
		fmt.Fprintf(os.Stderr, "[brain] logged in as %s (%s)\n", id.User.Email, id.User.ID)
		if len(id.Subscriptions) > 0 {
			subs := make([]string, 0, len(id.Subscriptions))
			for k := range id.Subscriptions {
				subs = append(subs, k)
			}
			fmt.Fprintf(os.Stderr, "[brain] linked subscriptions: %v\n", subs)
		}
	} else {
		fmt.Fprintln(os.Stderr, "[brain] no logged-in user (auth.json missing or not authenticated)")
	}

	// OAuth storage owns providers/auth.json so refresh-rotation callbacks
	// can persist new refresh tokens back to disk.
	oauthStore := oauth.NewStorage(p.ProvidersAuth)
	// Use Live wrappers so a sign-in mid-session (or a profile switch)
	// surfaces fresh credentials without restarting brain. Each Live source
	// keys on the on-disk refresh token; when it changes the next refresh
	// rebuilds the inner concrete source automatically.
	anthropicOAuth := buildLiveAnthropicOAuth(idLoader, oauthStore)
	openaiCodexOAuth := buildLiveOpenAICodexOAuth(idLoader, oauthStore)

	// Org-supplied provider API keys (DeepSeek, Kimi, etc. when the user's
	// org has an "ORG KEY" configured). Falls back to env vars when nothing
	// is provisioned upstream. Refresher kicks in after 5 min.
	orgKeys := provider.NewOrgKeyStore("", idLoader.Current().Token)
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := orgKeys.Refresh(ctx); err != nil {
			fmt.Fprintf(os.Stderr, "[org-keys] initial fetch: %v\n", err)
		} else {
			fmt.Fprintln(os.Stderr, "[org-keys] initial fetch ok")
		}
	}()

	br := bridge.FromEnv()
	frontendBridge := bridge.NewFrontend()
	br.Frontend = frontendBridge
	if br.Addr != "" {
		fmt.Fprintf(os.Stderr, "[brain] bridge HTTP fallback: %s\n", br.Addr)
	} else {
		fmt.Fprintln(os.Stderr, "[brain] bridge HTTP fallback: disabled (CONSTRUCT_BRIDGE_PORT unset)")
	}
	fmt.Fprintln(os.Stderr, "[brain] bridge frontend: SSE back-channel enabled (binds per prompt)")

	agentReg, agentErr := agents.LoadBuiltin()
	if agentErr != nil {
		fmt.Fprintf(os.Stderr, "[agents] load: %v\n", agentErr)
	} else if agentReg != nil {
		fmt.Fprintf(os.Stderr, "[agents] loaded %d built-in agent(s)\n", len(agentReg.List()))
	}

	stateStore, stateErr := state.Open(filepath.Join(p.BrainDir, "state"))
	if stateErr != nil {
		fmt.Fprintf(os.Stderr, "[state] open: %v\n", stateErr)
	}

	// Tool registry — visible core + hidden catalog, LSP, task tracker.
	// Subagent registration is split out because its runner closure
	// needs the skills + hooks loaded immediately below.
	kit := buildToolRegistry(toolDeps{
		HTTPBridge:     br,
		FrontendBridge: frontendBridge,
		StateStore:     stateStore,
		AuthToken:      idLoader.Current().Token,
		MemoryDir:      filepath.Join(p.BrainDir, "memory"),
		SkillsDir:      p.SkillsDir,
	})

	activeSkillDirs = []string(sdirs)
	snap := reloadSkillsAndHooks(p, activeSkillDirs)
	storeProfile(snap)
	skills := snap.Skills
	hooks := snap.Hooks
	populateSkillRegistry(kit.SkillReg, skills, agentReg)

	permMem := newPermissionMemory(p.DataDir)

	agentDeps := &subagentDeps{
		Tools:            kit.Tools,
		Skills:           skills,
		Hooks:            hooks,
		AgentReg:         agentReg,
		Reg:              reg,
		AnthropicOAuth:   anthropicOAuth,
		OpenAICodexOAuth: openaiCodexOAuth,
		OrgKeys:          orgKeys,
		StateStore:       stateStore,
		Paths:            p,
		Frontend:         frontendBridge,
		PermissionMemory: permMem,
		IdLoader:         idLoader,
	}
	registerSubagentTool(agentDeps)

	// Scheduled cross-space automations — natural-language rules fired by a
	// background ticker. Reuses the same provider/tool deps as subagents.
	autoRuntime := &automationRuntime{
		store: &AutomationStore{DirFn: func() string { return currentPaths().BrainDir }},
		deps:  agentDeps,
	}
	autoRuntime.start()

	tele := telemetry.NewSink(filepath.Join(p.BrainDir, "telemetry"))
	cancels := newCancelTracker()
	sessions := session.NewStore(p.SessionsDir)
	logins := newLoginRegistry()

	srv := sidecar.New(fmt.Sprintf("127.0.0.1:%d", *port))
	registerBuiltins(srv, p, kit.Tools, skills, reg, idLoader, anthropicOAuth, openaiCodexOAuth, orgKeys, cancels, sessions, hooks, tele, logins, oauthStore, agentReg, frontendBridge, stateStore, kit.TaskStore, br, permMem)
	// Skills/hooks management ops for the Settings UI (replaces the retired
	// operator context-service path). kit.SkillReg keeps load_skill in sync.
	registerSkillsHandlers(srv, kit.SkillReg)
	// Memory read/edit ops for the Settings UI (user + project local; org via source-api).
	registerMemoryHandlers(srv, kit.MemoryStore, idLoader)
	// Automation rules CRUD + run-now for the Settings UI.
	registerAutomationHandlers(srv, autoRuntime)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	stopRefresh := reg.StartRefresher(ctx, 5*time.Minute)
	defer stopRefresh()
	stopOrgKeys := orgKeys.StartRefresher(ctx, 5*time.Minute)
	defer stopOrgKeys()

	sigs := make(chan os.Signal, 1)
	signal.Notify(sigs, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-sigs
		fmt.Fprintln(os.Stderr, "[brain] shutting down")
		cancel()
	}()

	fmt.Fprintf(os.Stderr, "[brain] TCP listening on 127.0.0.1:%d\n", *port)

	if *httpPort != 0 {
		// The desktop shell hands brain the same shared secret it gives the
		// bridge (CONSTRUCT_BRIDGE_TOKEN). Requiring it on the HTTP transport
		// stops any web page the user has open from driving the agent over
		// loopback. Empty (manual/dev run) = enforcement off.
		httpToken := os.Getenv("CONSTRUCT_BRIDGE_TOKEN")
		if httpToken == "" {
			fmt.Fprintln(os.Stderr, "[brain] WARNING: CONSTRUCT_BRIDGE_TOKEN unset — HTTP transport is UNAUTHENTICATED")
		}
		httpSrv := sidecar.NewHTTP(fmt.Sprintf("127.0.0.1:%d", *httpPort), srv, frontendBridge, httpToken)
		go func() {
			fmt.Fprintf(os.Stderr, "[brain] HTTP listening on 127.0.0.1:%d (/v1/request, /v1/stream)\n", *httpPort)
			if err := httpSrv.Serve(ctx); err != nil {
				fmt.Fprintln(os.Stderr, "[brain] http serve:", err)
			}
		}()
	}

	serveErr := srv.Serve(ctx)
	// Clean shutdown for language-server children — without the LSP
	// shutdown/exit handshake, heavy servers (rust-analyzer) linger
	// orphaned holding hundreds of MB until they notice the parent died.
	if kit != nil && kit.LSPMgr != nil {
		kit.LSPMgr.Shutdown()
	}
	if serveErr != nil {
		fmt.Fprintln(os.Stderr, "serve:", serveErr)
		os.Exit(1)
	}
}

// resolveSkillDirs combines explicit --skills-dir flags with sensible
// defaults: the profile's skills/ dir plus ~/Spaces/space-*/agent/skills.
func resolveSkillDirs(explicit []string, p paths.Paths) []string {
	dirs := append([]string{}, explicit...)
	dirs = append(dirs, p.SkillsDir)
	if home, err := os.UserHomeDir(); err == nil {
		matches, _ := filepath.Glob(filepath.Join(home, "Spaces", "space-*", "agent", "skills"))
		dirs = append(dirs, matches...)
	}
	return dirs
}

// populateSkillRegistry seeds the load_skill tool's lookup table with
// space-discovered skills (read on demand from disk) and agent-bundled
// skills (bodies already in memory from agents/builtin/*).
func populateSkillRegistry(reg *tool.SkillRegistry, skills []skill.Skill, agentReg *agents.Registry) {
	for _, s := range skills {
		reg.Add(tool.SkillEntry{ID: s.ID, Name: s.Name, Description: s.Description, Path: s.Path})
	}
	if agentReg == nil {
		return
	}
	for _, a := range agentReg.List() {
		for _, s := range a.Skills {
			body := a.SkillBodies[s.ID]
			reg.Add(tool.SkillEntry{ID: s.ID, Name: s.Name, Description: s.Description, Body: body})
		}
	}
}

// loadHooks scans every skill dir's sibling hooks/ directory for shell
// hook definitions. Returns an empty set if nothing's found — hooks are
// opt-in per space.
func loadHooks(skillDirs []string) *hook.Set {
	hooks := hook.NewSet()
	count := 0
	for _, d := range skillDirs {
		hookDir := filepath.Join(filepath.Dir(d), "hooks")
		n, _ := hooks.LoadDir(hookDir)
		count += n
	}
	fmt.Fprintf(os.Stderr, "[brain] loaded %d hook(s)\n", count)
	return hooks
}
