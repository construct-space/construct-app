package plugin

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"construct-operator/internal/hook"
	"construct-operator/internal/tool"
)

func writeManifest(t *testing.T, dir string, manifest PluginManifest) string {
	t.Helper()
	data, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "plugin.json")
	if err := os.WriteFile(path, data, 0644); err != nil {
		t.Fatal(err)
	}
	return path
}

func validManifest() PluginManifest {
	return PluginManifest{
		ID:         "test-plugin",
		Name:       "Test Plugin",
		Version:    "1.0.0",
		Type:       TypeTool,
		EntryPoint: "./run.sh",
		Tools: []PluginToolDef{
			{
				Name:        "test_tool",
				Description: "A test tool",
				InputSchema: map[string]any{
					"type": "object",
					"properties": map[string]any{
						"input": map[string]any{"type": "string"},
					},
				},
			},
		},
	}
}

func TestLoadManifest(t *testing.T) {
	dir := t.TempDir()
	path := writeManifest(t, dir, validManifest())

	m, err := LoadManifest(path)
	if err != nil {
		t.Fatalf("LoadManifest: %v", err)
	}

	if m.ID != "test-plugin" {
		t.Errorf("expected ID=test-plugin, got %q", m.ID)
	}
	if m.Name != "Test Plugin" {
		t.Errorf("expected Name=Test Plugin, got %q", m.Name)
	}
	if m.Version != "1.0.0" {
		t.Errorf("expected Version=1.0.0, got %q", m.Version)
	}
	if m.Type != TypeTool {
		t.Errorf("expected Type=tool, got %q", m.Type)
	}
	if m.EntryPoint != "./run.sh" {
		t.Errorf("expected EntryPoint=./run.sh, got %q", m.EntryPoint)
	}
	if len(m.Tools) != 1 {
		t.Fatalf("expected 1 tool, got %d", len(m.Tools))
	}
	if m.Tools[0].Name != "test_tool" {
		t.Errorf("expected tool name=test_tool, got %q", m.Tools[0].Name)
	}
}

func TestLoadManifestFileNotFound(t *testing.T) {
	_, err := LoadManifest("/nonexistent/plugin.json")
	if err == nil {
		t.Fatal("expected error for missing file")
	}
}

func TestLoadManifestInvalidJSON(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "plugin.json")
	os.WriteFile(path, []byte("{invalid"), 0644)

	_, err := LoadManifest(path)
	if err == nil {
		t.Fatal("expected error for invalid JSON")
	}
}

func TestLoadManifestMissingFields(t *testing.T) {
	tests := []struct {
		name     string
		manifest PluginManifest
	}{
		{"missing ID", PluginManifest{Name: "x", Version: "1", Type: TypeTool, EntryPoint: "./x"}},
		{"missing Name", PluginManifest{ID: "x", Version: "1", Type: TypeTool, EntryPoint: "./x"}},
		{"missing Version", PluginManifest{ID: "x", Name: "x", Type: TypeTool, EntryPoint: "./x"}},
		{"missing Type", PluginManifest{ID: "x", Name: "x", Version: "1", EntryPoint: "./x"}},
		{"missing EntryPoint", PluginManifest{ID: "x", Name: "x", Version: "1", Type: TypeTool}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			dir := t.TempDir()
			path := writeManifest(t, dir, tt.manifest)
			_, err := LoadManifest(path)
			if err == nil {
				t.Fatalf("expected error for %s", tt.name)
			}
		})
	}
}

func TestScanDir(t *testing.T) {
	dir := t.TempDir()

	// Create two plugin subdirectories
	pluginA := filepath.Join(dir, "plugin-a")
	pluginB := filepath.Join(dir, "plugin-b")
	noPlugin := filepath.Join(dir, "not-a-plugin")
	os.MkdirAll(pluginA, 0755)
	os.MkdirAll(pluginB, 0755)
	os.MkdirAll(noPlugin, 0755)

	mA := validManifest()
	mA.ID = "plugin-a"
	mA.Name = "Plugin A"
	writeManifest(t, pluginA, mA)

	mB := validManifest()
	mB.ID = "plugin-b"
	mB.Name = "Plugin B"
	mB.Type = TypeHook
	mB.Hooks = []PluginHookDef{
		{ID: "guard", Type: hook.PreTool, Tools: []string{"bash"}},
	}
	writeManifest(t, pluginB, mB)

	// noPlugin has no plugin.json — should be skipped

	manifests, err := ScanDir(dir)
	if err != nil {
		t.Fatalf("ScanDir: %v", err)
	}

	if len(manifests) != 2 {
		t.Fatalf("expected 2 manifests, got %d", len(manifests))
	}

	ids := make(map[string]bool)
	for _, m := range manifests {
		ids[m.ID] = true
		// Entry points should be resolved to absolute paths
		if !filepath.IsAbs(m.EntryPoint) {
			t.Errorf("expected absolute entry point for %s, got %q", m.ID, m.EntryPoint)
		}
	}
	if !ids["plugin-a"] {
		t.Error("missing plugin-a")
	}
	if !ids["plugin-b"] {
		t.Error("missing plugin-b")
	}
}

