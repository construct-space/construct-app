// Tool registry construction. Lifted out of main.go so the visible /
// hidden tool list is reviewable in one place. Returns the registries
// (plus task store + skill registry) ready for the rest of brain boot.
//
// Subagent registration lives in subagent_tool.go — it has to run AFTER
// skills + hooks are loaded so the closure can capture them, so brain's
// boot sequence calls buildToolRegistry first then registerSubagentTool.
package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/construct-space/brain/bridge"
	"github.com/construct-space/brain/lsp"
	"github.com/construct-space/brain/state"
	"github.com/construct-space/brain/tool"
)

// toolDeps is the bag of state tool constructors need at boot. Pure
// data; no behavior. main.go fills one and passes it in.
type toolDeps struct {
	HTTPBridge     *bridge.Client
	FrontendBridge *bridge.Frontend
	StateStore     *state.Store
	SourceURL      string
	AuthToken      string
	MemoryDir      string // <BrainDir>/memory — backs the `memory` tool
	SkillsDir      string // <DataDir>/skills — backs the `skill_manage` tool
}

// toolKit is what buildToolRegistry returns — the tool registry plus
// the auxiliary stores callers need to hand to wire handlers later.
type toolKit struct {
	Tools       *tool.Registry
	SkillReg    *tool.SkillRegistry
	TaskStore   *tool.TaskStore
	LSPMgr      *lsp.Manager
	MemoryStore *tool.MemoryStore
}

