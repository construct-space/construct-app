package state

import (
	"context"

	"construct-operator/internal/transport"
)

// RouteFunc registers a handler for a request type.
// Callers pass a wrapper around module.Router.Handle to wire up routes
// without an import cycle (module already imports state).
type RouteFunc func(reqType string, handler func(ctx context.Context, req transport.Request) transport.Response)

// SettingsHook encapsulates provider-related side effects for settings.set
// and settings.provider_status. The implementation lives in the operatorapp
// layer so the state package avoids importing runner or operatorapp/providers.
type SettingsHook interface {
	// OnSettingSet is called after a setting is persisted. It handles
	// env-var syncing and provider registration/removal.
	OnSettingSet(key, value string)
	// ProviderStatus returns the current provider status map.
	ProviderStatus(settings map[string]string) map[string]bool
}

// StateModule is the self-contained module for all state/storage/kv/settings operations.
// It avoids importing the module package (which imports state) to prevent an import cycle.
type StateModule struct {
	store    *Store
	settings SettingsHook
}

// NewModule creates the state module. The caller wires dependencies.
func NewModule(store *Store, settings SettingsHook) *StateModule {
	return &StateModule{
		store:    store,
		settings: settings,
	}
}

func (m *StateModule) ID() string  { return "state" }
func (m *StateModule) Init() error { return nil }

// Routes registers all state-related request handlers.
// The caller wraps module.Router.Handle into a RouteFunc, e.g.:
//
//	mod.Routes(func(t string, h func(context.Context, transport.Request) transport.Response) {
//	    router.Handle(t, h)
//	})
func (m *StateModule) Routes(register RouteFunc) {
	// storage.*
	register("storage.get", m.handleStorageGet)
	register("storage.set", m.handleStorageSet)
	register("storage.delete", m.handleStorageDelete)
	register("storage.batch_get", m.handleStorageBatchGet)
	register("storage.batch_set", m.handleStorageBatchSet)
	register("storage.list", m.handleStorageList)

	// kv.*
	register("kv.get", m.handleKVGet)
	register("kv.set", m.handleKVSet)
	register("kv.delete", m.handleKVDelete)
	register("kv.list", m.handleKVList)

	// settings.*
	register("settings.get", m.handleSettingsGet)
	register("settings.set", m.handleSettingsSet)
	register("settings.provider_status", m.handleSettingsProviderStatus)

	// project_settings.*
	register("project_settings.get", m.handleProjectSettingsGet)
	register("project_settings.set", m.handleProjectSettingsSet)

	// pinned.*
	register("pinned.list", m.handlePinnedList)
	register("pinned.add", m.handlePinnedAdd)
	register("pinned.remove", m.handlePinnedRemove)
	register("pinned.reorder", m.handlePinnedReorder)

	// designs.*
	register("designs.list", m.handleDesignsList)
	register("designs.get", m.handleDesignsGet)
	register("designs.save", m.handleDesignsSave)
	register("designs.delete", m.handleDesignsDelete)
}