func TestScanDirNonexistent(t *testing.T) {
	manifests, err := ScanDir("/nonexistent/dir")
	if err != nil {
		t.Fatalf("ScanDir on nonexistent dir should not error: %v", err)
	}
	if manifests != nil {
		t.Fatalf("expected nil manifests for nonexistent dir, got %v", manifests)
	}
}

func TestScanDirSkipsBadManifests(t *testing.T) {
	dir := t.TempDir()

	// Good plugin
	good := filepath.Join(dir, "good")
	os.MkdirAll(good, 0755)
	writeManifest(t, good, validManifest())

	// Bad plugin (invalid JSON)
	bad := filepath.Join(dir, "bad")
	os.MkdirAll(bad, 0755)
	os.WriteFile(filepath.Join(bad, "plugin.json"), []byte("{broken"), 0644)

	manifests, err := ScanDir(dir)
	if err != nil {
		t.Fatalf("ScanDir: %v", err)
	}

	if len(manifests) != 1 {
		t.Fatalf("expected 1 manifest (skipping bad), got %d", len(manifests))
	}
	if manifests[0].ID != "test-plugin" {
		t.Errorf("expected good plugin, got %q", manifests[0].ID)
	}
}

func TestRegisterPluginTool(t *testing.T) {
	mgr := NewManager()
	toolReg := tool.NewRegistry()
	hookReg := hook.NewRegistry()

	manifest := &PluginManifest{
		ID:         "my-tool-plugin",
		Name:       "My Tool",
		Version:    "1.0.0",
		Type:       TypeTool,
		EntryPoint: "/usr/bin/my-tool",
		Tools: []PluginToolDef{
			{Name: "custom_search", Description: "Custom search"},
			{Name: "custom_format", Description: "Custom format"},
		},
	}

	err := mgr.RegisterPlugin(manifest, toolReg, hookReg)
	if err != nil {
		t.Fatalf("RegisterPlugin: %v", err)
	}

	// Tools should be registered with namespaced names: {plugin.id}:{tool.name}
	if _, ok := toolReg.Get("my-tool-plugin:custom_search"); !ok {
		t.Error("my-tool-plugin:custom_search tool should be registered")
	}
	if _, ok := toolReg.Get("my-tool-plugin:custom_format"); !ok {
		t.Error("my-tool-plugin:custom_format tool should be registered")
	}

	// Verify source
	st, _ := toolReg.Get("my-tool-plugin:custom_search")
	if st.Source != "plugin:my-tool-plugin" {
		t.Errorf("expected source=plugin:my-tool-plugin, got %q", st.Source)
	}

	// Plugin should be in manager
	p, ok := mgr.Get("my-tool-plugin")
	if !ok {
		t.Fatal("plugin should be in manager")
	}
	if p.Name != "My Tool" {
		t.Errorf("expected name=My Tool, got %q", p.Name)
	}
}

