// Discovery + lifecycle wire ops — ping, info, system.*, models/tools/
// skills listings, providers.refresh, identity, ai.providers, cancel.
// Tiny handlers that don't fit elsewhere; collected here so registerBuiltins
// only fans out to register* functions.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/construct-space/brain/agents"
	"github.com/construct-space/brain/bridge"
	"github.com/construct-space/brain/catalog"
	"github.com/construct-space/brain/identity"
	"github.com/construct-space/brain/oauth"
	"github.com/construct-space/brain/paths"
	"github.com/construct-space/brain/provider"
	"github.com/construct-space/brain/session"
	"github.com/construct-space/brain/sidecar"
	"github.com/construct-space/brain/skill"
	"github.com/construct-space/brain/state"
	"github.com/construct-space/brain/tool"
	"github.com/construct-space/brain/wire"
)

func registerSystemHandlers(
	s *sidecar.Server,
	p paths.Paths,
	br *bridge.Client,
	idLoader *identity.Loader,
	sessions *session.Store,
	stateStore *state.Store,
	oauthStore *oauth.Storage,
	catalogReg *catalog.Registry,
) {
	// probeBridge does a live HTTP ping against the desktop bridge.
	// Returns "disabled" when CONSTRUCT_BRIDGE_PORT was never set,
	// "connected" when the bridge answers, "unreachable" otherwise.
	probeBridge := func(ctx context.Context) string {
		if br == nil || br.Addr == "" {
			return "disabled"
		}
		ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
		defer cancel()
		if _, err := br.Call(ctx, "ping", nil); err != nil {
			return "unreachable"
		}
		return "connected"
	}

	s.Handle("ping", func(_ context.Context, req wire.Request, emit func(wire.Response)) {
		emit(wire.Response{ID: req.ID, Success: true, Data: "pong", Done: true})
	})
	s.Handle("info", func(ctx context.Context, req wire.Request, emit func(wire.Response)) {
		emit(wire.Response{ID: req.ID, Success: true, Data: map[string]any{
			"version":      version,
			"data_dir":     p.DataDir,
			"brain_dir":    p.BrainDir,
			"bridgeStatus": probeBridge(ctx),
		}, Done: true})
	})
	// Operator-compat alias — frontend's useOperator.connect() probes
	// "system.ping" expecting {status:"ok", version} before flipping
	// connected=true.
	s.Handle("system.ping", func(_ context.Context, req wire.Request, emit func(wire.Response)) {
		emit(wire.Response{ID: req.ID, Success: true, Data: map[string]any{"status": "ok", "version": version}, Done: true})
	})
	s.Handle("system.info", func(ctx context.Context, req wire.Request, emit func(wire.Response)) {
		live := currentPaths()
		if live.DataDir == "" {
			live = p
		}
		emit(wire.Response{ID: req.ID, Success: true, Data: map[string]any{
			"version":      version,
			"data_dir":     live.DataDir,
			"brain_dir":    live.BrainDir,
			"sidecar":      "brain",
			"bridgeStatus": probeBridge(ctx),
		}, Done: true})
	})

	// profile.switch — frontend hands brain a new active profile dir
	// (typically `<app-data>/profiles/<uuid>`). Brain rebinds every
	// subsystem rooted at the profile (skills, hooks, identity loader,
	// session store, state store, OAuth storage, catalog cache) against
	// that dir and stores the snapshot atomically. Wire ops that read via
	// currentSkills/Hooks/Paths or the rebound stores pick up the new
	// state on the next request.
	s.Handle("profile.switch", func(_ context.Context, req wire.Request, emit func(wire.Response)) {
		var pl struct {
			DataDir   string `json:"data_dir"`
			ProfileID string `json:"profile_id"`
			// `id` is the field the frontend store actually sends
			// (`operator.send('profile.switch', { id })`). Accept both.
			ID string `json:"id"`
		}
		_ = json.Unmarshal(req.Payload, &pl)
		profileID := strings.TrimSpace(pl.ProfileID)
		if profileID == "" {
			profileID = strings.TrimSpace(pl.ID)
		}
		newDir := strings.TrimSpace(pl.DataDir)
		if newDir == "" && profileID != "" {
			// Resolve the new profile dir against the BASE data dir, not
			// the boot profile's DataDir — otherwise we end up with
			// <base>/profiles/<bootID>/profiles/<newID>.
			base := p.BaseDir
			if base == "" {
				base = p.DataDir
			}
			newDir = filepath.Join(base, "profiles", profileID)
		}
		if newDir == "" {
			emit(wire.Response{ID: req.ID, Success: false, Error: "payload.id, payload.profile_id, or payload.data_dir is required", Done: true})
			return
		}
		baseDir := p.BaseDir
		if baseDir == "" {
			sep := string(filepath.Separator)
			if i := strings.LastIndex(newDir, sep+"profiles"+sep); i > 0 {
				baseDir = newDir[:i]
			} else {
				baseDir = newDir
			}
		}
		newPaths := paths.Paths{
			DataDir:       newDir,
			BaseDir:       baseDir,
			BrainDir:      filepath.Join(newDir, "brain"),
			SessionsDir:   filepath.Join(newDir, "brain", "sessions"),
			StateDir:      filepath.Join(newDir, "brain", "state"),
			LogsDir:       filepath.Join(newDir, "brain", "logs"),
			AuthFile:      filepath.Join(newDir, "auth.json"),
			ProvidersFile: filepath.Join(newDir, "providers.json"),
			ProvidersAuth: filepath.Join(newDir, "providers", "auth.json"),
			SettingsFile:  filepath.Join(newDir, "construct-settings.json"),
			SkillsDir:     filepath.Join(newDir, "skills"),
		}
		snap := reloadSkillsAndHooks(newPaths, activeSkillDirs)
		storeProfile(snap)
		// Repoint every profile-rooted subsystem at the new dir.
		// Order doesn't matter — each holds its own lock — but we log a
		// soft warning if state.Rebind fails so a corrupt new-profile
		// dir surfaces in logs without breaking the wire response.
		if idLoader != nil {
			idLoader.Rebind(newPaths.AuthFile, newPaths.ProvidersAuth)
			// Rebind zeroes the cached identity; without an immediate
			// Load the new profile reports signed-out (and OAuth Key()
			// callbacks return "") until some unrelated op reloads it.
			idLoader.Load()
		}
		if oauthStore != nil {
			oauthStore.Rebind(newPaths.ProvidersAuth)
		}
		if sessions != nil {
			sessions.Rebind(newPaths.SessionsDir)
		}
		if stateStore != nil {
			if err := stateStore.Rebind(newPaths.StateDir); err != nil {
				fmt.Fprintf(os.Stderr, "[brain] profile.switch state.Rebind: %v\n", err)
			}
		}
		if catalogReg != nil {
			catalogReg.Rebind(newPaths.StateDir)
			_ = catalogReg.LoadCache()
		}
		emit(wire.Response{ID: req.ID, Success: true, Data: map[string]any{
			"data_dir":     snap.Paths.DataDir,
			"skills_count": len(snap.Skills),
		}, Done: true})
	})

	// profile.reload — same as profile.switch but reuses the current
	// data dir. Useful right after installing a marketplace space so
	// brain re-scans spaces/*.space/SKILL.md without the frontend having
	// to know the profile uuid.
	s.Handle("profile.reload", func(_ context.Context, req wire.Request, emit func(wire.Response)) {
		live := currentPaths()
		if live.DataDir == "" {
			live = p
		}
		snap := reloadSkillsAndHooks(live, activeSkillDirs)
		storeProfile(snap)
		emit(wire.Response{ID: req.ID, Success: true, Data: map[string]any{
			"data_dir":     snap.Paths.DataDir,
			"skills_count": len(snap.Skills),
		}, Done: true})
	})

	// profile.update — frontend pushes new profile metadata after the
	// desktop bridge's `update_profile` Tauri command writes profiles.json.
	// brain's behaviour doesn't depend on the display name/email, but
	// auth.json may have been touched (avatar/name fields land there in
	// some flows), so we reload identity and return the fresh whoami
	// snapshot. Anything beyond that is the desktop bridge's job.
	s.Handle("profile.update", func(_ context.Context, req wire.Request, emit func(wire.Response)) {
		if idLoader != nil {
			idLoader.Load()
		}
		var who any
		if idLoader != nil {
			who = idLoader.Current().Public()
		}
		emit(wire.Response{ID: req.ID, Success: true, Data: map[string]any{
			"identity": who,
		}, Done: true})
	})
}

