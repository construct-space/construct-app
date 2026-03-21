// Package space loads agent configs, tools, and skills from installed spaces.
//
// Spaces are programs (Vue + PixiJS, etc.) that run inside Construct.
// Each space can ship an agent/ directory with:
//   - config.md — agent config (YAML frontmatter) + system prompt (markdown body)
//   - tools/*.md — custom tools (YAML frontmatter: params, command) + AI instructions
//
// Operator is space-agnostic — it just loads whatever agents/tools spaces provide.
// Space agents get namespaced as "space:<id>" to avoid conflicts.
package space

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"construct-operator/internal/agent"
	"construct-operator/internal/hook"
	"construct-operator/internal/plugin"
	"construct-operator/internal/provider"
	"construct-operator/internal/skill"
	"construct-operator/internal/tool"

	"gopkg.in/yaml.v3"
)

// Manifest is the relevant fields from a space's manifest.json.
type Manifest struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Icon        string `json:"icon"`
}

// AgentMarkdown is the parsed YAML frontmatter from agent/config.md.
type AgentMarkdown struct {
	ID              string   `yaml:"id"`
	Name            string   `yaml:"name"`
	Category        string   `yaml:"category"`
	Description     string   `yaml:"description"`
	MaxIterations   int      `yaml:"maxIterations"`
	AllowedTools    []string `yaml:"allowedTools"`
	BlockedTools    []string `yaml:"blockedTools"`
	CanInvokeAgents []string `yaml:"canInvokeAgents"`
	SystemPrompt    string   `yaml:"-"` // markdown body
}

// ToolMarkdown is a tool defined in agent/tools/*.md.
type ToolMarkdown struct {
	ID          string          `yaml:"id"`
	Name        string          `yaml:"name"`
	Description string          `yaml:"description"`
	Parameters  []ToolParameter `yaml:"parameters"`
	Command     string          `yaml:"command"`
	Workdir     string          `yaml:"workdir"`
	Timeout     int             `yaml:"timeout"`
	Confirm     bool            `yaml:"confirm"`
	Body        string          `yaml:"-"` // AI instructions from markdown body
	SpaceID     string          `yaml:"-"`
}

// ToolParameter defines a tool parameter.
type ToolParameter struct {
	Name        string   `yaml:"name"`
	Type        string   `yaml:"type"`
	Description string   `yaml:"description"`
	Required    bool     `yaml:"required"`
	Enum        []string `yaml:"enum"`
}

// LoadResult is what loading a space returns.
type LoadResult struct {
	SpaceID string
	Agent   *agent.Config
	Tools   []*tool.Tool
	Hooks   []hook.Hook
	Skills  []*skill.Skill
	Plugins []*plugin.PluginManifest
}

// WorkDirFunc returns the current working directory dynamically.
type WorkDirFunc func(context.Context) string

// LoadAll scans a spaces directory and loads all agents + tools.
func LoadAll(spacesDir string, getWorkDir WorkDirFunc) ([]LoadResult, error) {
	entries, err := os.ReadDir(spacesDir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}

	var results []LoadResult

	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}

		spaceDir := filepath.Join(spacesDir, entry.Name())
		result, err := loadSpace(spaceDir, getWorkDir)
		if err != nil {
			fmt.Fprintf(os.Stderr, "[space] warning: %s: %v\n", entry.Name(), err)
			continue
		}
		if result != nil {
			results = append(results, *result)
		}
	}

	return results, nil
}

