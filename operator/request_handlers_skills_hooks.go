package main

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"construct-operator/internal/hook"
	"construct-operator/internal/skill"
	"construct-operator/internal/state"
	"construct-operator/internal/tool"
	"construct-operator/internal/transport"
)

func (rt *operatorRuntime) handleSkillsHooksRequest(req transport.Request) (transport.Response, bool) {
	skillReg := rt.skills
	hookReg := rt.hooks
	tools := rt.tools

	switch {
	case req.Type == "skills.list":
		hooksList := hookReg.List()
		skillsList := make([]map[string]any, 0, len(skillReg.All()))
		for _, s := range skillReg.All() {
			skillState, _ := skillReg.State(s.ID)
			item := map[string]any{
				"id":           s.ID,
				"name":         s.Name,
				"category":     s.Category,
				"description":  s.Description,
				"version":      "1.0.0",
				"state":        skillStateLabel(skillState),
				"dependencies": []string{},
				"hooksCount":   hookCountForSkill(hooksList, s.ID),
				"toolsCount":   len(s.Tools),
			}
			if skillState.LoadedAt != "" {
				item["loadedAt"] = skillState.LoadedAt
			}
			skillsList = append(skillsList, item)
		}
		return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"skills": skillsList}}, true

	case req.Type == "skills.get":
		var payload struct {
			ID string `json:"id"`
		}
		if req.Payload != nil {
			json.Unmarshal(req.Payload, &payload)
		}
		s, ok := skillReg.Get(payload.ID)
		if !ok {
			return transport.Response{ID: req.ID, Success: false, Error: "skill not found"}, true
		}
		skillState, _ := skillReg.State(s.ID)
		return transport.Response{ID: req.ID, Success: true, Data: map[string]any{
			"skill": map[string]any{
				"id":           s.ID,
				"name":         s.Name,
				"category":     s.Category,
				"description":  s.Description,
				"version":      "1.0.0",
				"state":        skillStateLabel(skillState),
				"dependencies": []string{},
				"hooksCount":   0,
				"toolsCount":   len(s.Tools),
				"loadedAt":     skillState.LoadedAt,
			},
		}}, true

	case req.Type == "skills.load":
		return rt.handleSkillStateMutation(req.ID, func() bool {
			var payload struct {
				ID string `json:"id"`
			}
			if req.Payload != nil {
				json.Unmarshal(req.Payload, &payload)
			}
			if !skillReg.Load(payload.ID) {
				return false
			}
			return rt.persistSkillState(payload.ID) == nil
		}, "skill not found"), true

	case req.Type == "skills.unload":
		return rt.handleSkillStateMutation(req.ID, func() bool {
			var payload struct {
				ID string `json:"id"`
			}
			if req.Payload != nil {
				json.Unmarshal(req.Payload, &payload)
			}
			if !skillReg.Unload(payload.ID) {
				return false
			}
			return rt.persistSkillState(payload.ID) == nil
		}, "skill not found"), true

	case req.Type == "skills.enable":
		return rt.handleSkillStateMutation(req.ID, func() bool {
			var payload struct {
				ID string `json:"id"`
			}
			if req.Payload != nil {
				json.Unmarshal(req.Payload, &payload)
			}
			if !skillReg.Enable(payload.ID) {
				return false
			}
			return rt.persistSkillState(payload.ID) == nil
		}, "skill not found"), true

	case req.Type == "skills.disable":
		return rt.handleSkillStateMutation(req.ID, func() bool {
			var payload struct {
				ID string `json:"id"`
			}
			if req.Payload != nil {
				json.Unmarshal(req.Payload, &payload)
			}
			if !skillReg.Disable(payload.ID) {
				return false
			}
			return rt.persistSkillState(payload.ID) == nil
		}, "skill not found"), true

	case req.Type == "skills.load_builtins":
		for _, builtinID := range skill.BuiltinIDs() {
			skillReg.Enable(builtinID)
			if err := rt.persistSkillState(builtinID); err != nil {
				return transport.Response{ID: req.ID, Success: false, Error: err.Error()}, true
			}
		}
		return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"ok": true}}, true

	case req.Type == "skills.metrics":
		metrics := skillReg.Metrics()
		items := make([]map[string]any, 0, len(skillReg.All()))
		for _, s := range skillReg.All() {
			metric := metrics[s.ID]
			items = append(items, map[string]any{
				"skillId":       s.ID,
				"hooksExecuted": 0,
				"toolsExecuted": 0,
				"errorCount":    0,
				"totalDuration": 0,
				"lastUsed":      metric.LastUsed,
			})
		}
		return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"metrics": items}}, true

	case req.Type == "skills.summaries":
		summaries := make([]map[string]any, 0, len(skillReg.All()))
		for _, s := range skillReg.All() {
			skillState, _ := skillReg.State(s.ID)
			summaries = append(summaries, map[string]any{
				"id":          s.ID,
				"name":        s.Name,
				"category":    s.Category,
				"description": s.Description,
				"keywords":    skillKeywords(s),
				"toolNames":   s.Tools,
				"hookTypes":   []string{},
				"isLoaded":    skillState.Loaded,
			})
		}
		return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"summaries": summaries}}, true

	case req.Type == "skills.content":
		var payload struct {
			SkillID string `json:"skillId"`
		}
		if req.Payload != nil {
			json.Unmarshal(req.Payload, &payload)
		}
		s, ok := skillReg.Get(payload.SkillID)
		if !ok {
			return transport.Response{ID: req.ID, Success: false, Error: "skill not found"}, true
		}
		return transport.Response{ID: req.ID, Success: true, Data: map[string]any{
			"content": map[string]any{
				"id":           s.ID,
				"instructions": s.Prompt,
				"tools":        buildSkillToolDefinitions(tools, s.Tools),
				"hooks":        []map[string]any{},
				"settings":     map[string]any{},
				"examples":     []map[string]any{},
			},
		}}, true

	case req.Type == "skills.search":
		var payload struct {
			Query      string   `json:"query"`
			Categories []string `json:"categories"`
			Keywords   []string `json:"keywords"`
			HasTools   bool     `json:"hasTools"`
			HasHooks   bool     `json:"hasHooks"`
			Limit      int      `json:"limit"`
		}
		if req.Payload != nil {
			json.Unmarshal(req.Payload, &payload)
		}
		matches := searchSkills(skillReg, hookReg.List(), payload)
		totalCount := len(matches)
		if payload.Limit > 0 && len(matches) > payload.Limit {
			matches = matches[:payload.Limit]
		}
		return transport.Response{ID: req.ID, Success: true, Data: map[string]any{
			"matches":    matches,
			"totalCount": totalCount,
			"query":      payload.Query,
		}}, true

	case req.Type == "skills.instructions":
		var payload struct {
			SkillID string `json:"skillId"`
		}
		if req.Payload != nil {
			json.Unmarshal(req.Payload, &payload)
		}
		if payload.SkillID != "" {
			s, ok := skillReg.Get(payload.SkillID)
			if !ok {
				return transport.Response{ID: req.ID, Success: false, Error: "skill not found"}, true
			}
			return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"instructions": s.Prompt}}, true
		}
		parts := []string{}
		for _, s := range skillReg.All() {
			skillState, _ := skillReg.State(s.ID)
			if !skillState.Loaded || !skillState.Enabled {
				continue
			}
			parts = append(parts, fmt.Sprintf("## %s\n%s", s.Name, s.Prompt))
		}
		return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"instructions": strings.Join(parts, "\n\n")}}, true

	case req.Type == "skills.format_for_ai":
		var payload struct {
			SkillID string `json:"skillId"`
		}
		if req.Payload != nil {
			json.Unmarshal(req.Payload, &payload)
		}
		s, ok := skillReg.Get(payload.SkillID)
		if !ok {
			return transport.Response{ID: req.ID, Success: false, Error: "skill not found"}, true
		}
		formatted := fmt.Sprintf("# Skill: %s\n\nDescription: %s\n\nCategory: %s\n\nTools: %s\n\nInstructions:\n%s",
			s.Name, s.Description, s.Category, strings.Join(s.Tools, ", "), s.Prompt)
		return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"formatted": formatted}}, true

	case req.Type == "hooks.list":
		items := make([]map[string]any, 0, len(hookReg.List()))
		for _, h := range hookReg.List() {
			items = append(items, map[string]any{
				"id":          h.ID,
				"name":        h.Name,
				"type":        hookTypeLabel(h.Type),
				"priority":    h.Priority,
				"skillId":     h.SkillID,
				"enabled":     hookReg.IsEnabled(h.ID),
				"description": h.Description,
			})
		}
		return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"hooks": items}}, true

	case req.Type == "hooks.by_type":
		var payload struct {
			Type string `json:"type"`
		}
		if req.Payload != nil {
			json.Unmarshal(req.Payload, &payload)
		}
		items := make([]map[string]any, 0)
		for _, h := range hookReg.List() {
			label := hookTypeLabel(h.Type)
			if payload.Type != "" && !strings.HasPrefix(label, payload.Type) {
				continue
			}
			items = append(items, map[string]any{
				"id":          h.ID,
				"name":        h.Name,
				"type":        label,
				"priority":    h.Priority,
				"skillId":     h.SkillID,
				"enabled":     hookReg.IsEnabled(h.ID),
				"description": h.Description,
			})
		}
		return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"hooks": items}}, true

	case req.Type == "hooks.enable":
		return rt.handleHookStateMutation(req.ID, func() bool {
			var payload struct {
				ID string `json:"id"`
			}
			if req.Payload != nil {
				json.Unmarshal(req.Payload, &payload)
			}
			if !hookReg.SetEnabled(payload.ID, true) {
				return false
			}
			return rt.stateStore.SetHookState(state.HookRuntimeState{ID: payload.ID, Enabled: true}) == nil
		}, "hook not found"), true

	case req.Type == "hooks.disable":
		return rt.handleHookStateMutation(req.ID, func() bool {
			var payload struct {
				ID string `json:"id"`
			}
			if req.Payload != nil {
				json.Unmarshal(req.Payload, &payload)
			}
			if !hookReg.SetEnabled(payload.ID, false) {
				return false
			}
			return rt.stateStore.SetHookState(state.HookRuntimeState{ID: payload.ID, Enabled: false}) == nil
		}, "hook not found"), true

	case req.Type == "hooks.metrics":
		metrics := hookReg.Metrics()
		items := make([]map[string]any, 0, len(hookReg.List()))
		for _, h := range hookReg.List() {
			metric := metrics[h.ID]
			items = append(items, map[string]any{
				"hookId":         h.ID,
				"executionCount": metric.ExecutionCount,
				"errorCount":     metric.ErrorCount,
				"avgDuration":    metric.AvgDuration,
				"lastExecuted":   metric.LastExecuted,
			})
		}
		return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"metrics": items}}, true

	default:
		return transport.Response{}, false
	}
}

