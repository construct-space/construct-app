package runner

import (
	"context"
	"encoding/json"
	"fmt"

	"construct-operator/internal/provider"
	"construct-operator/internal/tool"
)

// handleSpawnAgent creates and runs a child agent.
func (r *Runner) handleSpawnAgent(ctx context.Context, parentReq *RunRequest, tc provider.ToolCall) provider.ToolResult {
	if r.agentResolver == nil {
		return provider.ToolResult{
			CallID:  tc.ID,
			Content: "agent spawning not configured",
			IsError: true,
		}
	}

	var args struct {
		AgentID string `json:"agent_id"`
		Task    string `json:"task"`
	}
	if err := json.Unmarshal([]byte(tc.Input), &args); err != nil {
		return provider.ToolResult{
			CallID:  tc.ID,
			Content: fmt.Sprintf("invalid spawn_agent input: %v", err),
			IsError: true,
		}
	}

	// Check spawn allowlist if set
	if len(parentReq.Agent.SpawnAllowed) > 0 {
		allowed := false
		for _, a := range parentReq.Agent.SpawnAllowed {
			if a == args.AgentID {
				allowed = true
				break
			}
		}
		if !allowed {
			return provider.ToolResult{
				CallID:  tc.ID,
				Content: fmt.Sprintf("agent %q not in spawn allowlist: %v", args.AgentID, parentReq.Agent.SpawnAllowed),
				IsError: true,
			}
		}
	}

	childAgent := r.agentResolver(args.AgentID)
	if childAgent == nil {
		return provider.ToolResult{
			CallID:  tc.ID,
			Content: fmt.Sprintf("agent %q not found", args.AgentID),
			IsError: true,
		}
	}

	result, err := r.Run(ctx, &RunRequest{
		Agent:   childAgent,
		Task:    args.Task,
		Model:   parentReq.Model,
		Project: parentReq.Project,
		Stream:  parentReq.Stream, // Forward parent's stream so sub-agent events are visible
	})
	if err != nil {
		return provider.ToolResult{
			CallID:  tc.ID,
			Content: fmt.Sprintf("sub-agent error: %v", err),
			IsError: true,
		}
	}

	return provider.ToolResult{
		CallID:  tc.ID,
		Content: result.Content,
	}
}

// RegisterSpawnTool adds the spawn_agent tool to the registry if any agent can spawn.
func RegisterSpawnTool(reg *tool.Registry) {
	reg.Register(&tool.Tool{
		Def: provider.ToolDef{
			Name:        "spawn_agent",
			Description: "Spawn a sub-agent to handle a specific task. The sub-agent runs independently and returns its result.",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"agent_id": map[string]any{
						"type":        "string",
						"description": "ID of the agent to spawn (e.g. 'architect', 'general')",
					},
					"task": map[string]any{
						"type":        "string",
						"description": "The task for the sub-agent to perform",
					},
				},
				"required": []string{"agent_id", "task"},
			},
		},
		// Executor is handled specially in the runner (not via the registry)
		Executor: &noopExecutor{},
		Source:   "builtin",
	})
}

type noopExecutor struct{}

func (n *noopExecutor) Execute(ctx context.Context, input string) (*tool.Result, error) {
	return &tool.Result{Content: "spawn_agent is handled by the runner"}, nil
}
