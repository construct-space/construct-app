package tool

import (
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"strings"
)

// CheckEnv reports installed runtimes + Construct CLI presence. Agents
// (Architect especially) call this BEFORE generating a plan so missing
// prerequisites get surfaced upfront instead of buried in error logs.
//
// Mirrors operator's check_environment shape so frontend renderers that
// already understand operator's output keep working.
type CheckEnv struct{}

func (CheckEnv) Name() string { return "check_environment" }

func (CheckEnv) Description() string {
	return "Report which runtimes (Bun, Node, git, Rust, Go) and the Construct CLI are installed. Returns JSON so agents can announce missing prerequisites before generating plans that assume them. Use during prerequisites/setup, not mid-implementation."
}

func (CheckEnv) InputSchema() map[string]any {
	return map[string]any{"type": "object", "properties": map[string]any{}}
}

type envReport struct {
	Runtimes        map[string]string `json:"runtimes"`
	ConstructCLI    string            `json:"construct_cli"`
	Packages        map[string]bool   `json:"packages"`
	MissingRuntimes []string          `json:"missing_runtimes,omitempty"`
	MissingPackages []string          `json:"missing_packages,omitempty"`
	Ready           bool              `json:"ready"`
}

func (CheckEnv) Execute(ctx context.Context, _ json.RawMessage) (string, error) {
	rep := &envReport{
		Runtimes: map[string]string{},
		Packages: map[string]bool{},
	}
	probes := []struct {
		key  string
		cmd  string
		args []string
	}{
		{"bun", "bun", []string{"--version"}},
		{"node", "node", []string{"--version"}},
		{"npm", "npm", []string{"--version"}},
		{"git", "git", []string{"--version"}},
		{"go", "go", []string{"version"}},
		{"rustc", "rustc", []string{"--version"}},
	}
	for _, p := range probes {
		if v := runVersion(ctx, p.cmd, p.args...); v != "" {
			rep.Runtimes[p.key] = v
		} else {
			rep.MissingRuntimes = append(rep.MissingRuntimes, p.key)
		}
	}
	rep.ConstructCLI = runVersion(ctx, "construct", "--version")

	const cliPkg = "@construct-space/cli"
	listing := runCmd(ctx, "bun", "pm", "ls", "-g")
	cliPresent := rep.ConstructCLI != "" || strings.Contains(listing, cliPkg)
	rep.Packages[cliPkg] = cliPresent
	if !cliPresent {
		rep.MissingPackages = append(rep.MissingPackages, cliPkg)
	}

	rep.Ready = rep.Runtimes["bun"] != ""
	buf, err := json.MarshalIndent(rep, "", "  ")
	if err != nil {
		return "", fmt.Errorf("marshal: %w", err)
	}
	return string(buf), nil
}

func runVersion(ctx context.Context, name string, args ...string) string {
	out := runCmd(ctx, name, args...)
	if idx := strings.IndexByte(out, '\n'); idx >= 0 {
		out = out[:idx]
	}
	return strings.TrimSpace(out)
}

func runCmd(ctx context.Context, name string, args ...string) string {
	cmd := exec.CommandContext(ctx, name, args...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return ""
	}
	return string(out)
}
