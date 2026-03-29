package skill

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"construct-operator/internal/appdir"
	"construct-operator/internal/hook"
	"construct-operator/internal/state"
	"construct-operator/internal/tool"
	"construct-operator/internal/transport"
)

func (m *SkillModule) handleList(_ context.Context, req transport.Request) transport.Response {
	hooksList := m.hooks.List()
	skillsList := make([]map[string]any, 0, len(m.registry.All()))
	for _, s := range m.registry.All() {
		skillState, _ := m.registry.State(s.ID)
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
	return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"skills": skillsList}}
}

func (m *SkillModule) handleGet(_ context.Context, req transport.Request) transport.Response {
	var payload struct {
		ID string `json:"id"`
	}
	if req.Payload != nil {
		json.Unmarshal(req.Payload, &payload)
	}
	s, ok := m.registry.Get(payload.ID)
	if !ok {
		return transport.Response{ID: req.ID, Success: false, Error: "skill not found"}
	}
	skillState, _ := m.registry.State(s.ID)
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
	}}
}

func (m *SkillModule) handleLoad(_ context.Context, req transport.Request) transport.Response {
	return m.handleSkillStateMutation(req.ID, func() bool {
		var payload struct {
			ID string `json:"id"`
		}
		if req.Payload != nil {
			json.Unmarshal(req.Payload, &payload)
		}
		if !m.registry.Load(payload.ID) {
			return false
		}
		return m.persistSkillState(payload.ID) == nil
	}, "skill not found")
}

func (m *SkillModule) handleUnload(_ context.Context, req transport.Request) transport.Response {
	return m.handleSkillStateMutation(req.ID, func() bool {
		var payload struct {
			ID string `json:"id"`
		}
		if req.Payload != nil {
			json.Unmarshal(req.Payload, &payload)
		}
		if !m.registry.Unload(payload.ID) {
			return false
		}
		return m.persistSkillState(payload.ID) == nil
	}, "skill not found")
}

func (m *SkillModule) handleEnable(_ context.Context, req transport.Request) transport.Response {
	return m.handleSkillStateMutation(req.ID, func() bool {
		var payload struct {
			ID string `json:"id"`
		}
		if req.Payload != nil {
			json.Unmarshal(req.Payload, &payload)
		}
		if !m.registry.Enable(payload.ID) {
			return false
		}
		return m.persistSkillState(payload.ID) == nil
	}, "skill not found")
}

func (m *SkillModule) handleDisable(_ context.Context, req transport.Request) transport.Response {
	return m.handleSkillStateMutation(req.ID, func() bool {
		var payload struct {
			ID string `json:"id"`
		}
		if req.Payload != nil {
			json.Unmarshal(req.Payload, &payload)
		}
		if !m.registry.Disable(payload.ID) {
			return false
		}
		return m.persistSkillState(payload.ID) == nil
	}, "skill not found")
}

func (m *SkillModule) handleLoadBuiltins(_ context.Context, req transport.Request) transport.Response {
	for _, builtinID := range BuiltinIDs() {
		m.registry.Enable(builtinID)
		if err := m.persistSkillState(builtinID); err != nil {
			return transport.Response{ID: req.ID, Success: false, Error: err.Error()}
		}
	}
	return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"ok": true}}
}

func (m *SkillModule) handleMetrics(_ context.Context, req transport.Request) transport.Response {
	metrics := m.registry.Metrics()
	items := make([]map[string]any, 0, len(m.registry.All()))
	for _, s := range m.registry.All() {
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
	return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"metrics": items}}
}

func (m *SkillModule) handleSummaries(_ context.Context, req transport.Request) transport.Response {
	summaries := make([]map[string]any, 0, len(m.registry.All()))
	for _, s := range m.registry.All() {
		skillState, _ := m.registry.State(s.ID)
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
	return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"summaries": summaries}}
}

func (m *SkillModule) handleContent(_ context.Context, req transport.Request) transport.Response {
	var payload struct {
		SkillID string `json:"skillId"`
	}
	if req.Payload != nil {
		json.Unmarshal(req.Payload, &payload)
	}
	s, ok := m.registry.Get(payload.SkillID)
	if !ok {
		return transport.Response{ID: req.ID, Success: false, Error: "skill not found"}
	}
	return transport.Response{ID: req.ID, Success: true, Data: map[string]any{
		"content": map[string]any{
			"id":           s.ID,
			"instructions": s.Prompt,
			"tools":        buildSkillToolDefinitions(m.tools, s.Tools),
			"hooks":        []map[string]any{},
			"settings":     map[string]any{},
			"examples":     []map[string]any{},
		},
	}}
}

func (m *SkillModule) handleSearch(_ context.Context, req transport.Request) transport.Response {
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
	matches := searchSkills(m.registry, m.hooks.List(), payload)
	totalCount := len(matches)
	if payload.Limit > 0 && len(matches) > payload.Limit {
		matches = matches[:payload.Limit]
	}
	return transport.Response{ID: req.ID, Success: true, Data: map[string]any{
		"matches":    matches,
		"totalCount": totalCount,
		"query":      payload.Query,
	}}
}

