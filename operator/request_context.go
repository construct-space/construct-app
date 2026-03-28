package main

import (
	"context"

	"construct-operator/internal/runner"
)

type clientContextState struct {
	Mode      string
	Component map[string]any
	Selection map[string]any
	Timestamp string
}

type requestProjectOverrideKey struct{}

func withProjectOverride(ctx context.Context, project *runner.ProjectContext) context.Context {
	if project == nil {
		return ctx
	}
	return context.WithValue(ctx, requestProjectOverrideKey{}, project)
}

func projectOverrideFromContext(ctx context.Context) *runner.ProjectContext {
	project, _ := ctx.Value(requestProjectOverrideKey{}).(*runner.ProjectContext)
	return project
}

func cloneMap(input map[string]any) map[string]any {
	if len(input) == 0 {
		return nil
	}
	result := make(map[string]any, len(input))
	for key, value := range input {
		result[key] = value
	}
	return result
}

func mapString(m map[string]any, key string) string {
	value, _ := m[key].(string)
	return value
}
