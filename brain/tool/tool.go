// Package tool defines brain's tool interface and a small registry.
// Core tools (read/write/edit/bash) live alongside; space-specific tools
// or skills register their own via Register.
package tool

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"

	"github.com/construct-space/brain/provider"
)

func sortToolInfo(v []ToolInfo) {
	sort.Slice(v, func(i, j int) bool { return v[i].Name < v[j].Name })
}

// Tool is the contract every tool implements. Input arrives as parsed
// JSON; Execute returns the string body the model sees back. An error
// surfaces as a tool_result with is_error=true.
type Tool interface {
	Name() string
	Description() string
	InputSchema() map[string]any
	Execute(ctx context.Context, input json.RawMessage) (string, error)
}

// ImagingResult is an optional interface a Tool may implement to attach
// images to its tool_result, so the model can actually look at what the
// tool produced (e.g. screenshot_window). The agent loop calls
// ResultImages with the successful Execute output; returning nil means no
// images. Providers without image-tool-result support fall back to the
// text body.
type ImagingResult interface {
	ResultImages(output string) []provider.ImageBlock
}

// Registry is goroutine-safe enough for the sidecar's read-mostly use.
// Register at startup, look up per call.
//
// Tools come in two flavors:
//
//   - **Visible**: shipped in every provider request's tools array.
//     Reserve for the irreducible core (read/write/edit/bash) plus the
//     meta-tools that drive discovery (list_tools, call_tool,
//     list_skills, load_skill).
//   - **Hidden**: registered the same way, callable via Execute by name,
//     but absent from AsProviderTools(). The model finds them via
//     list_tools and invokes them via call_tool. Saves ~25 schemas of
//     prompt overhead per turn.
//
// Pi-style: tools are capabilities, schemas are tax. Hide everything
// that isn't called on most turns.
type Registry struct {
	tools  map[string]Tool
	hidden map[string]bool
}

func NewRegistry() *Registry {
	return &Registry{
		tools:  make(map[string]Tool),
		hidden: make(map[string]bool),
	}
}

func (r *Registry) Register(t Tool) {
	r.tools[t.Name()] = t
	delete(r.hidden, t.Name())
}

// RegisterHidden registers a tool that's callable but excluded from the
// default tools[] array the provider sees. The model reaches it via
// call_tool after discovering it through list_tools.
func (r *Registry) RegisterHidden(t Tool) {
	r.tools[t.Name()] = t
	r.hidden[t.Name()] = true
}

func (r *Registry) Get(name string) (Tool, bool) {
	t, ok := r.tools[name]
	return t, ok
}

func (r *Registry) IsHidden(name string) bool {
	return r.hidden[name]
}

func (r *Registry) Names() []string {
	out := make([]string, 0, len(r.tools))
	for n := range r.tools {
		out = append(out, n)
	}
	return out
}

// AsProviderTools returns only the visible subset — what brain ships in
// the per-turn provider request. Hidden tools are reachable via
// call_tool but don't burn schema tokens here.
func (r *Registry) AsProviderTools() []provider.Tool {
	return r.AsProviderToolsForSurface("")
}

// AsProviderToolsForSurface is like AsProviderTools but also drops tools
// the current surface has opted out of. Pass "" to disable filtering.
func (r *Registry) AsProviderToolsForSurface(surface string) []provider.Tool {
	out := make([]provider.Tool, 0, len(r.tools))
	for name, t := range r.tools {
		if r.hidden[name] {
			continue
		}
		if !SurfaceAllows(surface, name) {
			continue
		}
		out = append(out, provider.Tool{
			Name:        t.Name(),
			Description: t.Description(),
			InputSchema: t.InputSchema(),
		})
	}
	return out
}

// ToolInfo is the lightweight projection list_tools returns. No
// input_schema — that's a quirk of call_tool semantics: the model
// passes raw args and brain validates at execution time. Keeps the
// discovery payload tiny.
type ToolInfo struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Hidden      bool   `json:"hidden,omitempty"`
}

// ListAll returns every tool, visible + hidden, sorted by name. Used by
// the list_tools meta-tool. Visible ones are tagged so the model can
// skip discovering tools it already has natively.
func (r *Registry) ListAll() []ToolInfo {
	out := make([]ToolInfo, 0, len(r.tools))
	for name, t := range r.tools {
		out = append(out, ToolInfo{
			Name:        t.Name(),
			Description: t.Description(),
			Hidden:      r.hidden[name],
		})
	}
	// Deterministic ordering keeps the cached prompt prefix stable
	// across turns when the model snapshots list_tools output.
	sortToolInfo(out)
	return out
}

// SchemaOf is used by call_tool when the model wants to inspect a
// hidden tool's input shape before calling it. Returns nil when the
// name isn't registered.
func (r *Registry) SchemaOf(name string) map[string]any {
	t, ok := r.tools[name]
	if !ok {
		return nil
	}
	return t.InputSchema()
}

// Execute runs a tool by name. Wraps unknown-tool and panics into errors
// so the agent loop never crashes from a misbehaving tool.
func (r *Registry) Execute(ctx context.Context, name string, input json.RawMessage) (result string, isError bool) {
	t, ok := r.Get(name)
	if !ok {
		return fmt.Sprintf("unknown tool: %s", name), true
	}
	// Surface-scoped refusal: even if a tool exists in the registry,
	// surfaces that opted out should not be able to call it (e.g. spacedev
	// asking for list_spaces, ask running space_graph_migrate). Empty
	// surface = no filtering, so legacy callers are unaffected.
	if surface := SurfaceFromCtx(ctx); surface != "" && !SurfaceAllows(surface, name) {
		return fmt.Sprintf("tool %s is not available on the %s surface", name, surface), true
	}
	if violations := Validate(t.InputSchema(), input); len(violations) > 0 {
		return FormatViolations(name, violations), true
	}
	defer func() {
		if rec := recover(); rec != nil {
			result = fmt.Sprintf("tool %s panicked: %v", name, rec)
			isError = true
		}
	}()
	out, err := t.Execute(ctx, input)
	if err != nil {
		return err.Error(), true
	}
	return out, false
}
