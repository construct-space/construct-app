package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"construct-operator/internal/agent"
	"construct-operator/internal/appdir"
	"construct-operator/internal/hook"
	"construct-operator/internal/plugin"
	"construct-operator/internal/skill"
	"construct-operator/internal/space"
	"construct-operator/internal/tool"
)

type toolsSpacesBootstrapResult struct {
	tools     *tool.Registry
	hooks     *hook.Registry
	skills    *skill.Registry
	plugins   *plugin.Manager
	spaceIDs  []string
	spaceDirs []string
	agents    []*agent.Config
}

func bootstrapToolsSpaces(rt *operatorRuntime) toolsSpacesBootstrapResult {
	tools := tool.NewRegistry()
	tool.RegisterBuiltins(tools, rt.projectDir)
	tool.RegisterBridgeTools(tools, rt.bridge)
	tool.RegisterSpaceCLITools(tools, rt.projectDir)

	tools.Register(tool.Func("get_project_context",
		"Get information about the currently active project, including name, type, root path, framework, and available tools.",
		map[string]any{"type": "object", "properties": map[string]any{}},
		func(ctx context.Context, input string) (*tool.Result, error) {
			proj := rt.projectContext(ctx)
			clientCtx := rt.clientContext(ctx)
			if proj == nil {
				home, _ := os.UserHomeDir()
				projectsRoot := os.Getenv("CONSTRUCT_PROJECTS_ROOT")
				if projectsRoot == "" {
					projectsRoot = filepath.Join(home, "ConstructProjects")
				}
				content := "No project is currently active.\nProjects root: " + projectsRoot
				if clientCtx != nil && clientCtx.Mode != "" {
					content += "\nCurrent mode: " + clientCtx.Mode
				}
				content += "\nNew projects should be created under the projects root."
				return &tool.Result{Content: content}, nil
			}
			allTools := tools.All()
			toolNames := make([]string, len(allTools))
			for i, t := range allTools {
				toolNames[i] = t.Def.Name
			}
			result := fmt.Sprintf("Active Project:\n  Name: %s\n  Type: %s\n  Root: %s\n  Framework: %s",
				proj.Name, proj.Type, proj.RootPath, proj.Framework)
			if clientCtx != nil {
				if clientCtx.Mode != "" {
					result += "\n  Mode: " + clientCtx.Mode
				}
				if len(clientCtx.Component) > 0 {
					componentName := mapString(clientCtx.Component, "name")
					componentType := mapString(clientCtx.Component, "type")
					if componentName != "" {
						if componentType != "" {
							result += fmt.Sprintf("\n  Component: %s (%s)", componentName, componentType)
						} else {
							result += "\n  Component: " + componentName
						}
					}
				}
				if len(clientCtx.Selection) > 0 {
					if selectionType := mapString(clientCtx.Selection, "type"); selectionType != "" {
						result += "\n  Selection: " + selectionType
					}
				}
			}
			result += "\n\nAvailable tools: " + strings.Join(toolNames, ", ")
			return &tool.Result{Content: result}, nil
		},
	))

	allAgents := coreAgents()
	fmt.Fprintf(os.Stderr, "[operator] loaded %d core agents: architect, vibe, project\n", len(allAgents))

	hookReg := hook.NewRegistry()
	hook.RegisterSafetyHooks(hookReg, rt.projectDir)

	skillReg := skill.NewRegistry()
	pluginMgr := plugin.NewManager()

	spaceDirs := appdir.AllSpacesDirs()
	var spaceIDs []string
	for _, dir := range spaceDirs {
		fmt.Fprintf(os.Stderr, "[operator] loading spaces from: %s\n", dir)
		spaceResults, err := space.LoadAll(dir, rt.projectDir)
		if err != nil {
			fmt.Fprintf(os.Stderr, "[operator] warning: %s: %v\n", dir, err)
			continue
		}
		for _, sr := range spaceResults {
			for _, t := range sr.Tools {
				if rt.bridge == nil && isDesktopOnlySpaceTool(t.Def.Name) {
					continue
				}
				tools.Register(t)
			}
			for _, h := range sr.Hooks {
				hookReg.Register(h)
			}
			for _, s := range sr.Skills {
				skillReg.Register(s)
			}
			for _, p := range sr.Plugins {
				if err := pluginMgr.RegisterPlugin(p, tools, hookReg); err != nil {
					fmt.Fprintf(os.Stderr, "[operator] warning: %s plugin %s: %v\n", sr.SpaceID, p.ID, err)
				}
			}
			spaceIDs = append(spaceIDs, sr.SpaceID)
			if sr.Agent != nil {
				allAgents = append(allAgents, sr.Agent)
				fmt.Fprintf(os.Stderr, "[operator] space: %s (agent: %s, tools: %d, hooks: %d, skills: %d, plugins: %d)\n",
					sr.SpaceID, sr.Agent.ID, len(sr.Tools), len(sr.Hooks), len(sr.Skills), len(sr.Plugins))
			}
		}
	}

	if rt.bridge != nil && len(spaceIDs) > 0 {
		go func() {
			time.Sleep(3 * time.Second)
			tool.RegisterSpaceActionTools(tools, rt.bridge, spaceIDs)
		}()
	}

	if hooks, err := hook.LoadConfig(filepath.Join(appdir.Dir, "hooks.json")); err == nil {
		for _, h := range hooks {
			hookReg.Register(h)
		}
	}

	if userSkills, err := skill.LoadFromDir(appdir.SkillsDir(), "user"); err == nil {
		for _, s := range userSkills {
			skillReg.Register(s)
		}
	}

	skill.RegisterBuiltins(skillReg)
	for _, builtinID := range skill.BuiltinIDs() {
		if saved, ok := rt.stateStore.SkillStates()[builtinID]; ok {
			_ = skillReg.SetState(builtinID, skill.State{
				Loaded:    saved.Loaded,
				Enabled:   saved.Enabled,
				LoadedAt:  saved.LoadedAt,
				UpdatedAt: saved.UpdatedAt,
			})
			continue
		}
		skillReg.Unload(builtinID)
	}
	for id, saved := range rt.stateStore.SkillStates() {
		_ = skillReg.SetState(id, skill.State{
			Loaded:    saved.Loaded,
			Enabled:   saved.Enabled,
			LoadedAt:  saved.LoadedAt,
			UpdatedAt: saved.UpdatedAt,
		})
	}
	for id, saved := range rt.stateStore.HookStates() {
		hookReg.SetEnabled(id, saved.Enabled)
	}
	fmt.Fprintf(os.Stderr, "[operator] hooks: %d registered, skills: %d, plugins: %d\n",
		len(hookReg.List()), len(skillReg.All()), len(pluginMgr.List()))

	return toolsSpacesBootstrapResult{
		tools:     tools,
		hooks:     hookReg,
		skills:    skillReg,
		plugins:   pluginMgr,
		spaceIDs:  spaceIDs,
		spaceDirs: spaceDirs,
		agents:    allAgents,
	}
}
