package state

import (
	"context"
	"encoding/json"

	"construct-operator/internal/transport"
)

// --- storage.* handlers ---

func (m *StateModule) handleStorageGet(_ context.Context, req transport.Request) transport.Response {
	var payload struct {
		Key       string `json:"key"`
		Category  string `json:"category"`
		ProjectID *int   `json:"projectId"`
		UserID    string `json:"userId"`
	}
	if req.Payload != nil {
		json.Unmarshal(req.Payload, &payload)
	}
	if payload.Key == "" {
		return transport.Response{ID: req.ID, Success: false, Error: "key is required"}
	}
	value, ok := m.store.StorageGet(payload.Key, Scope{
		Category:  payload.Category,
		ProjectID: payload.ProjectID,
		UserID:    payload.UserID,
	})
	if !ok {
		return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"value": nil}}
	}
	return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"value": value}}
}

func (m *StateModule) handleStorageSet(_ context.Context, req transport.Request) transport.Response {
	var payload struct {
		Key       string          `json:"key"`
		Value     json.RawMessage `json:"value"`
		Category  string          `json:"category"`
		ProjectID *int            `json:"projectId"`
		UserID    string          `json:"userId"`
	}
	if req.Payload != nil {
		json.Unmarshal(req.Payload, &payload)
	}
	if payload.Key == "" {
		return transport.Response{ID: req.ID, Success: false, Error: "key is required"}
	}
	if err := m.store.StorageSet(payload.Key, payload.Value, Scope{
		Category:  payload.Category,
		ProjectID: payload.ProjectID,
		UserID:    payload.UserID,
	}); err != nil {
		return transport.Response{ID: req.ID, Success: false, Error: err.Error()}
	}
	return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"ok": true}}
}

func (m *StateModule) handleStorageDelete(_ context.Context, req transport.Request) transport.Response {
	var payload struct {
		Key       string `json:"key"`
		Category  string `json:"category"`
		ProjectID *int   `json:"projectId"`
		UserID    string `json:"userId"`
	}
	if req.Payload != nil {
		json.Unmarshal(req.Payload, &payload)
	}
	if payload.Key == "" {
		return transport.Response{ID: req.ID, Success: false, Error: "key is required"}
	}
	var scope *Scope
	if payload.Category != "" || payload.ProjectID != nil || payload.UserID != "" {
		scope = &Scope{
			Category:  payload.Category,
			ProjectID: payload.ProjectID,
			UserID:    payload.UserID,
		}
	}
	if err := m.store.StorageDelete(payload.Key, scope); err != nil {
		return transport.Response{ID: req.ID, Success: false, Error: err.Error()}
	}
	return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"ok": true}}
}

func (m *StateModule) handleStorageBatchGet(_ context.Context, req transport.Request) transport.Response {
	var payload struct {
		Keys      []string `json:"keys"`
		Category  string   `json:"category"`
		ProjectID *int     `json:"projectId"`
		UserID    string   `json:"userId"`
	}
	if req.Payload != nil {
		json.Unmarshal(req.Payload, &payload)
	}
	items := m.store.StorageBatchGet(payload.Keys, Scope{
		Category:  payload.Category,
		ProjectID: payload.ProjectID,
		UserID:    payload.UserID,
	})
	return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"items": items}}
}

func (m *StateModule) handleStorageBatchSet(_ context.Context, req transport.Request) transport.Response {
	var payload struct {
		Items     map[string]json.RawMessage `json:"items"`
		Category  string                     `json:"category"`
		ProjectID *int                       `json:"projectId"`
		UserID    string                     `json:"userId"`
	}
	if req.Payload != nil {
		json.Unmarshal(req.Payload, &payload)
	}
	if err := m.store.StorageBatchSet(payload.Items, Scope{
		Category:  payload.Category,
		ProjectID: payload.ProjectID,
		UserID:    payload.UserID,
	}); err != nil {
		return transport.Response{ID: req.ID, Success: false, Error: err.Error()}
	}
	return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"ok": true}}
}