// buildToolRegistry registers every built-in tool. Visible tools ship
// in the per-turn schema array; hidden tools are reachable via
// call_tool but cost zero per-turn tokens. See feedback_brain_pi_shape
// — 4 file ops + 4 meta-tools is the only visible set we maintain.
func buildToolRegistry(d toolDeps) *toolKit {
	skillReg := tool.NewSkillRegistry()
	tools := tool.NewRegistry()

	// ─── Visible: read/write/edit/bash + the four meta-tools that drive
	// discovery. Nine schemas total, ~5KB per turn.
	tools.Register(tool.Read{})
	tools.Register(tool.Write{})
	tools.Register(tool.Edit{})
	tools.Register(tool.Bash{})
	tools.Register(tool.ListTools{Reg: tools})
	tools.Register(tool.CallTool{Reg: tools})
	tools.Register(tool.ListSkills{Reg: skillReg})
	tools.Register(tool.LoadSkill{Reg: skillReg})

	tools.Register(tool.WebFetch{})
	tools.Register(tool.WebSearch{})

	// ─── Hidden: discoverable via list_tools, invocable via call_tool.
	tools.RegisterHidden(tool.Glob{})
	tools.RegisterHidden(tool.Grep{})
	tools.RegisterHidden(tool.ListDir{})
	tools.RegisterHidden(tool.CheckEnv{})
	tools.RegisterHidden(tool.GitStatus{})
	tools.RegisterHidden(tool.GitDiff{})
	tools.RegisterHidden(tool.GitLog{})
	tools.RegisterHidden(tool.GitCommit{})
	tools.RegisterHidden(tool.GitBranch{})
	tools.RegisterHidden(tool.GraphInit{})
	tools.RegisterHidden(tool.GraphGenerate{})
	tools.RegisterHidden(tool.GraphPush{})
	tools.RegisterHidden(tool.GraphMigrate{})
	tools.RegisterHidden(tool.GraphStatus{})
	// Graph distribution + publisher/tenant ops — each mirrors a
	// `construct graph <cmd>` management subcommand (see graph_distribution.go).
	tools.RegisterHidden(tool.GraphFork{})
	tools.RegisterHidden(tool.GraphSpaces{})
	tools.RegisterHidden(tool.GraphBundles{})
	tools.RegisterHidden(tool.GraphInstall{})
	tools.RegisterHidden(tool.GraphUninstall{})
	tools.RegisterHidden(tool.GraphInstalls{})
	tools.RegisterHidden(tool.GraphDistribution{})
	tools.RegisterHidden(tool.GraphAllowlist{})
	tools.RegisterHidden(tool.AskUser{Frontend: d.FrontendBridge})
	tools.RegisterHidden(tool.PDFRead{})
	tools.RegisterHidden(tool.NotebookRead{})
	tools.RegisterHidden(tool.NotebookEdit{})
	tools.RegisterHidden(tool.MarketplaceSearch{})
	tools.RegisterHidden(tool.StartPreview{Frontend: d.FrontendBridge})
	tools.RegisterHidden(tool.RequestProjectSetup{Frontend: d.FrontendBridge, State: d.StateStore})
	tools.RegisterHidden(tool.SpaceListActions{Bridge: d.HTTPBridge})
	// Capability router: bridge (desktop, app open) first, else the headless
	// space-runtime (cloud executor / headless desktop). URL is overridable.
	spaceRuntimeURL := os.Getenv("CONSTRUCT_SPACE_RUNTIME_URL")
	if spaceRuntimeURL == "" {
		spaceRuntimeURL = "http://127.0.0.1:60190"
	}
	tools.RegisterHidden(tool.SpaceRunAction{
		Bridge:  d.HTTPBridge,
		Runtime: &tool.SpaceRuntimeClient{URL: spaceRuntimeURL, Token: d.AuthToken},
	})
	// "go to Mail / open Calendar" — routes the main app to an installed
	// space via the frontend's space.navigate handler. VISIBLE (not hidden):
	// this is a primary user verb, and behind list_tools the agent failed to
	// reach for it on a terse "go to mail" and wrongly claimed it couldn't
	// navigate. Surfacing it in tier-1 makes the agent use it directly.
	tools.Register(tool.NavigateSpace{Bridge: d.HTTPBridge})
	// Visual verify loop: enumerate windows, screenshot the preview, and
	// hand the image back to the model (see screenshot_window.ResultImages).
	// Visible (tier-1): "take a screenshot" / "show me the app" are primary
	// verbs. Hidden behind list_tools the agent failed to find them and
	// wrongly claimed it had no screenshot capability. screenshot_window
	// defaults to the main window; list_windows enumerates the rest.
	tools.Register(tool.ListWindows{Bridge: d.HTTPBridge})
	tools.Register(tool.ScreenshotWindow{Bridge: d.HTTPBridge})
	// In-app browser automation: open/navigate → snapshot → click/type/
	// press_key → wait_for/screenshot/close. Drives the Construct browser
	// window via the host's browser.* bridge methods. Hidden (pi-shape):
	// discovered through list_tools/call_tool, not in tier-1 disclosure.
	tools.RegisterHidden(tool.BrowserOpen{Bridge: d.HTTPBridge})
	tools.RegisterHidden(tool.BrowserTabs{Bridge: d.HTTPBridge})
	tools.RegisterHidden(tool.BrowserNavigate{Bridge: d.HTTPBridge})
	tools.RegisterHidden(tool.BrowserSnapshot{Bridge: d.HTTPBridge})
	tools.RegisterHidden(tool.BrowserClick{Bridge: d.HTTPBridge})
	tools.RegisterHidden(tool.BrowserType{Bridge: d.HTTPBridge})
	tools.RegisterHidden(tool.BrowserPressKey{Bridge: d.HTTPBridge})
	tools.RegisterHidden(tool.BrowserWaitFor{Bridge: d.HTTPBridge})
	tools.RegisterHidden(tool.BrowserScreenshot{Bridge: d.HTTPBridge})
	tools.RegisterHidden(tool.BrowserClose{Bridge: d.HTTPBridge})
	tools.RegisterHidden(tool.BrowserReset{Bridge: d.HTTPBridge})
	tools.RegisterHidden(tool.ListSpaces{})
	tools.RegisterHidden(tool.OrgMembers{SourceURL: d.SourceURL, AuthToken: d.AuthToken})
	tools.RegisterHidden(tool.OrgDepartments{SourceURL: d.SourceURL, AuthToken: d.AuthToken})
	tools.RegisterHidden(tool.OrgInvite{SourceURL: d.SourceURL, AuthToken: d.AuthToken})

	// Space lifecycle — every brain tool here mirrors a `construct <cmd>`
	// CLI command exactly. Surfaces stay paired so the agent and a human
	// running things by hand share behaviour.
	tools.RegisterHidden(tool.SpaceScaffold{})
	tools.RegisterHidden(tool.SpaceValidate{})
	tools.RegisterHidden(tool.SpaceCheck{})
	tools.RegisterHidden(tool.SpaceBuild{})
	tools.RegisterHidden(tool.SpaceInstall{})
	tools.RegisterHidden(tool.SpacePublish{})
	tools.RegisterHidden(tool.SpaceClean{})

	// Task tracker — session-scoped. handlePrompt rebinds the session id
	// before each turn so task_create/_update/_list land in the right bucket.
	taskStore := tool.NewTaskStore()
	tools.RegisterHidden(tool.TaskCreateTool{Store: taskStore})
	tools.RegisterHidden(tool.TaskUpdateTool{Store: taskStore})
	tools.RegisterHidden(tool.TaskListTool{Store: taskStore})

	// Cross-session memory — the model self-curates MEMORY.md / USER.md, which
	// wire_prompt injects into the system prompt each turn (the "grows with
	// you" loop). Per-profile, not per-session.
	// Memory is VISIBLE (not hidden) so the model reliably reaches for it when
	// the user says "remember…" or reveals a durable preference — a hidden
	// tool only surfaces after list_tools, and the model would otherwise treat
	// "remember" as session-only chat. Worth the one extra per-turn schema.
	// Dirs are resolved LIVE (currentPaths) on each access, not captured at
	// boot — the brain can switch profiles without restarting, and a static
	// boot-time dir would strand memory/skill writes in the wrong profile.
	memStore := tool.NewMemoryStoreFn(func() string { return filepath.Join(currentPaths().BrainDir, "memory") })
	tools.Register(tool.Memory{Store: memStore, Org: tool.NewOrgMemoryClient(d.SourceURL, d.AuthToken)})

	// Procedural memory — the model writes its own SKILL.md files to the
	// profile skills dir (loaded into list_skills on next boot/reload).
	skillStore := tool.NewSkillStoreFn(func() string { return currentPaths().SkillsDir })
	tools.RegisterHidden(tool.SkillManage{Store: skillStore})

	// LSP — lazy per-(workspace, language) client cache. Servers boot on
	// first tool call and idle-shutdown after a few minutes; brain stays
	// cheap when nobody's coding.
	lspMgr := lsp.NewManager()
	if servers := lspMgr.RegisterDefaults(); len(servers) > 0 {
		fmt.Fprintf(os.Stderr, "[brain] lsp: detected %s\n", strings.Join(servers, ", "))
	} else {
		fmt.Fprintln(os.Stderr, "[brain] lsp: no language servers found on PATH")
	}
	tools.RegisterHidden(tool.LSPDiagnostics{Mgr: lspMgr})
	tools.RegisterHidden(tool.LSPDefinition{Mgr: lspMgr})
	tools.RegisterHidden(tool.LSPReferences{Mgr: lspMgr})
	tools.RegisterHidden(tool.LSPCallHierarchy{Mgr: lspMgr})

	return &toolKit{
		Tools:       tools,
		SkillReg:    skillReg,
		TaskStore:   taskStore,
		LSPMgr:      lspMgr,
		MemoryStore: memStore,
	}
}