func loadSpace(spaceDir string, getWorkDir WorkDirFunc) (*LoadResult, error) {
	// Read manifest (installed spaces use manifest.json, source repos use space.manifest.json)
	manifestPath := filepath.Join(spaceDir, "manifest.json")
	manifestData, err := os.ReadFile(manifestPath)
	if err != nil {
		manifestData, err = os.ReadFile(filepath.Join(spaceDir, "space.manifest.json"))
		if err != nil {
			return nil, nil // No manifest, skip
		}
	}

	var manifest Manifest
	if err := json.Unmarshal(manifestData, &manifest); err != nil {
		return nil, fmt.Errorf("invalid manifest: %w", err)
	}

	// Look for agent/ directory
	agentDir := filepath.Join(spaceDir, "agent")
	if _, err := os.Stat(agentDir); os.IsNotExist(err) {
		return nil, nil // No agent directory, skip
	}

	result := &LoadResult{SpaceID: manifest.ID}

	// Load agent config: agent/config.md (new) or agent/agent.md (legacy)
	agentPath := filepath.Join(agentDir, "config.md")
	if _, err := os.Stat(agentPath); os.IsNotExist(err) {
		agentPath = filepath.Join(agentDir, "agent.md")
	}
	if agentData, err := os.ReadFile(agentPath); err == nil {
		agentCfg, err := parseAgentMarkdown(string(agentData), manifest)
		if err == nil {
			result.Agent = agentCfg
		} else {
			fmt.Fprintf(os.Stderr, "[space] warning: %s agent parse: %v\n", manifest.ID, err)
		}
	}

	// Load tools from agent/tools/*.md
	toolsDir := filepath.Join(agentDir, "tools")
	if entries, err := os.ReadDir(toolsDir); err == nil {
		for _, f := range entries {
			if f.IsDir() || filepath.Ext(f.Name()) != ".md" {
				continue
			}
			toolData, err := os.ReadFile(filepath.Join(toolsDir, f.Name()))
			if err != nil {
				continue
			}
			t, err := parseToolMarkdown(string(toolData), manifest.ID, getWorkDir)
			if err != nil {
				fmt.Fprintf(os.Stderr, "[space] warning: %s tool %s: %v\n", manifest.ID, f.Name(), err)
				continue
			}
			result.Tools = append(result.Tools, t)
		}
	}

	// Load hooks from agent/hooks/*.json
	hooksDir := filepath.Join(agentDir, "hooks")
	if hooks, err := hook.LoadFromDir(hooksDir, "space:"+manifest.ID); err == nil {
		result.Hooks = hooks
	}

	// Load skills from agent/skills/*.md
	skillsDir := filepath.Join(agentDir, "skills")
	if skills, err := skill.LoadFromDir(skillsDir, "space:"+manifest.ID); err == nil {
		result.Skills = skills
	}

	// Load plugins from agent/plugins/*/plugin.json
	pluginsDir := filepath.Join(agentDir, "plugins")
	if manifests, err := plugin.ScanDir(pluginsDir); err == nil {
		result.Plugins = manifests
	}

	return result, nil
}

func parseAgentMarkdown(content string, manifest Manifest) (*agent.Config, error) {
	frontmatter, body, err := splitFrontmatter(content)
	if err != nil || frontmatter == "" {
		return nil, fmt.Errorf("no frontmatter")
	}

	var am AgentMarkdown
	if err := yaml.Unmarshal([]byte(frontmatter), &am); err != nil {
		return nil, err
	}

	return &agent.Config{
		ID:           "space:" + manifest.ID,
		Name:         am.Name,
		Description:  am.Description,
		Category:     "space",
		System:       body,
		Model:        "claude-sonnet-4-6",
		Tools:        am.AllowedTools,
		BlockTools:   am.BlockedTools,
		MaxTurns:     am.MaxIterations,
		CanSpawn:     len(am.CanInvokeAgents) > 0,
		SpawnAllowed: am.CanInvokeAgents,
	}, nil
}

func parseToolMarkdown(content, spaceID string, getWorkDir WorkDirFunc) (*tool.Tool, error) {
	frontmatter, body, err := splitFrontmatter(content)
	if err != nil || frontmatter == "" {
		return nil, fmt.Errorf("no frontmatter")
	}

	var tm ToolMarkdown
	if err := yaml.Unmarshal([]byte(frontmatter), &tm); err != nil {
		return nil, err
	}
	if tm.ID == "" || tm.Command == "" {
		return nil, fmt.Errorf("tool requires id and command")
	}
	tm.Body = body
	tm.SpaceID = spaceID

	if tm.Name == "" {
		tm.Name = tm.ID
	}
	if tm.Timeout <= 0 {
		tm.Timeout = 30
	}
	if tm.Workdir == "" {
		tm.Workdir = "project"
	}

	// Build tool definition
	namespacedName := fmt.Sprintf("space-%s-%s", spaceID, tm.ID)

	properties := make(map[string]any)
	var required []string
	for _, p := range tm.Parameters {
		prop := map[string]any{
			"type":        p.Type,
			"description": p.Description,
		}
		if len(p.Enum) > 0 {
			prop["enum"] = p.Enum
		}
		properties[p.Name] = prop
		if p.Required {
			required = append(required, p.Name)
		}
	}

	description := tm.Description
	if tm.Body != "" {
		description += "\n\n" + tm.Body
	}

	inputSchema := map[string]any{
		"type":       "object",
		"properties": properties,
	}
	if len(required) > 0 {
		inputSchema["required"] = required
	}

	return &tool.Tool{
		Def: provider.ToolDef{
			Name:        namespacedName,
			Description: description,
			InputSchema: inputSchema,
		},
		Executor: &spaceToolExecutor{
			tm:         &tm,
			getWorkDir: getWorkDir,
		},
		Source: "space:" + spaceID,
	}, nil
}