func (m *StateModule) handleStorageList(_ context.Context, req transport.Request) transport.Response {
	var payload struct {
		Category  string `json:"category"`
		ProjectID *int   `json:"projectId"`
		UserID    string `json:"userId"`
	}
	if req.Payload != nil {
		json.Unmarshal(req.Payload, &payload)
	}
	entries := m.store.StorageList(Scope{
		Category:  payload.Category,
		ProjectID: payload.ProjectID,
		UserID:    payload.UserID,
	})
	items := make([]map[string]any, 0, len(entries))
	for _, entry := range entries {
		items = append(items, map[string]any{
			"key":   entry.Key,
			"value": entry.Value,
		})
	}
	return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"items": items}}
}

// --- kv.* handlers ---

func (m *StateModule) handleKVGet(_ context.Context, req transport.Request) transport.Response {
	var payload struct {
		Key      string `json:"key"`
		Category string `json:"category"`
	}
	if req.Payload != nil {
		json.Unmarshal(req.Payload, &payload)
	}
	if payload.Key == "" {
		return transport.Response{ID: req.ID, Success: false, Error: "key is required"}
	}
	value, ok := m.store.KVGet(payload.Key, payload.Category)
	if !ok {
		return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"value": nil}}
	}
	return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"value": value}}
}

func (m *StateModule) handleKVSet(_ context.Context, req transport.Request) transport.Response {
	var payload struct {
		Key      string `json:"key"`
		Value    string `json:"value"`
		Category string `json:"category"`
	}
	if req.Payload != nil {
		json.Unmarshal(req.Payload, &payload)
	}
	if payload.Key == "" {
		return transport.Response{ID: req.ID, Success: false, Error: "key is required"}
	}
	if err := m.store.KVSet(payload.Key, payload.Value, payload.Category); err != nil {
		return transport.Response{ID: req.ID, Success: false, Error: err.Error()}
	}
	return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"ok": true}}
}

func (m *StateModule) handleKVDelete(_ context.Context, req transport.Request) transport.Response {
	var payload struct {
		Key      string `json:"key"`
		Category string `json:"category"`
	}
	if req.Payload != nil {
		json.Unmarshal(req.Payload, &payload)
	}
	if payload.Key == "" {
		return transport.Response{ID: req.ID, Success: false, Error: "key is required"}
	}
	if err := m.store.KVDelete(payload.Key, payload.Category); err != nil {
		return transport.Response{ID: req.ID, Success: false, Error: err.Error()}
	}
	return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"ok": true}}
}

func (m *StateModule) handleKVList(_ context.Context, req transport.Request) transport.Response {
	var payload struct {
		Category string `json:"category"`
	}
	if req.Payload != nil {
		json.Unmarshal(req.Payload, &payload)
	}
	return transport.Response{ID: req.ID, Success: true, Data: map[string]any{
		"entries": m.store.KVList(payload.Category),
	}}
}

// --- settings.* handlers ---

func (m *StateModule) handleSettingsGet(_ context.Context, req transport.Request) transport.Response {
	var payload struct {
		Key string `json:"key"`
	}
	if req.Payload != nil {
		json.Unmarshal(req.Payload, &payload)
	}
	if payload.Key == "" {
		return transport.Response{ID: req.ID, Success: false, Error: "key is required"}
	}
	value, ok := m.store.SettingGet(payload.Key)
	if !ok {
		return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"value": nil}}
	}
	return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"value": value}}
}

func (m *StateModule) handleSettingsSet(_ context.Context, req transport.Request) transport.Response {
	var payload struct {
		Key   string `json:"key"`
		Value string `json:"value"`
	}
	if req.Payload != nil {
		json.Unmarshal(req.Payload, &payload)
	}
	if payload.Key == "" {
		return transport.Response{ID: req.ID, Success: false, Error: "key is required"}
	}
	if err := m.store.SettingSet(payload.Key, payload.Value); err != nil {
		return transport.Response{ID: req.ID, Success: false, Error: err.Error()}
	}
	if m.settings != nil {
		m.settings.OnSettingSet(payload.Key, payload.Value)
	}
	return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"ok": true}}
}

