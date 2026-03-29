package runner

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// buildSystemWithContext enriches the agent's system prompt with project context
// and instructions from agents.md/AGENTS.md/CLAUDE.md files in the project root.
func buildSystemWithContext(base string, project *ProjectContext, ctx map[string]any) string {
	if project == nil && len(ctx) == 0 {
		return base
	}

	var parts []string
	parts = append(parts, base)

	// Add project metadata
	var projectInfo []string
	if project != nil {
		if project.Name != "" {
			projectInfo = append(projectInfo, fmt.Sprintf("Project: %s", project.Name))
		}
		if project.Type != "" {
			projectInfo = append(projectInfo, fmt.Sprintf("Type: %s", project.Type))
		}
		if project.Framework != "" {
			projectInfo = append(projectInfo, fmt.Sprintf("Framework: %s", project.Framework))
		}
		if project.RootPath != "" {
			projectInfo = append(projectInfo, fmt.Sprintf("Root: %s", project.RootPath))
		}
	}
	if len(projectInfo) > 0 {
		parts = append(parts, "\n\n## Project Context\n"+strings.Join(projectInfo, "\n"))
	}

	if len(ctx) > 0 {
		var contextInfo []string
		if mode, _ := ctx["mode"].(string); mode != "" {
			contextInfo = append(contextInfo, fmt.Sprintf("Mode: %s", mode))
		}
		if component, ok := ctx["component"].(map[string]any); ok {
			if name, _ := component["name"].(string); name != "" {
				kind, _ := component["type"].(string)
				if kind != "" {
					contextInfo = append(contextInfo, fmt.Sprintf("Component: %s (%s)", name, kind))
				} else {
					contextInfo = append(contextInfo, fmt.Sprintf("Component: %s", name))
				}
			}
			if filePath, _ := component["filePath"].(string); filePath != "" {
				contextInfo = append(contextInfo, fmt.Sprintf("Component File: %s", filePath))
			}
		}
		if selection, ok := ctx["selection"].(map[string]any); ok {
			if selectionType, _ := selection["type"].(string); selectionType != "" {
				contextInfo = append(contextInfo, fmt.Sprintf("Selection: %s", selectionType))
			}
			if content, _ := selection["content"].(string); content != "" {
				contextInfo = append(contextInfo, fmt.Sprintf("Selection Content: %s", content))
			}
		}
		if len(contextInfo) > 0 {
			parts = append(parts, "\n\n## Active UI Context\n"+strings.Join(contextInfo, "\n"))
		}

		var runtimeInfo []string
		if projectName, _ := ctx["project_name"].(string); strings.TrimSpace(projectName) != "" {
			runtimeInfo = append(runtimeInfo, fmt.Sprintf("Project Name: %s", strings.TrimSpace(projectName)))
		}
		if projectPath, _ := ctx["project_path"].(string); strings.TrimSpace(projectPath) != "" {
			runtimeInfo = append(runtimeInfo, fmt.Sprintf("Project Path: %s", strings.TrimSpace(projectPath)))
		}
		if projectsRoot, _ := ctx["projects_root"].(string); strings.TrimSpace(projectsRoot) != "" {
			runtimeInfo = append(runtimeInfo, fmt.Sprintf("Projects Root: %s", strings.TrimSpace(projectsRoot)))
		}
		if projectDescription, _ := ctx["project_description"].(string); strings.TrimSpace(projectDescription) != "" {
			runtimeInfo = append(runtimeInfo, fmt.Sprintf("Project Description: %s", strings.TrimSpace(projectDescription)))
		}
		if vibeCtx, ok := ctx["vibe"].(map[string]any); ok {
			if goal, _ := vibeCtx["goal"].(string); strings.TrimSpace(goal) != "" {
				runtimeInfo = append(runtimeInfo, fmt.Sprintf("Vibe Goal: %s", strings.TrimSpace(goal)))
			}
			if source, _ := vibeCtx["source"].(string); strings.TrimSpace(source) != "" {
				runtimeInfo = append(runtimeInfo, fmt.Sprintf("Vibe Source: %s", strings.TrimSpace(source)))
			}
		}
		if vibeSession, ok := ctx["vibe_session"].(map[string]any); ok {
			if sessionID, _ := vibeSession["session_id"].(string); strings.TrimSpace(sessionID) != "" {
				runtimeInfo = append(runtimeInfo, fmt.Sprintf("Vibe Session ID: %s", strings.TrimSpace(sessionID)))
			}
			if status, _ := vibeSession["status"].(string); strings.TrimSpace(status) != "" {
				runtimeInfo = append(runtimeInfo, fmt.Sprintf("Vibe Session Status: %s", strings.TrimSpace(status)))
			}
			if currentPhase, _ := vibeSession["current_phase"].(string); strings.TrimSpace(currentPhase) != "" {
				runtimeInfo = append(runtimeInfo, fmt.Sprintf("Vibe Current Phase: %s", strings.TrimSpace(currentPhase)))
			}
		}
		if len(runtimeInfo) > 0 {
			parts = append(parts, "\n\n## Runtime Context\n"+strings.Join(runtimeInfo, "\n"))
		}
	}

	// Read project instruction files (agents.md, AGENTS.md, CLAUDE.md)
	if project != nil && project.RootPath != "" {
		for _, name := range []string{"agents.md", "AGENTS.md", "CLAUDE.md"} {
			path := filepath.Join(project.RootPath, name)
			data, err := os.ReadFile(path)
			if err != nil {
				continue
			}
			content := strings.TrimSpace(string(data))
			if content != "" {
				parts = append(parts, fmt.Sprintf("\n\n## Instructions from %s\n%s", name, content))
			}
		}
	}

	return strings.Join(parts, "")
}