func TestRegisterPluginHook(t *testing.T) {
	mgr := NewManager()
	toolReg := tool.NewRegistry()
	hookReg := hook.NewRegistry()

	manifest := &PluginManifest{
		ID:         "guard-plugin",
		Name:       "Guard",
		Version:    "1.0.0",
		Type:       TypeHook,
		EntryPoint: "/usr/bin/guard",
		Hooks: []PluginHookDef{
			{
				ID:    "pre-check",
				Type:  hook.PreTool,
				Tools: []string{"bash", "write_file"},
			},
		},
	}

	err := mgr.RegisterPlugin(manifest, toolReg, hookReg)
	if err != nil {
		t.Fatalf("RegisterPlugin: %v", err)
	}

	hooks := hookReg.List()
	if len(hooks) != 1 {
		t.Fatalf("expected 1 hook, got %d", len(hooks))
	}

	h := hooks[0]
	if h.ID != "guard-plugin:pre-check" {
		t.Errorf("expected hook ID=guard-plugin:pre-check, got %q", h.ID)
	}
	if h.Type != hook.PreTool {
		t.Errorf("expected hook type=pre_tool, got %q", h.Type)
	}
	if h.Source != "plugin:guard-plugin" {
		t.Errorf("expected source=plugin:guard-plugin, got %q", h.Source)
	}
}

func TestRegisterPluginDuplicate(t *testing.T) {
	mgr := NewManager()

	manifest := &PluginManifest{
		ID:         "dup-plugin",
		Name:       "Dup",
		Version:    "1.0.0",
		Type:       TypeProvider,
		EntryPoint: "./run",
	}

	err := mgr.RegisterPlugin(manifest, nil, nil)
	if err != nil {
		t.Fatal(err)
	}

	err = mgr.RegisterPlugin(manifest, nil, nil)
	if err == nil {
		t.Fatal("expected error for duplicate registration")
	}
}

func TestRegisterPluginNil(t *testing.T) {
	mgr := NewManager()
	err := mgr.RegisterPlugin(nil, nil, nil)
	if err == nil {
		t.Fatal("expected error for nil manifest")
	}
}

func TestManagerList(t *testing.T) {
	mgr := NewManager()

	if len(mgr.List()) != 0 {
		t.Fatal("expected empty list")
	}

	mgr.RegisterPlugin(&PluginManifest{
		ID: "p1", Name: "P1", Version: "1", Type: TypeTool, EntryPoint: "./x",
	}, nil, nil)
	mgr.RegisterPlugin(&PluginManifest{
		ID: "p2", Name: "P2", Version: "1", Type: TypeTool, EntryPoint: "./x",
	}, nil, nil)

	plugins := mgr.List()
	if len(plugins) != 2 {
		t.Fatalf("expected 2 plugins, got %d", len(plugins))
	}
}

func TestManagerGet(t *testing.T) {
	mgr := NewManager()

	_, ok := mgr.Get("nonexistent")
	if ok {
		t.Fatal("expected not found for nonexistent plugin")
	}

	mgr.RegisterPlugin(&PluginManifest{
		ID: "find-me", Name: "FM", Version: "1", Type: TypeTool, EntryPoint: "./x",
	}, nil, nil)

	p, ok := mgr.Get("find-me")
	if !ok {
		t.Fatal("expected to find plugin")
	}
	if p.ID != "find-me" {
		t.Errorf("expected ID=find-me, got %q", p.ID)
	}
}

func TestRegisterPluginNilRegistries(t *testing.T) {
	mgr := NewManager()

	// Tool plugin with nil tool registry should not panic
	manifest := &PluginManifest{
		ID:         "safe-plugin",
		Name:       "Safe",
		Version:    "1.0.0",
		Type:       TypeTool,
		EntryPoint: "./x",
		Tools: []PluginToolDef{
			{Name: "test", Description: "test"},
		},
	}

	err := mgr.RegisterPlugin(manifest, nil, nil)
	if err != nil {
		t.Fatalf("should not error with nil registries: %v", err)
	}

	// Hook plugin with nil hook registry should not panic
	manifest2 := &PluginManifest{
		ID:         "safe-hook",
		Name:       "Safe Hook",
		Version:    "1.0.0",
		Type:       TypeHook,
		EntryPoint: "./x",
		Hooks: []PluginHookDef{
			{ID: "h1", Type: hook.PreTool},
		},
	}

	err = mgr.RegisterPlugin(manifest2, nil, nil)
	if err != nil {
		t.Fatalf("should not error with nil hook registry: %v", err)
	}
}

func TestPluginTypes(t *testing.T) {
	if TypeTool != "tool" {
		t.Errorf("TypeTool = %q", TypeTool)
	}
	if TypeProvider != "provider" {
		t.Errorf("TypeProvider = %q", TypeProvider)
	}
	if TypeHook != "hook" {
		t.Errorf("TypeHook = %q", TypeHook)
	}
}
