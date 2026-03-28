package main

import (
	"encoding/json"
	"os"
	"strings"

	"construct-operator/internal/state"
	"construct-operator/internal/transport"
)

func isStateRequestType(reqType string) bool {
	return strings.HasPrefix(reqType, "storage.") ||
		strings.HasPrefix(reqType, "kv.") ||
		strings.HasPrefix(reqType, "settings.") ||
		strings.HasPrefix(reqType, "project_settings.") ||
		strings.HasPrefix(reqType, "pinned.") ||
		strings.HasPrefix(reqType, "designs.")
}

func (rt *operatorRuntime) handleStateRequest(req transport.Request) (transport.Response, bool) {
	switch {
	case strings.HasPrefix(req.Type, "storage."):
		return rt.handleStorageRequest(req)
	case strings.HasPrefix(req.Type, "kv."):
		return rt.handleKVRequest(req)
	case strings.HasPrefix(req.Type, "settings."):
		return rt.handleSettingsRequest(req)
	case strings.HasPrefix(req.Type, "project_settings."):
		return rt.handleProjectSettingsRequest(req)
	case strings.HasPrefix(req.Type, "pinned."):
		return rt.handlePinnedRequest(req)
	case strings.HasPrefix(req.Type, "designs."):
		return rt.handleDesignsRequest(req)
	default:
		return transport.Response{}, false
	}
}

func (rt *operatorRuntime) handleStorageRequest(req transport.Request) (transport.Response, bool) {
	switch req.Type {
	case "storage.get":
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
			return transport.Response{ID: req.ID, Success: false, Error: "key is required"}, true
		}
		value, ok := rt.stateStore.StorageGet(payload.Key, state.Scope{
			Category:  payload.Category,
			ProjectID: payload.ProjectID,
			UserID:    payload.UserID,
		})
		if !ok {
			return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"value": nil}}, true
		}
		return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"value": value}}, true

	case "storage.set":
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
			return transport.Response{ID: req.ID, Success: false, Error: "key is required"}, true
		}
		if err := rt.stateStore.StorageSet(payload.Key, payload.Value, state.Scope{
			Category:  payload.Category,
			ProjectID: payload.ProjectID,
			UserID:    payload.UserID,
		}); err != nil {
			return transport.Response{ID: req.ID, Success: false, Error: err.Error()}, true
		}
		return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"ok": true}}, true

	case "storage.delete":
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
			return transport.Response{ID: req.ID, Success: false, Error: "key is required"}, true
		}
		var scope *state.Scope
		if payload.Category != "" || payload.ProjectID != nil || payload.UserID != "" {
			scope = &state.Scope{
				Category:  payload.Category,
				ProjectID: payload.ProjectID,
				UserID:    payload.UserID,
			}
		}
		if err := rt.stateStore.StorageDelete(payload.Key, scope); err != nil {
			return transport.Response{ID: req.ID, Success: false, Error: err.Error()}, true
		}
		return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"ok": true}}, true

	case "storage.batch_get":
		var payload struct {
			Keys      []string `json:"keys"`
			Category  string   `json:"category"`
			ProjectID *int     `json:"projectId"`
			UserID    string   `json:"userId"`
		}
		if req.Payload != nil {
			json.Unmarshal(req.Payload, &payload)
		}
		items := rt.stateStore.StorageBatchGet(payload.Keys, state.Scope{
			Category:  payload.Category,
			ProjectID: payload.ProjectID,
			UserID:    payload.UserID,
		})
		return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"items": items}}, true

	case "storage.batch_set":
		var payload struct {
			Items     map[string]json.RawMessage `json:"items"`
			Category  string                     `json:"category"`
			ProjectID *int                       `json:"projectId"`
			UserID    string                     `json:"userId"`
		}
		if req.Payload != nil {
			json.Unmarshal(req.Payload, &payload)
		}
		if err := rt.stateStore.StorageBatchSet(payload.Items, state.Scope{
			Category:  payload.Category,
			ProjectID: payload.ProjectID,
			UserID:    payload.UserID,
		}); err != nil {
			return transport.Response{ID: req.ID, Success: false, Error: err.Error()}, true
		}
		return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"ok": true}}, true

	case "storage.list":
		var payload struct {
			Category  string `json:"category"`
			ProjectID *int   `json:"projectId"`
			UserID    string `json:"userId"`
		}
		if req.Payload != nil {
			json.Unmarshal(req.Payload, &payload)
		}
		entries := rt.stateStore.StorageList(state.Scope{
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
		return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"items": items}}, true
	default:
		return transport.Response{}, false
	}
}

