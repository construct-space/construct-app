package builtin

import (
	"strings"
	"testing"
)

func TestCoderAgentSystemRequiresNarrationAroundToolCalls(t *testing.T) {
	system := coderAgent().System

	for _, phrase := range []string{
		"Before the first tool call in each turn, emit one short user-facing narration sentence.",
		"After any tool result, emit one short user-facing follow-up before the next tool call or final answer.",
		"Silence is failure",
	} {
		if !strings.Contains(system, phrase) {
			t.Fatalf("expected coder system prompt to contain %q", phrase)
		}
	}
}

func TestCoderAgentSystemIncludesConstructSpaceWorkflowKnowledge(t *testing.T) {
	system := coderAgent().System

	for _, phrase := range []string{
		"If it has a space.manifest.json → it's a Construct space. Use space tools",
		"If it has package.json or src/ → it's a standard app. Use bash (bun init, bun add, bun run dev).",
		"Never assume a project is a Construct space. Read first, decide, build.",
		"space_check",
		"space_build",
		"space_validate",
		"space_install",
		"construct_open_dev",
	} {
		if !strings.Contains(system, phrase) {
			t.Fatalf("expected coder system prompt to contain %q", phrase)
		}
	}
}