func (m *StateModule) handleSettingsProviderStatus(_ context.Context, req transport.Request) transport.Response {
	var providers map[string]bool
	if m.settings != nil {
		providers = m.settings.ProviderStatus(m.store.Settings())
	}
	return transport.Response{ID: req.ID, Success: true, Data: map[string]any{
		"providers": providers,
	}}
}

// --- project_settings.* handlers ---

func (m *StateModule) handleProjectSettingsGet(_ context.Context, req transport.Request) transport.Response {
	var payload struct {
		ProjectID int `json:"projectId"`
	}
	if req.Payload != nil {
		json.Unmarshal(req.Payload, &payload)
	}
	if payload.ProjectID == 0 {
		return transport.Response{ID: req.ID, Success: false, Error: "projectId is required"}
	}
	settings, ok := m.store.ProjectSettingsGet(payload.ProjectID)
	if !ok {
		return transport.Response{ID: req.ID, Success: true, Data: nil}
	}
	return transport.Response{ID: req.ID, Success: true, Data: settings}
}

func (m *StateModule) handleProjectSettingsSet(_ context.Context, req transport.Request) transport.Response {
	var payload struct {
		ProjectID  int    `json:"projectId"`
		LocalPath  string `json:"localPath"`
		EditorPath string `json:"editorPath"`
		SyncedAt   string `json:"syncedAt"`
		UpdatedAt  string `json:"updatedAt"`
	}
	if req.Payload != nil {
		json.Unmarshal(req.Payload, &payload)
	}
	if payload.ProjectID == 0 {
		return transport.Response{ID: req.ID, Success: false, Error: "projectId is required"}
	}
	if err := m.store.ProjectSettingsSet(ProjectSettings{
		ProjectID:  payload.ProjectID,
		LocalPath:  payload.LocalPath,
		EditorPath: payload.EditorPath,
		SyncedAt:   payload.SyncedAt,
		UpdatedAt:  payload.UpdatedAt,
	}); err != nil {
		return transport.Response{ID: req.ID, Success: false, Error: err.Error()}
	}
	return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"ok": true}}
}

// --- pinned.* handlers ---

func (m *StateModule) handlePinnedList(_ context.Context, req transport.Request) transport.Response {
	return transport.Response{ID: req.ID, Success: true, Data: map[string]any{
		"items": m.store.PinnedList(),
	}}
}

func (m *StateModule) handlePinnedAdd(_ context.Context, req transport.Request) transport.Response {
	var payload PinnedItem
	if req.Payload != nil {
		json.Unmarshal(req.Payload, &payload)
	}
	if err := m.store.PinnedAdd(payload); err != nil {
		return transport.Response{ID: req.ID, Success: false, Error: err.Error()}
	}
	return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"ok": true}}
}

func (m *StateModule) handlePinnedRemove(_ context.Context, req transport.Request) transport.Response {
	var payload struct {
		ID string `json:"id"`
	}
	if req.Payload != nil {
		json.Unmarshal(req.Payload, &payload)
	}
	if payload.ID == "" {
		return transport.Response{ID: req.ID, Success: false, Error: "id is required"}
	}
	if err := m.store.PinnedRemove(payload.ID); err != nil {
		return transport.Response{ID: req.ID, Success: false, Error: err.Error()}
	}
	return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"ok": true}}
}

func (m *StateModule) handlePinnedReorder(_ context.Context, req transport.Request) transport.Response {
	var payload struct {
		Items []PinnedOrder `json:"items"`
	}
	if req.Payload != nil {
		json.Unmarshal(req.Payload, &payload)
	}
	if err := m.store.PinnedReorder(payload.Items); err != nil {
		return transport.Response{ID: req.ID, Success: false, Error: err.Error()}
	}
	return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"ok": true}}
}

// --- designs.* handlers ---