func (rt *operatorRuntime) persistSkillState(id string) error {
	skillState, ok := rt.skills.State(id)
	if !ok {
		return fmt.Errorf("skill not found")
	}
	return rt.stateStore.SetSkillState(state.SkillRuntimeState{
		ID:        id,
		Loaded:    skillState.Loaded,
		Enabled:   skillState.Enabled,
		LoadedAt:  skillState.LoadedAt,
		UpdatedAt: skillState.UpdatedAt,
	})
}

func (rt *operatorRuntime) handleSkillStateMutation(requestID string, mutate func() bool, missingErr string) transport.Response {
	if !mutate() {
		return transport.Response{ID: requestID, Success: false, Error: missingErr}
	}
	return transport.Response{ID: requestID, Success: true, Data: map[string]any{"ok": true}}
}

func (rt *operatorRuntime) handleHookStateMutation(requestID string, mutate func() bool, missingErr string) transport.Response {
	if !mutate() {
		return transport.Response{ID: requestID, Success: false, Error: missingErr}
	}
	return transport.Response{ID: requestID, Success: true, Data: map[string]any{"ok": true}}
}

func skillStateLabel(state skill.State) string {
	switch {
	case !state.Loaded:
		return "unloaded"
	case !state.Enabled:
		return "disabled"
	default:
		return "active"
	}
}