// spaceToolExecutor runs a space tool's shell command.
type spaceToolExecutor struct {
	tm         *ToolMarkdown
	getWorkDir WorkDirFunc
}

func (e *spaceToolExecutor) Execute(ctx context.Context, input string) (*tool.Result, error) {
	// Parse args from JSON input
	var args map[string]any
	if input != "" {
		json.Unmarshal([]byte(input), &args)
	}

	// Template substitute {{param}} with values
	cmd := e.tm.Command
	// If the entire command template is a single parameter placeholder (e.g. "{{command}}"),
	// the value IS the shell command itself — don't shell-escape it.
	isRawCommand := len(e.tm.Parameters) == 1 && strings.TrimSpace(cmd) == "{{"+e.tm.Parameters[0].Name+"}}"
	for _, p := range e.tm.Parameters {
		placeholder := "{{" + p.Name + "}}"
		if !strings.Contains(cmd, placeholder) {
			continue
		}
		val, ok := args[p.Name]
		if !ok || val == nil {
			val = ""
		}
		replacement := fmt.Sprintf("%v", val)
		if !isRawCommand {
			replacement = shellEscape(replacement)
		}
		cmd = strings.ReplaceAll(cmd, placeholder, replacement)
	}

	// Resolve workdir
	workdir := e.getWorkDir(ctx)
	switch e.tm.Workdir {
	case "home":
		if home, err := os.UserHomeDir(); err == nil {
			workdir = home
		}
	case "project":
		// already set
	default:
		if filepath.IsAbs(e.tm.Workdir) {
			workdir = e.tm.Workdir
		}
	}
	if workdir == "" {
		workdir, _ = os.UserHomeDir()
	}

	// Execute with timeout
	timeout := time.Duration(e.tm.Timeout) * time.Second
	execCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	shell, shellFlag := platformShell()
	shellCmd := exec.CommandContext(execCtx, shell, shellFlag, cmd)
	shellCmd.Dir = workdir

	output, err := shellCmd.CombinedOutput()
	if err != nil {
		if execCtx.Err() == context.DeadlineExceeded {
			return &tool.Result{
				Content: fmt.Sprintf("timed out after %ds:\n%s", e.tm.Timeout, string(output)),
				IsError: true,
			}, nil
		}
		return &tool.Result{
			Content: fmt.Sprintf("failed: %v\n%s", err, string(output)),
			IsError: true,
		}, nil
	}

	return &tool.Result{Content: string(output)}, nil
}

func shellEscape(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "'\"'\"'") + "'"
}

// platformShell returns the shell executable and flag for the current OS.
// On Windows, uses cmd.exe; on Unix, uses sh.
func platformShell() (string, string) {
	if runtime.GOOS == "windows" {
		return "cmd", "/c"
	}
	return "sh", "-c"
}

func splitFrontmatter(content string) (string, string, error) {
	trimmed := strings.TrimSpace(content)
	if !strings.HasPrefix(trimmed, "---") {
		return "", trimmed, nil
	}
	trimmed = strings.TrimPrefix(trimmed, "---")
	before, after, found := strings.Cut(trimmed, "\n---")
	if !found {
		return "", "", fmt.Errorf("unclosed frontmatter")
	}
	return strings.TrimSpace(before), strings.TrimSpace(after), nil
}
