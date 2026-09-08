// Permission gating — turns the on-disk permission_mode file into an
// agent.PermissionGate. The agent loop consults the gate before every
// tool execution; "ask" mode round-trips through the frontend SSE
// channel so the user can approve mutating calls in real time.
package main

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"

	"github.com/construct-space/brain/agent"
	"github.com/construct-space/brain/bridge"
)

// buildPermissionGate reads the permission_mode file once per prompt and
// returns an agent.PermissionGate that enforces it. Modes:
//
//	"default" / "" — no blanket gating, but destructive space actions
//	                 (delete/send/remove/…) still confirm with the user.
//	"yolo"         — same as default; explicit "trust me" setting.
//	"strict"       — auto-deny any tool that mutates (write/edit/bash/space_run_action).
//	"ask"          — consult remembered per-tool decisions first
//	                 (coder.permission_respond with remember:true); on miss,
//	                 round-trip through the frontend's permission modal via
//	                 bridge.Frontend. Frontend dispatches
//	                 `permission.request` and returns {allow: bool, reason?}.
func buildPermissionGate(dataDir string, frontend *bridge.Frontend, mem *permissionMemory) agent.PermissionGate {
	mode := strings.ToLower(strings.TrimSpace(readPermissionMode(dataDir)))
	switch mode {
	case "", "default", "yolo":
		// No blanket gating — but DESTRUCTIVE space actions still confirm,
		// regardless of mode. The assistant runs with web content in
		// context (web_fetch/web_search are ungated), so a prompt-injected
		// "remove this org member" / "send this mail" must not execute
		// silently. Benign mutations (create/add/update/move) stay
		// frictionless — gating createTask would put a modal in front of
		// the headline "add a task for Val" flow.
		if frontend == nil {
			return nil
		}
		return func(ctx context.Context, name string, input json.RawMessage) agent.PermissionDecision {
			name, input = unwrapCallTool(name, input)
			if name != "space_run_action" {
				return agent.PermissionDecision{Allow: true}
			}
			action := spaceActionFromInput(input)
			if !isDestructiveSpaceAction(action) {
				return agent.PermissionDecision{Allow: true}
			}
			// Key memory + the modal by the concrete action, not the bare
			// tool name — "always allow" on mail.send must not also waive
			// confirmation for org.remove_member.
			return askUserPermission(ctx, frontend, mem, "space_run_action:"+action, input)
		}
	case "strict":
		return func(_ context.Context, name string, input json.RawMessage) agent.PermissionDecision {
			name, _ = unwrapCallTool(name, input)
			if isMutatingTool(name) {
				return agent.PermissionDecision{Allow: false, Reason: "strict permission mode denies mutating tools"}
			}
			return agent.PermissionDecision{Allow: true}
		}
	case "ask":
		if frontend == nil {
			return nil
		}
		return func(ctx context.Context, name string, input json.RawMessage) agent.PermissionDecision {
			name, input = unwrapCallTool(name, input)
			if !isMutatingTool(name) {
				return agent.PermissionDecision{Allow: true}
			}
			return askUserPermission(ctx, frontend, mem, name, input)
		}
	}
	return nil
}

// unwrapCallTool resolves a call_tool envelope to the tool it actually
// dispatches, so gates evaluate the INNER tool. Without this, hidden
// tools invoked via the pi-shape dispatcher ("call_tool" → name/args)
// bypass every mode's gating — the live smoke test ran a destructive
// org.remove_member ungated exactly this way. Bounded unwrap in case of
// nested envelopes; an unparseable envelope is returned as-is and gates
// on the literal name.
func unwrapCallTool(name string, input json.RawMessage) (string, json.RawMessage) {
	for i := 0; i < 3 && name == "call_tool"; i++ {
		var in struct {
			Name string          `json:"name"`
			Args json.RawMessage `json:"args"`
		}
		if err := json.Unmarshal(input, &in); err != nil || in.Name == "" {
			break
		}
		name, input = in.Name, in.Args
	}
	return name, input
}

// askUserPermission consults remembered decisions, then round-trips the
// frontend's permission modal. `key` is what the user approves/denies and
// what a "remember" persists — pass a composite ("tool:action") when
// tool-name granularity is too coarse.
func askUserPermission(ctx context.Context, frontend *bridge.Frontend, mem *permissionMemory, key string, input json.RawMessage) agent.PermissionDecision {
	// Honour persisted "remember" decisions before bothering the user.
	// The modal updates this map via coder.permission_respond.
	if mem != nil {
		if action, ok := mem.Lookup(key); ok {
			return agent.PermissionDecision{
				Allow:  action == "allow",
				Reason: "remembered decision",
			}
		}
	}
	if !frontend.Available() {
		// No active stream → fall back to deny so the model can
		// recover gracefully. Beats hanging the agent loop.
		return agent.PermissionDecision{Allow: false, Reason: "permission modal unavailable (no active prompt stream)"}
	}
	out, err := frontend.Call(ctx, "permission.request", map[string]any{
		"tool":  key,
		"input": input,
	})
	if err != nil {
		return agent.PermissionDecision{Allow: false, Reason: err.Error()}
	}
	var resp struct {
		Allow  bool   `json:"allow"`
		Reason string `json:"reason"`
	}
	_ = json.Unmarshal(out, &resp)
	return agent.PermissionDecision{Allow: resp.Allow, Reason: resp.Reason}
}