func hookCountForSkill(hooks []hook.Hook, skillID string) int {
	count := 0
	for _, h := range hooks {
		if h.SkillID == skillID {
			count++
		}
	}
	return count
}

func hookTypeLabel(hookType hook.Type) string {
	switch hookType {
	case hook.PreTool:
		return "tool.pre"
	case hook.PostTool:
		return "tool.post"
	default:
		return string(hookType)
	}
}

func skillKeywords(s *skill.Skill) []string {
	set := map[string]bool{}
	add := func(values ...string) {
		for _, value := range values {
			value = strings.TrimSpace(strings.ToLower(value))
			if value == "" {
				continue
			}
			set[value] = true
		}
	}

	add(s.Category, s.ID, s.Name)
	for _, part := range strings.Split(s.Trigger, ",") {
		add(part)
	}

	keywords := make([]string, 0, len(set))
	for keyword := range set {
		keywords = append(keywords, keyword)
	}
	return keywords
}

func buildSkillToolDefinitions(registry *tool.Registry, toolNames []string) []map[string]any {
	toolDefs := make([]map[string]any, 0, len(toolNames))
	for _, toolName := range toolNames {
		toolDef, ok := registry.Get(toolName)
		if !ok {
			continue
		}
		parameters := make([]map[string]any, 0)
		if schema, ok := toolDef.Def.InputSchema.(map[string]any); ok {
			properties, _ := schema["properties"].(map[string]any)
			required := make(map[string]bool)
			switch raw := schema["required"].(type) {
			case []any:
				for _, item := range raw {
					if name, ok := item.(string); ok {
						required[name] = true
					}
				}
			case []string:
				for _, name := range raw {
					required[name] = true
				}
			}
			for name, raw := range properties {
				prop, _ := raw.(map[string]any)
				param := map[string]any{
					"name":        name,
					"type":        prop["type"],
					"description": prop["description"],
					"required":    required[name],
				}
				if enumValues, ok := prop["enum"]; ok {
					param["enum"] = enumValues
				}
				parameters = append(parameters, param)
			}
		}
		toolDefs = append(toolDefs, map[string]any{
			"name":        toolDef.Def.Name,
			"description": toolDef.Def.Description,
			"parameters":  parameters,
			"action":      toolDef.Source,
			"config":      map[string]any{},
		})
	}
	return toolDefs
}

