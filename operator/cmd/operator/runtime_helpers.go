package main

import "construct-operator/internal/agent"

func clientKey(clientID string) string {
	if clientID == "" {
		return "default"
	}
	return clientID
}

func runnerContextFromClientState(state *clientContextState) map[string]any {
	if state == nil {
		return nil
	}
	result := map[string]any{}
	if state.Mode != "" {
		result["mode"] = state.Mode
	}
	if len(state.Component) > 0 {
		result["component"] = cloneMap(state.Component)
	}
	if len(state.Selection) > 0 {
		result["selection"] = cloneMap(state.Selection)
	}
	if len(result) == 0 {
		return nil
	}
	return result
}

func findAgent(agents []*agent.Config, id string) *agent.Config {
	for index := len(agents) - 1; index >= 0; index-- {
		candidate := agents[index]
		if candidate.ID == id || candidate.ID == "space:"+id {
			return candidate
		}
	}
	return nil
}

func resolveAgent(agents []*agent.Config, fallback *agent.Config, id string) *agent.Config {
	if id == "" {
		if agentCfg := findAgent(agents, "vibe"); agentCfg != nil {
			return agentCfg
		}
		return fallback
	}
	if agentCfg := findAgent(agents, id); agentCfg != nil {
		return agentCfg
	}
	if id == "general" {
		return fallback
	}
	return nil
}
