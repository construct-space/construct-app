// Coder permission wire ops — `coder.set_permission_mode` writes the
// permission_mode file the agent loop reads at gate-build time;
// `coder.permission_respond` records a "remember-this-decision" grant
// so future invocations don't prompt again.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/construct-space/brain/sidecar"
	"github.com/construct-space/brain/wire"
)

// rememberedDecision captures a "remember" choice from the permission
// modal so brain's gate can short-circuit future requests for the same
// tool. Persisted as <DataDir>/permissions.json.
type rememberedDecision struct {
	Tool   string `json:"tool"`
	Action string `json:"action"` // "allow" | "deny"
}

type permissionMemory struct {
	mu      sync.RWMutex
	tools   map[string]string // tool -> "allow"|"deny"
	dataDir string
}

func newPermissionMemory(dataDir string) *permissionMemory {
	pm := &permissionMemory{tools: map[string]string{}, dataDir: dataDir}
	pm.load()
	return pm
}

func (pm *permissionMemory) load() {
	body, err := os.ReadFile(filepath.Join(pm.dataDir, "permissions.json"))
	if err != nil {
		return
	}
	var raw []rememberedDecision
	if err := json.Unmarshal(body, &raw); err != nil {
		return
	}
	pm.mu.Lock()
	defer pm.mu.Unlock()
	for _, d := range raw {
		if d.Tool == "" {
			continue
		}
		pm.tools[d.Tool] = d.Action
	}
}

func (pm *permissionMemory) save() error {
	pm.mu.RLock()
	out := make([]rememberedDecision, 0, len(pm.tools))
	for tool, action := range pm.tools {
		out = append(out, rememberedDecision{Tool: tool, Action: action})
	}
	pm.mu.RUnlock()
	body, err := json.MarshalIndent(out, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(pm.dataDir, "permissions.json"), body, 0o644)
}

// Remember records a tool decision. Returns true if the file was
// rewritten (the caller can log the persistence).
func (pm *permissionMemory) Remember(tool, action string) error {
	if tool == "" {
		return fmt.Errorf("tool name required")
	}
	pm.mu.Lock()
	pm.tools[tool] = action
	pm.mu.Unlock()
	return pm.save()
}

// Lookup returns the remembered action for a tool, if any. The agent
// gate calls this before round-tripping to the frontend modal.
func (pm *permissionMemory) Lookup(tool string) (string, bool) {
	pm.mu.RLock()
	defer pm.mu.RUnlock()
	v, ok := pm.tools[tool]
	return v, ok
}

func registerCoderHandlers(s *sidecar.Server, dataDir string, mem *permissionMemory) {
	// coder.set_permission_mode — writes <DataDir>/permission_mode. The
	// agent loop reads this at gate-build time (see buildPermissionGate).
	s.Handle("coder.set_permission_mode", func(_ context.Context, req wire.Request, emit func(wire.Response)) {
		var pl struct {
			Mode string `json:"mode"`
		}
		_ = json.Unmarshal(req.Payload, &pl)
		mode := strings.TrimSpace(pl.Mode)
		if mode == "" {
			emit(wire.Response{ID: req.ID, Success: false, Error: "payload.mode is required", Done: true})
			return
		}
		if err := os.WriteFile(filepath.Join(dataDir, "permission_mode"), []byte(mode), 0o644); err != nil {
			emit(wire.Response{ID: req.ID, Success: false, Error: err.Error(), Done: true})
			return
		}
		emit(wire.Response{ID: req.ID, Success: true, Data: map[string]any{"mode": mode}, Done: true})
	})

	// coder.permission_respond — frontend pushes a decision after the
	// user clicks Allow/Deny in the permission modal. When `remember`
	// is true, the choice is persisted to permissions.json so the
	// gate auto-resolves future requests for the same tool.
	s.Handle("coder.permission_respond", func(_ context.Context, req wire.Request, emit func(wire.Response)) {
		var pl struct {
			Tool     string `json:"tool"`
			Action   string `json:"action"`
			Remember bool   `json:"remember"`
		}
		_ = json.Unmarshal(req.Payload, &pl)
		tool := strings.TrimSpace(pl.Tool)
		action := strings.ToLower(strings.TrimSpace(pl.Action))
		if tool == "" || (action != "allow" && action != "deny") {
			emit(wire.Response{ID: req.ID, Success: false, Error: "payload.tool and payload.action (allow|deny) are required", Done: true})
			return
		}
		if pl.Remember {
			if err := mem.Remember(tool, action); err != nil {
				emit(wire.Response{ID: req.ID, Success: false, Error: err.Error(), Done: true})
				return
			}
		}
		emit(wire.Response{ID: req.ID, Success: true, Data: map[string]any{
			"tool":       tool,
			"action":     action,
			"remembered": pl.Remember,
		}, Done: true})
	})
}
