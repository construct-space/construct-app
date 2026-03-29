package hook

import (
	"context"
	"encoding/json"
	"strings"

	"construct-operator/internal/state"
	"construct-operator/internal/transport"
)

func (m *HookModule) handleList(_ context.Context, req transport.Request) transport.Response {
	items := make([]map[string]any, 0, len(m.registry.List()))
	for _, hk := range m.registry.List() {
		items = append(items, map[string]any{
			"id":          hk.ID,
			"name":        hk.Name,
			"type":        hookTypeLabel(hk.Type),
			"priority":    hk.Priority,
			"skillId":     hk.SkillID,
			"enabled":     m.registry.IsEnabled(hk.ID),
			"description": hk.Description,
		})
	}
	return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"hooks": items}}
}

func (m *HookModule) handleByType(_ context.Context, req transport.Request) transport.Response {
	var payload struct {
		Type string `json:"type"`
	}
	if req.Payload != nil {
		json.Unmarshal(req.Payload, &payload)
	}
	items := make([]map[string]any, 0)
	for _, hk := range m.registry.List() {
		label := hookTypeLabel(hk.Type)
		if payload.Type != "" && !strings.HasPrefix(label, payload.Type) {
			continue
		}
		items = append(items, map[string]any{
			"id":          hk.ID,
			"name":        hk.Name,
			"type":        label,
			"priority":    hk.Priority,
			"skillId":     hk.SkillID,
			"enabled":     m.registry.IsEnabled(hk.ID),
			"description": hk.Description,
		})
	}
	return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"hooks": items}}
}

func (m *HookModule) handleEnable(_ context.Context, req transport.Request) transport.Response {
	return m.handleStateMutation(req.ID, func() bool {
		var payload struct {
			ID string `json:"id"`
		}
		if req.Payload != nil {
			json.Unmarshal(req.Payload, &payload)
		}
		if !m.registry.SetEnabled(payload.ID, true) {
			return false
		}
		return m.stateStore.SetHookState(state.HookRuntimeState{ID: payload.ID, Enabled: true}) == nil
	}, "hook not found")
}

func (m *HookModule) handleDisable(_ context.Context, req transport.Request) transport.Response {
	return m.handleStateMutation(req.ID, func() bool {
		var payload struct {
			ID string `json:"id"`
		}
		if req.Payload != nil {
			json.Unmarshal(req.Payload, &payload)
		}
		if !m.registry.SetEnabled(payload.ID, false) {
			return false
		}
		return m.stateStore.SetHookState(state.HookRuntimeState{ID: payload.ID, Enabled: false}) == nil
	}, "hook not found")
}

func (m *HookModule) handleMetrics(_ context.Context, req transport.Request) transport.Response {
	metrics := m.registry.Metrics()
	items := make([]map[string]any, 0, len(m.registry.List()))
	for _, hk := range m.registry.List() {
		metric := metrics[hk.ID]
		items = append(items, map[string]any{
			"hookId":         hk.ID,
			"executionCount": metric.ExecutionCount,
			"errorCount":     metric.ErrorCount,
			"avgDuration":    metric.AvgDuration,
			"lastExecuted":   metric.LastExecuted,
		})
	}
	return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"metrics": items}}
}

func (m *HookModule) handleStateMutation(requestID string, mutate func() bool, missingErr string) transport.Response {
	if !mutate() {
		return transport.Response{ID: requestID, Success: false, Error: missingErr}
	}
	return transport.Response{ID: requestID, Success: true, Data: map[string]any{"ok": true}}
}

func hookTypeLabel(hookType Type) string {
	switch hookType {
	case PreTool:
		return "tool.pre"
	case PostTool:
		return "tool.post"
	default:
		return string(hookType)
	}
}