func (m *SkillModule) handleInstructions(_ context.Context, req transport.Request) transport.Response {
	var payload struct {
		SkillID string `json:"skillId"`
	}
	if req.Payload != nil {
		json.Unmarshal(req.Payload, &payload)
	}
	if payload.SkillID != "" {
		s, ok := m.registry.Get(payload.SkillID)
		if !ok {
			return transport.Response{ID: req.ID, Success: false, Error: "skill not found"}
		}
		return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"instructions": s.Prompt}}
	}
	parts := []string{}
	for _, s := range m.registry.All() {
		skillState, _ := m.registry.State(s.ID)
		if !skillState.Loaded || !skillState.Enabled {
			continue
		}
		parts = append(parts, fmt.Sprintf("## %s\n%s", s.Name, s.Prompt))
	}
	return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"instructions": strings.Join(parts, "\n\n")}}
}

func (m *SkillModule) handleFormatForAI(_ context.Context, req transport.Request) transport.Response {
	var payload struct {
		SkillID string `json:"skillId"`
	}
	if req.Payload != nil {
		json.Unmarshal(req.Payload, &payload)
	}
	s, ok := m.registry.Get(payload.SkillID)
	if !ok {
		return transport.Response{ID: req.ID, Success: false, Error: "skill not found"}
	}
	formatted := fmt.Sprintf("# Skill: %s\n\nDescription: %s\n\nCategory: %s\n\nTools: %s\n\nInstructions:\n%s",
		s.Name, s.Description, s.Category, strings.Join(s.Tools, ", "), s.Prompt)
	return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"formatted": formatted}}
}

func (m *SkillModule) handleSave(_ context.Context, req transport.Request) transport.Response {
	var payload struct {
		Filename string `json:"filename"`
		Content  string `json:"content"`
	}
	if req.Payload != nil {
		json.Unmarshal(req.Payload, &payload)
	}
	if payload.Filename == "" || payload.Content == "" {
		return transport.Response{ID: req.ID, Success: false, Error: "filename and content are required"}
	}

	// Sanitize filename
	filename := strings.TrimSpace(payload.Filename)
	if !strings.HasSuffix(filename, ".md") {
		filename += ".md"
	}
	// Prevent path traversal
	filename = filepath.Base(filename)

	// Parse to validate it's a valid skill markdown
	skill, err := parseSkillMarkdown(payload.Content, "user")
	if err != nil {
		return transport.Response{ID: req.ID, Success: false, Error: fmt.Sprintf("invalid skill markdown: %v", err)}
	}
	if skill.ID == "" {
		skill.ID = strings.TrimSuffix(filename, ".md")
	}

	// Write to user skills directory
	skillsDir := appdir.SkillsDir()
	if err := os.MkdirAll(skillsDir, 0755); err != nil {
		return transport.Response{ID: req.ID, Success: false, Error: fmt.Sprintf("cannot create skills dir: %v", err)}
	}
	path := filepath.Join(skillsDir, filename)
	if err := os.WriteFile(path, []byte(payload.Content), 0644); err != nil {
		return transport.Response{ID: req.ID, Success: false, Error: fmt.Sprintf("write failed: %v", err)}
	}

	// Register and enable the skill
	m.registry.Register(skill)
	m.registry.Enable(skill.ID)
	m.persistSkillState(skill.ID)

	return transport.Response{ID: req.ID, Success: true, Data: map[string]any{
		"id":   skill.ID,
		"name": skill.Name,
		"path": path,
	}}
}

func (m *SkillModule) handleDelete(_ context.Context, req transport.Request) transport.Response {
	var payload struct {
		ID string `json:"id"`
	}
	if req.Payload != nil {
		json.Unmarshal(req.Payload, &payload)
	}
	s, ok := m.registry.Get(payload.ID)
	if !ok {
		return transport.Response{ID: req.ID, Success: false, Error: "skill not found"}
	}
	if s.Source != "user" {
		return transport.Response{ID: req.ID, Success: false, Error: "can only delete user skills"}
	}

	// Delete file
	path := filepath.Join(appdir.SkillsDir(), payload.ID+".md")
	os.Remove(path)

	// Unregister
	m.registry.Unload(payload.ID)
	m.registry.Remove(payload.ID)

	return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"ok": true}}
}

// --- Helper functions ---

func (m *SkillModule) persistSkillState(id string) error {
	skillState, ok := m.registry.State(id)
	if !ok {
		return fmt.Errorf("skill not found")
	}
	return m.stateStore.SetSkillState(state.SkillRuntimeState{
		ID:        id,
		Loaded:    skillState.Loaded,
		Enabled:   skillState.Enabled,
		LoadedAt:  skillState.LoadedAt,
		UpdatedAt: skillState.UpdatedAt,
	})
}

func (m *SkillModule) handleSkillStateMutation(requestID string, mutate func() bool, missingErr string) transport.Response {
	if !mutate() {
		return transport.Response{ID: requestID, Success: false, Error: missingErr}
	}
	return transport.Response{ID: requestID, Success: true, Data: map[string]any{"ok": true}}
}

func skillStateLabel(s State) string {
	switch {
	case !s.Loaded:
		return "unloaded"
	case !s.Enabled:
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

func skillKeywords(s *Skill) []string {
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

func searchSkills(skillReg *Registry, hooksList []hook.Hook, payload struct {
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