func registerCatalogHandlers(s *sidecar.Server, reg *catalog.Registry, tools *tool.Registry, skills []skill.Skill) {
	s.Handle("providers.refresh", func(ctx context.Context, req wire.Request, emit func(wire.Response)) {
		if err := reg.Refresh(ctx); err != nil {
			emit(wire.Response{ID: req.ID, Success: false, Error: err.Error(), Done: true})
			return
		}
		emit(wire.Response{ID: req.ID, Success: true, Data: map[string]any{"ok": true}, Done: true})
	})
	s.Handle("models.list", func(ctx context.Context, req wire.Request, emit func(wire.Response)) {
		// Fast path — cache already populated.
		if snap := reg.Snapshot(); snap != nil {
			emit(wire.Response{ID: req.ID, Success: true, Data: snap, Done: true})
			return
		}
		// First-boot path: the background refresh in main.go may still
		// be in flight. Block briefly on a synchronous Refresh so the
		// UI gets a populated catalog on the very first models.list
		// call instead of an empty providers grid. Previously this
		// errored "catalog not loaded yet", which the LLMSettings page
		// rendered as "only the hardcoded local cards exist" — looked
		// like remote providers were missing entirely.
		rctx, cancel := context.WithTimeout(ctx, 8*time.Second)
		defer cancel()
		if err := reg.Refresh(rctx); err != nil {
			emit(wire.Response{ID: req.ID, Success: false, Error: "catalog refresh failed: " + err.Error(), Done: true})
			return
		}
		snap := reg.Snapshot()
		if snap == nil {
			emit(wire.Response{ID: req.ID, Success: false, Error: "catalog still empty after refresh", Done: true})
			return
		}
		emit(wire.Response{ID: req.ID, Success: true, Data: snap, Done: true})
	})
	s.Handle("tools.list", func(_ context.Context, req wire.Request, emit func(wire.Response)) {
		emit(wire.Response{ID: req.ID, Success: true, Data: tools.AsProviderTools(), Done: true})
	})
	s.Handle("skills.list", func(_ context.Context, req wire.Request, emit func(wire.Response)) {
		// Read the live snapshot so profile.switch surfaces immediately.
		_ = skills
		emit(wire.Response{ID: req.ID, Success: true, Data: map[string]any{"skills": skillInfos(currentSkills())}, Done: true})
	})
}