// spaceActionFromInput pulls the `action` field out of a space_run_action
// input payload. Empty string when absent/unparseable.
func spaceActionFromInput(input json.RawMessage) string {
	var in struct {
		Action string `json:"action"`
	}
	_ = json.Unmarshal(input, &in)
	return strings.TrimSpace(in.Action)
}

// destructiveActionWords flags space-action verbs whose effects are hard to
// undo or leave the machine: deletion, outbound sends, money movement,
// access changes. Deliberately NOT here: create/add/update/move/open —
// recoverable in-app mutations the assistant should perform without a modal.
var destructiveActionWords = map[string]bool{
	"delete": true, "remove": true, "destroy": true, "wipe": true,
	"purge": true, "erase": true, "reset": true, "revoke": true,
	"uninstall": true, "send": true, "invite": true, "transfer": true,
	"pay": true, "purchase": true, "publish": true,
}

// isDestructiveSpaceAction reports whether a space action id contains a
// destructive verb. Action ids vary by convention ("org.remove_member",
// "sendEmail", "mail-send"), so match on words split at separators and
// camelCase boundaries. Empty/unparseable action ids gate as destructive —
// failing closed costs one modal; failing open costs an unconfirmed side
// effect.
func isDestructiveSpaceAction(action string) bool {
	if action == "" {
		return true
	}
	for _, w := range actionWords(action) {
		if destructiveActionWords[w] {
			return true
		}
	}
	return false
}

// actionWords splits an action id into lowercase words at non-alphanumeric
// separators and lower→upper camelCase boundaries.
func actionWords(action string) []string {
	var words []string
	var cur strings.Builder
	flush := func() {
		if cur.Len() > 0 {
			words = append(words, strings.ToLower(cur.String()))
			cur.Reset()
		}
	}
	prevLower := false
	for _, r := range action {
		switch {
		case r >= 'A' && r <= 'Z':
			if prevLower {
				flush()
			}
			cur.WriteRune(r)
			prevLower = false
		case (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9'):
			cur.WriteRune(r)
			prevLower = r >= 'a' && r <= 'z'
		default:
			flush()
			prevLower = false
		}
	}
	flush()
	return words
}

func readPermissionMode(dataDir string) string {
	if dataDir == "" {
		return ""
	}
	b, err := os.ReadFile(filepath.Join(dataDir, "permission_mode"))
	if err != nil {
		return ""
	}
	return string(b)
}

// isMutatingTool reports whether a tool can change state outside the
// agent's own reasoning — on disk, in the repo, in the Graph DB, or in the
// outside world (email, marketplace publish). "strict" mode auto-denies
// these; "ask" mode routes them through the user. Keep this in sync as new
// side-effectful tools land — a missing entry silently lets the tool run
// ungated in both modes.
//
// Gating is tool-name-granular, so tools that mix reads and writes behind a
// single name (e.g. `graph` does both queries and mutations, `web_fetch`
// can GET or POST) can't be half-gated here. `graph` is included because a
// write is the higher-stakes case; read-only graph use in strict mode is an
// accepted casualty. `web_fetch`/`web_search` are intentionally NOT gated —
// they're predominantly reads, and blocking them would cripple research
// flows; treat exfiltration risk separately.
func isMutatingTool(name string) bool {
	// Graph DB mutations ship as space_graph_* tools; gate the writers by
	// name and leave the read-only ones (status / installs / spaces)
	// ungated. The old entries "graph" and "tasks" matched NO registered
	// tool — Graph pushes and task writes ran ungated in both modes.
	switch name {
	case "space_graph_push", "space_graph_migrate",
		"space_graph_install", "space_graph_uninstall":
		return true
	}
	switch name {
	case "write", "edit", "bash", "space_run_action",
		"git_commit",                 // rewrites repo history / index
		"notebook_edit",              // mutates notebook cells on disk
		"task_create", "task_update", // write task-tracker state
		"skill_manage",               // installs/edits skills on disk
		"memory",                     // writes persistent memory files
		"org_invite",                 // sends email + grants membership
		"space_scaffold", "space_build", // write files to disk
		"space_clean",                    // deletes build artifacts on disk
		"space_install", "space_publish", // install into profile / public release
		// In-app browser actions that reach the outside world or change page
		// state. The read-only browser tools (browser_tabs / browser_snapshot
		// / browser_screenshot / browser_wait_for) are intentionally ungated.
		"browser_open", "browser_navigate", // load arbitrary URLs
		"browser_click", "browser_type", "browser_press_key": // interact with / submit pages
		return true
	}
	return false
}