func (rt *operatorRuntime) handleKVRequest(req transport.Request) (transport.Response, bool) {
	switch req.Type {
	case "kv.get":
		var payload struct {
			Key      string `json:"key"`
			Category string `json:"category"`
		}
		if req.Payload != nil {
			json.Unmarshal(req.Payload, &payload)
		}
		if payload.Key == "" {
			return transport.Response{ID: req.ID, Success: false, Error: "key is required"}, true
		}
		value, ok := rt.stateStore.KVGet(payload.Key, payload.Category)
		if !ok {
			return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"value": nil}}, true
		}
		return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"value": value}}, true

	case "kv.set":
		var payload struct {
			Key      string `json:"key"`
			Value    string `json:"value"`
			Category string `json:"category"`
		}
		if req.Payload != nil {
			json.Unmarshal(req.Payload, &payload)
		}
		if payload.Key == "" {
			return transport.Response{ID: req.ID, Success: false, Error: "key is required"}, true
		}
		if err := rt.stateStore.KVSet(payload.Key, payload.Value, payload.Category); err != nil {
			return transport.Response{ID: req.ID, Success: false, Error: err.Error()}, true
		}
		return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"ok": true}}, true

	case "kv.delete":
		var payload struct {
			Key      string `json:"key"`
			Category string `json:"category"`
		}
		if req.Payload != nil {
			json.Unmarshal(req.Payload, &payload)
		}
		if payload.Key == "" {
			return transport.Response{ID: req.ID, Success: false, Error: "key is required"}, true
		}
		if err := rt.stateStore.KVDelete(payload.Key, payload.Category); err != nil {
			return transport.Response{ID: req.ID, Success: false, Error: err.Error()}, true
		}
		return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"ok": true}}, true

	case "kv.list":
		var payload struct {
			Category string `json:"category"`
		}
		if req.Payload != nil {
			json.Unmarshal(req.Payload, &payload)
		}
		return transport.Response{ID: req.ID, Success: true, Data: map[string]any{
			"entries": rt.stateStore.KVList(payload.Category),
		}}, true
	default:
		return transport.Response{}, false
	}
}

func (rt *operatorRuntime) handleSettingsRequest(req transport.Request) (transport.Response, bool) {
	switch req.Type {
	case "settings.get":
		var payload struct {
			Key string `json:"key"`
		}
		if req.Payload != nil {
			json.Unmarshal(req.Payload, &payload)
		}
		if payload.Key == "" {
			return transport.Response{ID: req.ID, Success: false, Error: "key is required"}, true
		}
		value, ok := rt.stateStore.SettingGet(payload.Key)
		if !ok {
			return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"value": nil}}, true
		}
		return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"value": value}}, true

	case "settings.set":
		var payload struct {
			Key   string `json:"key"`
			Value string `json:"value"`
		}
		if req.Payload != nil {
			json.Unmarshal(req.Payload, &payload)
		}
		if payload.Key == "" {
			return transport.Response{ID: req.ID, Success: false, Error: "key is required"}, true
		}
		if err := rt.stateStore.SettingSet(payload.Key, payload.Value); err != nil {
			return transport.Response{ID: req.ID, Success: false, Error: err.Error()}, true
		}
		if payload.Key == "construct_projects_root" && strings.TrimSpace(payload.Value) != "" {
			os.Setenv("CONSTRUCT_PROJECTS_ROOT", strings.TrimSpace(payload.Value))
		}
		if envVar := providerEnvVarForSetting(payload.Key); envVar == "" || strings.TrimSpace(os.Getenv(envVar)) == "" {
			if prov := providerFromSetting(payload.Key, strings.TrimSpace(payload.Value)); prov != nil {
				rt.runner.AddProvider(prov)
			} else if providerID := providerIDForSetting(payload.Key); providerID != "" && strings.TrimSpace(payload.Value) == "" {
				rt.runner.RemoveProvider(providerID)
			}
		}
		return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"ok": true}}, true

	case "settings.provider_status":
		return transport.Response{ID: req.ID, Success: true, Data: map[string]any{
			"providers": providerStatus(rt.stateStore.Settings()),
		}}, true
	default:
		return transport.Response{}, false
	}
}

