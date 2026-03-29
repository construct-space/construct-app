package skill

import (
	"sort"
	"sync"
)

// Registry holds all available skills.
type Registry struct {
	mu      sync.RWMutex
	skills  map[string]*Skill
	states  map[string]State
	metrics map[string]Metrics
}

func NewRegistry() *Registry {
	return &Registry{
		skills:  make(map[string]*Skill),
		states:  make(map[string]State),
		metrics: make(map[string]Metrics),
	}
}

func (r *Registry) Register(s *Skill) {
	r.mu.Lock()
	defer r.mu.Unlock()

	r.skills[s.ID] = s
	if s.Name == "" {
		s.Name = s.ID
	}
	if s.Category == "" {
		s.Category = "custom"
	}
	if _, ok := r.states[s.ID]; !ok {
		now := nowUTC()
		r.states[s.ID] = State{
			Loaded:    true,
			Enabled:   true,
			LoadedAt:  now,
			UpdatedAt: now,
		}
	}
}

func (r *Registry) Get(id string) (*Skill, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	s, ok := r.skills[id]
	return s, ok
}

func (r *Registry) All() []*Skill {
	r.mu.RLock()
	defer r.mu.RUnlock()

	result := make([]*Skill, 0, len(r.skills))
	for _, id := range r.sortedIDsLocked() {
		result = append(result, r.skills[id])
	}
	return result
}

func (r *Registry) State(id string) (State, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	state, ok := r.states[id]
	return state, ok
}

func (r *Registry) SetState(id string, state State) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.setStateLocked(id, state)
}

func (r *Registry) Load(id string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()

	state, ok := r.states[id]
	if !ok {
		return false
	}
	state.Loaded = true
	if state.LoadedAt == "" {
		state.LoadedAt = nowUTC()
	}
	state.UpdatedAt = nowUTC()
	r.states[id] = state
	return true
}

func (r *Registry) Unload(id string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()

	state, ok := r.states[id]
	if !ok {
		return false
	}
	state.Loaded = false
	state.Enabled = false
	state.UpdatedAt = nowUTC()
	r.states[id] = state
	return true
}

func (r *Registry) Enable(id string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()

	state, ok := r.states[id]
	if !ok {
		return false
	}
	state.Loaded = true
	state.Enabled = true
	if state.LoadedAt == "" {
		state.LoadedAt = nowUTC()
	}
	state.UpdatedAt = nowUTC()
	r.states[id] = state
	return true
}

func (r *Registry) Remove(id string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.skills, id)
	delete(r.states, id)
	delete(r.metrics, id)
}

func (r *Registry) Disable(id string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()

	state, ok := r.states[id]
	if !ok {
		return false
	}
	state.Enabled = false
	state.UpdatedAt = nowUTC()
	r.states[id] = state
	return true
}

func (r *Registry) Metrics() map[string]Metrics {
	r.mu.RLock()
	defer r.mu.RUnlock()

	result := make(map[string]Metrics, len(r.metrics))
	for id, metric := range r.metrics {
		result[id] = metric
	}
	return result
}

// AllForAgent returns all enabled skills available to a given agent.
func (r *Registry) AllForAgent(agentID string) []*Skill {
	r.mu.RLock()
	defer r.mu.RUnlock()

	var result []*Skill
	for _, id := range r.sortedIDsLocked() {
		s := r.skills[id]
		state := r.states[id]
		if !state.Loaded || !state.Enabled {
			continue
		}
		if !matchesAgent(s.Agents, agentID) {
			continue
		}
		result = append(result, s)
	}
	return result
}

// Match finds skills whose trigger matches the given input.
func (r *Registry) Match(input string) []*Skill {
	return r.MatchForAgent(input, "")
}

// MatchForAgent finds skills whose trigger matches the given input and agent.
func (r *Registry) MatchForAgent(input, agentID string) []*Skill {
	r.mu.Lock()
	defer r.mu.Unlock()

	var matches []*Skill
	now := nowUTC()
	for _, id := range r.sortedIDsLocked() {
		s := r.skills[id]
		state := r.states[id]
		if !state.Loaded || !state.Enabled {
			continue
		}
		if !matchesAgent(s.Agents, agentID) {
			continue
		}
		if matchesExplicitSkillReference(s, input) || (s.Trigger != "" && matchesTrigger(s.Trigger, input)) {
			matches = append(matches, s)
			metric := r.metrics[id]
			metric.LastUsed = now
			r.metrics[id] = metric
		}
	}
	return matches
}

func (r *Registry) setStateLocked(id string, state State) bool {
	if _, ok := r.skills[id]; !ok {
		return false
	}
	if state.Loaded && state.LoadedAt == "" {
		state.LoadedAt = nowUTC()
	}
	if state.UpdatedAt == "" {
		state.UpdatedAt = nowUTC()
	}
	r.states[id] = state
	return true
}

func (r *Registry) sortedIDsLocked() []string {
	ids := make([]string, 0, len(r.skills))
	for id := range r.skills {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}
