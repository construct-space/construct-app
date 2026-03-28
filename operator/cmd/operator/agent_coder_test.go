package main

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
		"If the project is a Construct space, use the space tools directly",
		"Do NOT use bash for builds.",
		"construct-spaces skill has full documentation",
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