func (rt *operatorRuntime) handleProjectSettingsRequest(req transport.Request) (transport.Response, bool) {
	switch req.Type {
	case "project_settings.get":
		var payload struct {
			ProjectID int `json:"projectId"`
		}
		if req.Payload != nil {
			json.Unmarshal(req.Payload, &payload)
		}
		if payload.ProjectID == 0 {
			return transport.Response{ID: req.ID, Success: false, Error: "projectId is required"}, true
		}
		settings, ok := rt.stateStore.ProjectSettingsGet(payload.ProjectID)
		if !ok {
			return transport.Response{ID: req.ID, Success: true, Data: nil}, true
		}
		return transport.Response{ID: req.ID, Success: true, Data: settings}, true

	case "project_settings.set":
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
			return transport.Response{ID: req.ID, Success: false, Error: "projectId is required"}, true
		}
		if err := rt.stateStore.ProjectSettingsSet(state.ProjectSettings{
			ProjectID:  payload.ProjectID,
			LocalPath:  payload.LocalPath,
			EditorPath: payload.EditorPath,
			SyncedAt:   payload.SyncedAt,
			UpdatedAt:  payload.UpdatedAt,
		}); err != nil {
			return transport.Response{ID: req.ID, Success: false, Error: err.Error()}, true
		}
		return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"ok": true}}, true
	default:
		return transport.Response{}, false
	}
}

func (rt *operatorRuntime) handlePinnedRequest(req transport.Request) (transport.Response, bool) {
	switch req.Type {
	case "pinned.list":
		return transport.Response{ID: req.ID, Success: true, Data: map[string]any{
			"items": rt.stateStore.PinnedList(),
		}}, true

	case "pinned.add":
		var payload state.PinnedItem
		if req.Payload != nil {
			json.Unmarshal(req.Payload, &payload)
		}
		if err := rt.stateStore.PinnedAdd(payload); err != nil {
			return transport.Response{ID: req.ID, Success: false, Error: err.Error()}, true
		}
		return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"ok": true}}, true

	case "pinned.remove":
		var payload struct {
			ID string `json:"id"`
		}
		if req.Payload != nil {
			json.Unmarshal(req.Payload, &payload)
		}
		if payload.ID == "" {
			return transport.Response{ID: req.ID, Success: false, Error: "id is required"}, true
		}
		if err := rt.stateStore.PinnedRemove(payload.ID); err != nil {
			return transport.Response{ID: req.ID, Success: false, Error: err.Error()}, true
		}
		return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"ok": true}}, true

	case "pinned.reorder":
		var payload struct {
			Items []state.PinnedOrder `json:"items"`
		}
		if req.Payload != nil {
			json.Unmarshal(req.Payload, &payload)
		}
		if err := rt.stateStore.PinnedReorder(payload.Items); err != nil {
			return transport.Response{ID: req.ID, Success: false, Error: err.Error()}, true
		}
		return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"ok": true}}, true
	default:
		return transport.Response{}, false
	}
}

func (rt *operatorRuntime) handleDesignsRequest(req transport.Request) (transport.Response, bool) {
	switch req.Type {
	case "designs.list":
		var payload struct {
			ProjectID *int `json:"projectId"`
		}
		if req.Payload != nil {
			json.Unmarshal(req.Payload, &payload)
		}
		records := rt.stateStore.DesignList(payload.ProjectID)
		designs := make([]map[string]any, 0, len(records))
		for _, record := range records {
			designs = append(designs, record.ResponseMap())
		}
		return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"designs": designs}}, true

	case "designs.get":
		var payload struct {
			LocalID string `json:"localId"`
		}
		if req.Payload != nil {
			json.Unmarshal(req.Payload, &payload)
		}
		if payload.LocalID == "" {
			return transport.Response{ID: req.ID, Success: false, Error: "localId is required"}, true
		}
		record, ok := rt.stateStore.DesignGet(payload.LocalID)
		if !ok {
			return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"design": nil}}, true
		}
		return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"design": record.ResponseMap()}}, true

	case "designs.save":
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
		record, err := rt.stateStore.DesignSave(state.DesignInput{
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
			return transport.Response{ID: req.ID, Success: false, Error: err.Error()}, true
		}
		return transport.Response{ID: req.ID, Success: true, Data: map[string]any{
			"id":      record.ID,
			"localId": record.LocalID,
		}}, true

	case "designs.delete":
		var payload struct {
			LocalID string `json:"localId"`
		}
		if req.Payload != nil {
			json.Unmarshal(req.Payload, &payload)
		}
		if payload.LocalID == "" {
			return transport.Response{ID: req.ID, Success: false, Error: "localId is required"}, true
		}
		if err := rt.stateStore.DesignDelete(payload.LocalID); err != nil {
			return transport.Response{ID: req.ID, Success: false, Error: err.Error()}, true
		}
		return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"ok": true}}, true
	default:
		return transport.Response{}, false
	}
}