func registerIdentityHandlers(s *sidecar.Server, idLoader *identity.Loader) {
	s.Handle("identity.whoami", func(_ context.Context, req wire.Request, emit func(wire.Response)) {
		emit(wire.Response{ID: req.ID, Success: true, Data: idLoader.Current().Public(), Done: true})
	})
	s.Handle("identity.reload", func(_ context.Context, req wire.Request, emit func(wire.Response)) {
		id := idLoader.Load()
		emit(wire.Response{ID: req.ID, Success: true, Data: id.Public(), Done: true})
	})
}

// registerAIProvidersHandler wires the legacy ai.providers shape against
// the catalog + OAuth store. handleAIProviders lives in wire_oauth.go.
func registerAIProvidersHandler(s *sidecar.Server, reg *catalog.Registry, store *oauth.Storage, stateStore *state.Store, orgKeys *provider.OrgKeyStore) {
	s.Handle("ai.providers", func(_ context.Context, req wire.Request, emit func(wire.Response)) {
		handleAIProviders(req, emit, reg, store, stateStore, orgKeys)
	})
}

func registerAgentHandlers(s *sidecar.Server, agentReg *agents.Registry) {
	s.Handle("agents.list", func(_ context.Context, req wire.Request, emit func(wire.Response)) {
		list := agentReg.List()
		out := make([]agents.Public, 0, len(list))
		for _, a := range list {
			out = append(out, a.Public())
		}
		emit(wire.Response{ID: req.ID, Success: true, Data: map[string]any{"agents": out}, Done: true})
	})
	s.Handle("agents.get", func(_ context.Context, req wire.Request, emit func(wire.Response)) {
		var pl struct {
			ID string `json:"id"`
		}
		_ = json.Unmarshal(req.Payload, &pl)
		if pl.ID == "" {
			emit(wire.Response{ID: req.ID, Success: false, Error: "payload.id is required", Done: true})
			return
		}
		a, ok := agentReg.Get(pl.ID)
		if !ok {
			emit(wire.Response{ID: req.ID, Success: false, Error: "unknown agent: " + pl.ID, Done: true})
			return
		}
		emit(wire.Response{ID: req.ID, Success: true, Data: a.Public(), Done: true})
	})
}

func registerCancelHandler(s *sidecar.Server, cancels *cancelTracker) {
	s.Handle("cancel", func(_ context.Context, req wire.Request, emit func(wire.Response)) {
		var pl struct {
			TargetID string `json:"target_id"`
		}
		_ = json.Unmarshal(req.Payload, &pl)
		if pl.TargetID == "" {
			emit(wire.Response{ID: req.ID, Success: false, Error: "payload.target_id is required", Done: true})
			return
		}
		ok := cancels.cancel(pl.TargetID)
		emit(wire.Response{ID: req.ID, Success: true, Data: map[string]any{"cancelled": ok, "target_id": pl.TargetID}, Done: true})
	})
}

func registerOAuthHandlers(s *sidecar.Server, logins *loginRegistry, store *oauth.Storage, idLoader *identity.Loader, reg *catalog.Registry) {
	s.Handle("oauth.login", func(ctx context.Context, req wire.Request, emit func(wire.Response)) {
		handleOAuthLogin(ctx, req, emit, logins, store, idLoader)
	})
	s.Handle("oauth.poll", func(_ context.Context, req wire.Request, emit func(wire.Response)) {
		handleOAuthPoll(req, emit, logins)
	})
	s.Handle("oauth.cancel", func(_ context.Context, req wire.Request, emit func(wire.Response)) {
		handleOAuthCancel(req, emit, logins)
	})
	s.Handle("oauth.providers", func(_ context.Context, req wire.Request, emit func(wire.Response)) {
		handleOAuthProviders(req, emit, store, reg)
	})
	s.Handle("oauth.logout", func(_ context.Context, req wire.Request, emit func(wire.Response)) {
		handleOAuthLogout(req, emit, store, idLoader)
	})
	s.Handle("settings.provider_status", func(_ context.Context, req wire.Request, emit func(wire.Response)) {
		handleProviderStatus(req, emit, store, reg)
	})
}
