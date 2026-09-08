// Wire ops that don't carry brain-side state today. Kept tiny on
// purpose: real handlers live in their own wire_*.go file. If an op
// appears here it's because the feature it exposes has either been
// removed from the frontend or routes through a different layer
// (e.g. the desktop bridge owns profile.update / profile.delete).
package main

import (
	"context"

	"github.com/construct-space/brain/sidecar"
	"github.com/construct-space/brain/wire"
)

func registerStubs(s *sidecar.Server) {
	// profile.delete: registry deletion lives in the desktop bridge so
	// profiles.json is written through the same Tauri code path as create
	// and rename. profile.switch / profile.reload / profile.update are
	// real handlers in wire_meta.go — do NOT add them here, since
	// sidecar.Handle replaces prior handlers and a stub would shadow them.
	s.Handle("profile.delete", func(_ context.Context, req wire.Request, emit func(wire.Response)) {
		emit(wire.Response{ID: req.ID, Success: false, Error: "profile deletion lives in the desktop bridge — call invoke('delete_profile') instead", Done: true})
	})

	// spaces.reload: marketplace install/uninstall pings brain to rescan
	// any space-derived state. The installed-spaces directory section is
	// the one cache brain owns — drop it so the next prompt re-fetches.
	s.Handle("spaces.reload", func(_ context.Context, req wire.Request, emit func(wire.Response)) {
		invalidateSpacesDirectory()
		emit(wire.Response{ID: req.ID, Success: true, Done: true})
	})

	// spaces.actions_ready: bootstrap pings brain once the frontend has
	// registered every installed space's action providers (core + lazy).
	// A directory fetched before this point may be partial — invalidate
	// so the next prompt sees the full catalog.
	s.Handle("spaces.actions_ready", func(_ context.Context, req wire.Request, emit func(wire.Response)) {
		invalidateSpacesDirectory()
		emit(wire.Response{ID: req.ID, Success: true, Done: true})
	})
}
