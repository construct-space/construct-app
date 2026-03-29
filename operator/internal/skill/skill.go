// Package skill implements the skill system.
// Skills are reusable prompt+tool bundles that agents can invoke.
// Operator skills are dynamic: they can be loaded from spaces, MCP, or inline.
//
// Think of skills like Claude Code's /commit, /review-pr — they expand into
// a full prompt with context and specific tool access.
package skill

import (
	"context"
	"fmt"
	"regexp"
	"strings"
	"time"
)

// Skill is an invocable capability.
type Skill struct {
	ID          string   `json:"id" yaml:"id"`
	Name        string   `json:"name" yaml:"name"`
	Description string   `json:"description" yaml:"description"`
	Trigger     string   `json:"trigger,omitempty" yaml:"trigger"`   // Regex or keyword trigger
	Prompt      string   `json:"prompt" yaml:"-"`                    // The prompt template (markdown body)
	Tools       []string `json:"tools,omitempty" yaml:"tools"`       // Additional tools this skill needs
	Agents      []string `json:"agents,omitempty" yaml:"agents"`     // Optional agent IDs this skill applies to
	Source      string   `json:"source" yaml:"-"`                    // "builtin", "space:<id>", "user"
	Category    string   `json:"category,omitempty" yaml:"category"` // For grouping
}

type State struct {
	Loaded    bool   `json:"loaded"`
	Enabled   bool   `json:"enabled"`
	LoadedAt  string `json:"loadedAt,omitempty"`
	UpdatedAt string `json:"updatedAt"`
}

type Metrics struct {
	LastUsed string `json:"lastUsed,omitempty"`
}

// Expand renders a skill's prompt template with the given context variables.
// Supports {{variable}} expansion.
func (s *Skill) Expand(ctx context.Context, vars map[string]any) string {
	result := s.Prompt
	for k, v := range vars {
		placeholder := "{{" + k + "}}"
		result = strings.ReplaceAll(result, placeholder, fmt.Sprintf("%v", v))
	}

	// Also support nested keys like {{project.name}}
	for k, v := range vars {
		if m, ok := v.(map[string]any); ok {
			for subK, subV := range m {
				placeholder := "{{" + k + "." + subK + "}}"
				result = strings.ReplaceAll(result, placeholder, fmt.Sprintf("%v", subV))
			}
		}
	}

	return result
}

func matchesTrigger(trigger, input string) bool {
	lower := strings.ToLower(input)

	// If trigger contains commas, treat as keyword list
	if strings.Contains(trigger, ",") {
		keywords := strings.Split(strings.ToLower(trigger), ",")
		for _, kw := range keywords {
			kw = strings.TrimSpace(kw)
			if kw != "" && strings.Contains(lower, kw) {
				return true
			}
		}
		return false
	}

	// Try as regex
	if re, err := regexp.Compile("(?i)" + trigger); err == nil {
		return re.MatchString(lower)
	}

	// Single keyword
	return strings.Contains(lower, strings.ToLower(trigger))
}

func matchesExplicitSkillReference(s *Skill, input string) bool {
	refs := extractSkillReferences(input)
	if len(refs) == 0 {
		return false
	}

	id := normalizeSkillReference(s.ID)
	name := normalizeSkillReference(s.Name)
	for _, ref := range refs {
		if ref == id || (name != "" && ref == name) {
			return true
		}
	}
	return false
}

func extractSkillReferences(input string) []string {
	matches := regexp.MustCompile(`(?i)\bskill:([a-z0-9][a-z0-9_-]*)\b`).FindAllStringSubmatch(input, -1)
	if len(matches) == 0 {
		return nil
	}

	refs := make([]string, 0, len(matches))
	for _, match := range matches {
		if len(match) < 2 {
			continue
		}
		ref := normalizeSkillReference(match[1])
		if ref != "" {
			refs = append(refs, ref)
		}
	}
	return refs
}

func normalizeSkillReference(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	value = strings.ReplaceAll(value, "_", "-")
	value = strings.Join(strings.Fields(value), "-")
	return value
}

func matchesAgent(agents []string, agentID string) bool {
	if len(agents) == 0 {
		return true
	}
	normalizedID := normalizeAgentID(agentID)
	if normalizedID == "" {
		return false
	}
	for _, candidate := range agents {
		if normalizeAgentID(candidate) == normalizedID {
			return true
		}
	}
	return false
}

