package tool

import (
	"construct-operator/internal/agent"
	"construct-operator/internal/desktop"
	"construct-operator/internal/provider"
	"fmt"
	"os"
	"strings"
)

// PreRegisterSpaceAgentTools registers space action tools at startup from agent configs.
// No bridge query needed — tools are registered with generic schemas and a bridge executor
// that calls space.run_action at execution time (when the frontend is ready).
//
// This ensures tools are available INSTANTLY when an agent dispatches,
// eliminating the race between operator startup and frontend loading.
func PreRegisterSpaceAgentTools(r *Registry, bridge *desktop.Client, agents []*agent.Config, spaceIDs []string) {
	if bridge == nil {
		return
	}

	spaceSet := make(map[string]bool, len(spaceIDs))
	for _, sid := range spaceIDs {
		spaceSet[sid] = true
	}

	registered := 0
	for _, ag := range agents {
		for _, toolName := range ag.Tools {
			// Only pre-register space-namespaced tools (e.g., "canvas.create_card")
			parts := strings.SplitN(toolName, ".", 2)
			if len(parts) != 2 {
				continue
			}
			spaceID, actionID := parts[0], parts[1]
			if !spaceSet[spaceID] {
				continue
			}

			// Skip if already registered (from a previous agent or static registration)
			if _, exists := r.Get(toolName); exists {
				continue
			}

			// Register with generic schema — will be upgraded when frontend signals readiness
			r.Register(&Tool{
				Def: provider.ToolDef{
					Name:        toolName,
					Description: fmt.Sprintf("[%s] %s", spaceID, actionID),
					InputSchema: map[string]any{
						"type":       "object",
						"properties": map[string]any{},
					},
				},
				Executor: &spaceActionExec{
					bridge:  bridge,
					spaceID: spaceID,
					action:  actionID,
				},
				Source: "space:" + spaceID,
			})
			registered++
		}
	}

	if registered > 0 {
		fmt.Fprintf(os.Stderr, "[tools] pre-registered %d space action tools from agent configs\n", registered)
	}
}
