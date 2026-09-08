package main

import (
	"encoding/json"
	"testing"
)

func TestIsDestructiveSpaceAction(t *testing.T) {
	destructive := []string{
		"org.remove_member",
		"deleteTask",
		"mail.send",
		"sendEmail",
		"mail-send",
		"org.invite",
		"payInvoice",
		"space.publish",
		"resetBoard",
		"revokeToken",
		"", // unparseable input fails closed
	}
	for _, a := range destructive {
		if !isDestructiveSpaceAction(a) {
			t.Errorf("isDestructiveSpaceAction(%q) = false, want true", a)
		}
	}

	benign := []string{
		"createTask",
		"org.list_members",
		"org.list_invitations", // "invitations" is not the verb "invite"
		"project.create",
		"moveTask",
		"board.update_card",
		"calendar.find_free_slot",
		"org.info",
		"project.refresh",
	}
	for _, a := range benign {
		if isDestructiveSpaceAction(a) {
			t.Errorf("isDestructiveSpaceAction(%q) = true, want false", a)
		}
	}
}

func TestActionWords(t *testing.T) {
	cases := map[string][]string{
		"org.remove_member": {"org", "remove", "member"},
		"sendEmail":         {"send", "email"},
		"mail-send":         {"mail", "send"},
		"createTask":        {"create", "task"},
	}
	for in, want := range cases {
		got := actionWords(in)
		if len(got) != len(want) {
			t.Errorf("actionWords(%q) = %v, want %v", in, got, want)
			continue
		}
		for i := range want {
			if got[i] != want[i] {
				t.Errorf("actionWords(%q) = %v, want %v", in, got, want)
				break
			}
		}
	}
}

func TestUnwrapCallTool(t *testing.T) {
	// call_tool envelope resolves to the inner tool + args.
	name, input := unwrapCallTool("call_tool", json.RawMessage(`{"name":"space_run_action","args":{"space":"org","action":"org.remove_member","args":{"id":"x"}}}`))
	if name != "space_run_action" {
		t.Fatalf("unwrapCallTool name = %q, want space_run_action", name)
	}
	if got := spaceActionFromInput(input); got != "org.remove_member" {
		t.Errorf("inner action = %q, want org.remove_member", got)
	}

	// Direct calls pass through untouched.
	name, _ = unwrapCallTool("bash", json.RawMessage(`{"command":"ls"}`))
	if name != "bash" {
		t.Errorf("direct name = %q, want bash", name)
	}

	// Unparseable envelope gates on the literal name (no panic, no loop).
	name, _ = unwrapCallTool("call_tool", json.RawMessage(`garbage`))
	if name != "call_tool" {
		t.Errorf("garbage envelope name = %q, want call_tool", name)
	}
}

func TestSpaceActionFromInput(t *testing.T) {
	if got := spaceActionFromInput(json.RawMessage(`{"space":"org","action":"org.remove_member","args":{}}`)); got != "org.remove_member" {
		t.Errorf("spaceActionFromInput = %q, want org.remove_member", got)
	}
	if got := spaceActionFromInput(json.RawMessage(`not json`)); got != "" {
		t.Errorf("spaceActionFromInput on garbage = %q, want empty", got)
	}
}