func (m *StateModule) handleDesignsList(_ context.Context, req transport.Request) transport.Response {
	var payload struct {
		ProjectID *int `json:"projectId"`
	}
	if req.Payload != nil {
		json.Unmarshal(req.Payload, &payload)
	}
	records := m.store.DesignList(payload.ProjectID)
	designs := make([]map[string]any, 0, len(records))
	for _, record := range records {
		designs = append(designs, record.ResponseMap())
	}
	return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"designs": designs}}
}

func (m *StateModule) handleDesignsGet(_ context.Context, req transport.Request) transport.Response {
	var payload struct {
		LocalID string `json:"localId"`
	}
	if req.Payload != nil {
		json.Unmarshal(req.Payload, &payload)
	}
	if payload.LocalID == "" {
		return transport.Response{ID: req.ID, Success: false, Error: "localId is required"}
	}
	record, ok := m.store.DesignGet(payload.LocalID)
	if !ok {
		return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"design": nil}}
	}
	return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"design": record.ResponseMap()}}
}

func (m *StateModule) handleDesignsSave(_ context.Context, req transport.Request) transport.Response {
	var payload struct {
		LocalID        string          `json:"localId"`
		LocalIDSnake   string          `json:"local_id"`
		ProjectID      *int            `json:"projectId"`
		ProjectIDSnake *int            `json:"project_id"`
		Name           string          `json:"name"`
		NodesJSON      string          `json:"nodes_json"`
		PagesJSON      string          `json:"pages_json"`
		ViewportJSON   string          `json:"viewport_json"`
		HistoryJSON    string          `json:"history_json"`
		HistoryIndex   int             `json:"history_index"`
		SyncedAt       string          `json:"synced_at"`
		CreatedAt      string          `json:"created_at"`
		Nodes          json.RawMessage `json:"nodes"`
		Pages          json.RawMessage `json:"pages"`
		Viewport       json.RawMessage `json:"viewport"`
		History        json.RawMessage `json:"history"`
	}
	if req.Payload != nil {
		json.Unmarshal(req.Payload, &payload)
	}
	localID := payload.LocalID
	if localID == "" {
		localID = payload.LocalIDSnake
	}
	projectID := payload.ProjectID
	if projectID == nil {
		projectID = payload.ProjectIDSnake
	}
	nodesJSON := payload.NodesJSON
	if nodesJSON == "" && len(payload.Nodes) > 0 {
		nodesJSON = string(payload.Nodes)
	}
	pagesJSON := payload.PagesJSON
	if pagesJSON == "" && len(payload.Pages) > 0 {
		pagesJSON = string(payload.Pages)
	}
	viewportJSON := payload.ViewportJSON
	if viewportJSON == "" && len(payload.Viewport) > 0 {
		viewportJSON = string(payload.Viewport)
	}
	historyJSON := payload.HistoryJSON
	if historyJSON == "" && len(payload.History) > 0 {
		historyJSON = string(payload.History)
	}
	record, err := m.store.DesignSave(DesignInput{
		LocalID:      localID,
		ProjectID:    projectID,
		Name:         payload.Name,
		NodesJSON:    nodesJSON,
		PagesJSON:    pagesJSON,
		ViewportJSON: viewportJSON,
		HistoryJSON:  historyJSON,
		HistoryIndex: payload.HistoryIndex,
		SyncedAt:     payload.SyncedAt,
		CreatedAt:    payload.CreatedAt,
	})
	if err != nil {
		return transport.Response{ID: req.ID, Success: false, Error: err.Error()}
	}
	return transport.Response{ID: req.ID, Success: true, Data: map[string]any{
		"id":      record.ID,
		"localId": record.LocalID,
	}}
}

func (m *StateModule) handleDesignsDelete(_ context.Context, req transport.Request) transport.Response {
	var payload struct {
		LocalID string `json:"localId"`
	}
	if req.Payload != nil {
		json.Unmarshal(req.Payload, &payload)
	}
	if payload.LocalID == "" {
		return transport.Response{ID: req.ID, Success: false, Error: "localId is required"}
	}
	if err := m.store.DesignDelete(payload.LocalID); err != nil {
		return transport.Response{ID: req.ID, Success: false, Error: err.Error()}
	}
	return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"ok": true}}
}