func searchSkills(skillReg *skill.Registry, hooksList []hook.Hook, payload struct {
	Query      string   `json:"query"`
	Categories []string `json:"categories"`
	Keywords   []string `json:"keywords"`
	HasTools   bool     `json:"hasTools"`
	HasHooks   bool     `json:"hasHooks"`
	Limit      int      `json:"limit"`
}) []map[string]any {
	query := strings.ToLower(strings.TrimSpace(payload.Query))
	categorySet := map[string]bool{}
	for _, category := range payload.Categories {
		categorySet[strings.ToLower(category)] = true
	}

	matches := make([]map[string]any, 0)
	for _, s := range skillReg.All() {
		if len(categorySet) > 0 && !categorySet[strings.ToLower(s.Category)] {
			continue
		}
		if payload.HasTools && len(s.Tools) == 0 {
			continue
		}
		hookCount := hookCountForSkill(hooksList, s.ID)
		if payload.HasHooks && hookCount == 0 {
			continue
		}

		keywords := skillKeywords(s)
		score := 0.0
		matchedOn := []string{}
		if query != "" {
			if strings.Contains(strings.ToLower(s.Name), query) {
				score += 3
				matchedOn = append(matchedOn, "name")
			}
			if strings.Contains(strings.ToLower(s.Description), query) {
				score += 2
				matchedOn = append(matchedOn, "description")
			}
			if strings.Contains(strings.ToLower(s.Prompt), query) {
				score += 1
				matchedOn = append(matchedOn, "instructions")
			}
			for _, keyword := range keywords {
				if strings.Contains(keyword, query) {
					score += 1
					matchedOn = append(matchedOn, "keywords")
					break
				}
			}
		}
		if len(payload.Keywords) > 0 {
			for _, keyword := range payload.Keywords {
				for _, existing := range keywords {
					if existing == strings.ToLower(keyword) {
						score += 1
						matchedOn = append(matchedOn, "keywords")
						break
					}
				}
			}
		}
		if score == 0 && query != "" {
			continue
		}

		skillState, _ := skillReg.State(s.ID)
		matches = append(matches, map[string]any{
			"skill": map[string]any{
				"id":          s.ID,
				"name":        s.Name,
				"category":    s.Category,
				"description": s.Description,
				"keywords":    keywords,
				"toolNames":   s.Tools,
				"hookTypes":   []string{},
				"isLoaded":    skillState.Loaded,
			},
			"score":     score,
			"matchedOn": matchedOn,
			"reason":    "Matched against skill metadata and instructions",
		})
	}

	sort.Slice(matches, func(i, j int) bool {
		left, _ := matches[i]["score"].(float64)
		right, _ := matches[j]["score"].(float64)
		return left > right
	})
	return matches
}
