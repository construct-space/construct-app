package runner

import "construct-operator/internal/session"

// ListSessions returns all tracked sessions.
func (r *Runner) ListSessions() []*session.Session {
	return r.sessions.List()
}

// GetSession returns a session by ID.
func (r *Runner) GetSession(id string) (*session.Session, bool) {
	return r.sessions.Get(id)
}