func normalizeAgentID(agentID string) string {
	normalized := strings.ToLower(strings.TrimSpace(agentID))
	normalized = strings.TrimPrefix(normalized, "space:")
	return normalized
}

func nowUTC() string {
	return time.Now().UTC().Format(time.RFC3339)
}

// --- Built-in Skills ---

var builtinSkillIDs = []string{"architect-superpower", "commit", "review", "explain", "test"}
var defaultEnabledBuiltinSkillIDs = map[string]bool{"architect-superpower": true}

func BuiltinIDs() []string {
	ids := make([]string, len(builtinSkillIDs))
	copy(ids, builtinSkillIDs)
	return ids
}

func BuiltinEnabledByDefault(id string) bool {
	return defaultEnabledBuiltinSkillIDs[id]
}

// RegisterBuiltins adds built-in skills to the registry.
func RegisterBuiltins(reg *Registry) {
	reg.Register(&Skill{
		ID:          "architect-superpower",
		Name:        "Architect Superpower",
		Description: "Deepen architecture planning, refactor strategy, and migration design for the Architect and Brainstorm agents",
		Trigger:     ".*",
		Category:    "architect",
		Agents:      []string{"architect", "brainstorm"},
		Prompt: `Apply this architecture lens while following the Architect workflow.

Before planning or writing docs:
- Identify the current system boundaries, entry points, storage, side effects, and external dependencies
- Name the invariants that must not break during the change
- Call out the riskiest migrations, compatibility edges, concurrency concerns, and rollback paths
- Prefer the smallest architecture that satisfies the current requirement; avoid speculative abstractions

When producing the plan:
- Break work along real seams in the codebase: packages, modules, routes, data models, background jobs, and integrations
- Separate mechanical moves from behavioral changes when possible
- Make changed files explicit, including verification paths for each task
- Note what can ship incrementally behind compatibility layers, flags, or adapters

When writing docs:
- Include concrete before/after architecture, data flow, failure modes, testing strategy, and observability implications
- Record assumptions, open questions, and decisions future implementers should not rediscover

Stay in planning mode. Do not write implementation code.`,
		Source: "builtin",
	})

	reg.Register(&Skill{
		ID:          "commit",
		Name:        "Commit",
		Description: "Create a git commit with a well-crafted message",
		Trigger:     "commit,/commit",
		Category:    "git",
		Prompt: `Analyze the staged changes (git diff --cached) and create a commit.

Steps:
1. Run git status and git diff --cached to see what's staged
2. Write a concise commit message following conventional commits format
3. Run git commit -m "the message"

If nothing is staged, stage all modified files first (but warn about untracked files).`,
		Source: "builtin",
	})

	reg.Register(&Skill{
		ID:          "review",
		Name:        "Code Review",
		Description: "Review code changes for bugs, style issues, and improvements",
		Trigger:     "review,/review",
		Category:    "code",
		Prompt: `Review the current changes (git diff) or the specified file(s).

Look for:
- Bugs and logic errors
- Security vulnerabilities
- Performance issues
- Code style and readability
- Missing error handling
- Test coverage gaps

Format your review as actionable comments with file paths and line numbers.`,
		Source: "builtin",
	})

	reg.Register(&Skill{
		ID:          "explain",
		Name:        "Explain Code",
		Description: "Explain how code works at the right level of detail",
		Trigger:     "explain,/explain",
		Category:    "code",
		Prompt: `Read and explain the specified code. Adapt your explanation depth to the complexity:

- For simple code: brief one-liner explanation
- For complex code: break down the architecture, data flow, and key decisions
- Always mention non-obvious things: edge cases handled, performance tradeoffs, why something was done a certain way`,
		Source: "builtin",
	})

	reg.Register(&Skill{
		ID:          "test",
		Name:        "Write Tests",
		Description: "Generate tests for existing code",
		Trigger:     "test,/test,write tests",
		Category:    "code",
		Prompt: `Write tests for the specified code or recent changes.

Guidelines:
- Match the existing test framework and style
- Cover happy paths, edge cases, and error cases
- Use descriptive test names
- Keep tests focused and independent
- Mock external dependencies, not internal code`,
		Source: "builtin",
	})
}
