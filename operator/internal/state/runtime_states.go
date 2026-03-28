package state

import (
	"fmt"
	"sort"
)

type SkillRuntimeState struct {
	ID        string `json:"id"`
	Loaded    bool   `json:"loaded"`
	Enabled   bool   `json:"enabled"`
	LoadedAt  string `json:"loadedAt,omitempty"`
	UpdatedAt string `json:"updatedAt"`
}

type HookRuntimeState struct {
	ID        string `json:"id"`
	Enabled   bool   `json:"enabled"`
	UpdatedAt string `json:"updatedAt"`
}

type MCPRuntimeState struct {
	ID        string `json:"id"`
	Enabled   bool   `json:"enabled"`
	UpdatedAt string `json:"updatedAt"`
}

type skillStatesFile struct {
	Items []SkillRuntimeState `json:"items"`
}

type hookStatesFile struct {
	Items []HookRuntimeState `json:"items"`
}

type mcpStatesFile struct {
	Items []MCPRuntimeState `json:"items"`
}

func (s *Store) SkillStates() map[string]SkillRuntimeState {
	s.mu.RLock()
	defer s.mu.RUnlock()

	result := make(map[string]SkillRuntimeState, len(s.skillStates))
	for id, state := range s.skillStates {
		result[id] = *state
	}
	return result
}

func (s *Store) SetSkillState(state SkillRuntimeState) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if state.ID == "" {
		return fmt.Errorf("id is required")
	}
	if state.UpdatedAt == "" {
		state.UpdatedAt = nowUTC()
	}
	copy := state
	s.skillStates[state.ID] = &copy
	return s.saveSkillStatesLocked()
}

func (s *Store) DeleteSkillState(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, ok := s.skillStates[id]; !ok {
		return nil
	}
	delete(s.skillStates, id)
	return s.saveSkillStatesLocked()
}

func (s *Store) HookStates() map[string]HookRuntimeState {
	s.mu.RLock()
	defer s.mu.RUnlock()

	result := make(map[string]HookRuntimeState, len(s.hookStates))
	for id, state := range s.hookStates {
		result[id] = *state
	}
	return result
}

func (s *Store) SetHookState(state HookRuntimeState) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if state.ID == "" {
		return fmt.Errorf("id is required")
	}
	if state.UpdatedAt == "" {
		state.UpdatedAt = nowUTC()
	}
	copy := state
	s.hookStates[state.ID] = &copy
	return s.saveHookStatesLocked()
}

func (s *Store) DeleteHookState(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, ok := s.hookStates[id]; !ok {
		return nil
	}
	delete(s.hookStates, id)
	return s.saveHookStatesLocked()
}

func (s *Store) MCPStates() map[string]MCPRuntimeState {
	s.mu.RLock()
	defer s.mu.RUnlock()

	result := make(map[string]MCPRuntimeState, len(s.mcpStates))
	for id, state := range s.mcpStates {
		result[id] = *state
	}
	return result
}

func (s *Store) SetMCPState(state MCPRuntimeState) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if state.ID == "" {
		return fmt.Errorf("id is required")
	}
	if state.UpdatedAt == "" {
		state.UpdatedAt = nowUTC()
	}
	copy := state
	s.mcpStates[state.ID] = &copy
	return s.saveMCPStatesLocked()
}

func (s *Store) DeleteMCPState(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, ok := s.mcpStates[id]; !ok {
		return nil
	}
	delete(s.mcpStates, id)
	return s.saveMCPStatesLocked()
}

func (s *Store) loadSkillStates() {
	var file skillStatesFile
	if err := s.loadJSON(skillStatesFileName, &file); err != nil {
		return
	}
	for _, item := range file.Items {
		entry := item
		s.skillStates[item.ID] = &entry
	}
}

func (s *Store) loadHookStates() {
	var file hookStatesFile
	if err := s.loadJSON(hookStatesFileName, &file); err != nil {
		return
	}
	for _, item := range file.Items {
		entry := item
		s.hookStates[item.ID] = &entry
	}
}

func (s *Store) loadMCPStates() {
	var file mcpStatesFile
	if err := s.loadJSON(mcpStatesFileName, &file); err != nil {
		return
	}
	for _, item := range file.Items {
		entry := item
		s.mcpStates[item.ID] = &entry
	}
}

func (s *Store) saveSkillStatesLocked() error {
	items := make([]SkillRuntimeState, 0, len(s.skillStates))
	for _, item := range s.skillStates {
		items = append(items, *item)
	}
	sort.Slice(items, func(i, j int) bool { return items[i].ID < items[j].ID })
	return s.saveJSON(skillStatesFileName, skillStatesFile{Items: items})
}

func (s *Store) saveHookStatesLocked() error {
	items := make([]HookRuntimeState, 0, len(s.hookStates))
	for _, item := range s.hookStates {
		items = append(items, *item)
	}
	sort.Slice(items, func(i, j int) bool { return items[i].ID < items[j].ID })
	return s.saveJSON(hookStatesFileName, hookStatesFile{Items: items})
}

func (s *Store) saveMCPStatesLocked() error {
	items := make([]MCPRuntimeState, 0, len(s.mcpStates))
	for _, item := range s.mcpStates {
		items = append(items, *item)
	}
	sort.Slice(items, func(i, j int) bool { return items[i].ID < items[j].ID })
	return s.saveJSON(mcpStatesFileName, mcpStatesFile{Items: items})
}
