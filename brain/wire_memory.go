// Memory wire ops for the Settings UI — read/edit the agent's self-curated
// memory per scope. user + project are local; org is server-side (source-api)
// and not yet wired (Store.Get returns an error for it, surfaced to the UI).
package main

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/construct-space/brain/identity"
	"github.com/construct-space/brain/sidecar"
	"github.com/construct-space/brain/tool"
	"github.com/construct-space/brain/wire"
)

func registerMemoryHandlers(s *sidecar.Server, store *tool.MemoryStore, idLoader *identity.Loader) {
	isOrg := func(scope string) bool { return strings.EqualFold(strings.TrimSpace(scope), "org") }
	orgClient := func() *tool.OrgMemoryClient {
		return tool.NewOrgMemoryClient("", idLoader.Current().Token)
	}

	s.Handle("memory.get", func(ctx context.Context, req wire.Request, emit func(wire.Response)) {
		var pl struct {
			Scope      string `json:"scope"`
			ProjectDir string `json:"project_dir"`
		}
		_ = json.Unmarshal(req.Payload, &pl)
		var content string
		var err error
		if isOrg(pl.Scope) {
			content, err = orgClient().Get(ctx)
		} else {
			content, err = store.Get(pl.Scope, pl.ProjectDir)
		}
		if err != nil {
			emit(wire.Response{ID: req.ID, Success: false, Error: err.Error(), Done: true})
			return
		}
		emit(wire.Response{ID: req.ID, Success: true, Data: map[string]any{"scope": pl.Scope, "content": content}, Done: true})
	})

	s.Handle("memory.set", func(ctx context.Context, req wire.Request, emit func(wire.Response)) {
		var pl struct {
			Scope      string `json:"scope"`
			ProjectDir string `json:"project_dir"`
			Content    string `json:"content"`
		}
		_ = json.Unmarshal(req.Payload, &pl)
		var err error
		if isOrg(pl.Scope) {
			err = orgClient().Set(ctx, pl.Content)
		} else {
			err = store.Set(pl.Scope, pl.ProjectDir, pl.Content)
		}
		if err != nil {
			emit(wire.Response{ID: req.ID, Success: false, Error: err.Error(), Done: true})
			return
		}
		emit(wire.Response{ID: req.ID, Success: true, Data: map[string]any{"ok": true}, Done: true})
	})
}
