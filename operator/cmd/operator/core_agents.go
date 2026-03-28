package main

import "construct-operator/internal/agent"

// coreAgents returns the built-in agents that are always available.
// These are core to Construct and cannot be uninstalled — they exist
// regardless of which spaces are installed.
//
// Space agents (from installed spaces) are loaded separately and can
// override these if they have the same ID via the "space:<id>" namespace.
//
// Agent definitions live in separate files:
//   - agent_brainstorm.go
//   - agent_architect.go
//   - agent_vibe.go
//   - agent_project.go
//   - agent_space.go
func coreAgents() []*agent.Config {
	return []*agent.Config{
		brainstormAgent(),
		architectAgent(),
		coderAgent(),
		projectAgent(),
		spaceAgent(),
	}
}

// noBrowserTools is the common block list for agents that shouldn't use browser automation.
var noBrowserTools = []string{
	"browser_tabs", "browser_open", "browser_close", "browser_navigate",
	"browser_snapshot", "browser_click", "browser_type", "browser_press_key",
	"browser_wait_for", "browser_screenshot",
}
