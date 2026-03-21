package mcp

import (
	"os"
	"path/filepath"
	"testing"

	"construct-operator/internal/tool"
)

func TestClientAddAndList(t *testing.T) {
	c := NewClient()
	c.Add(ServerConfig{ID: "test", Name: "Test Server", Type: TypeStdio, Command: "echo"})

	servers := c.List()
	if len(servers) != 1 {
		t.Fatalf("expected 1 server, got %d", len(servers))
	}
	if servers[0].Config.ID != "test" {
		t.Fatalf("expected ID %q, got %q", "test", servers[0].Config.ID)
	}
	if servers[0].Status != "disconnected" {
		t.Fatalf("expected status %q, got %q", "disconnected", servers[0].Status)
	}
}

func TestRegisterToolsOnlyRunning(t *testing.T) {
	c := NewClient()
	c.Add(ServerConfig{ID: "off", Name: "Offline", Type: TypeStdio})

	reg := tool.NewRegistry()
	c.RegisterTools(reg)

	if len(reg.All()) != 0 {
		t.Fatal("should not register tools from disconnected servers")
	}
}

func TestLoadConfig(t *testing.T) {
	dir := t.TempDir()
	cfgPath := filepath.Join(dir, "mcp.json")

	config := `{
		"mcpServers": {
			"filesystem": {
				"type": "stdio",
				"command": "npx",
				"args": ["-y", "@modelcontextprotocol/server-filesystem"],
				"env": {"MCP_ROOT": "/tmp"}
			},
			"remote": {
				"type": "http",
				"url": "https://mcp.example.com/api"
			}
		}
	}`
	os.WriteFile(cfgPath, []byte(config), 0644)

	configs, err := LoadConfig(cfgPath)
	if err != nil {
		t.Fatalf("LoadConfig failed: %v", err)
	}
	if len(configs) != 2 {
		t.Fatalf("expected 2 configs, got %d", len(configs))
	}

	found := map[string]bool{}
	for _, c := range configs {
		found[c.ID] = true
		if c.ID == "filesystem" {
			if c.Type != TypeStdio {
				t.Fatalf("expected type %q, got %q", TypeStdio, c.Type)
			}
			if c.Command != "npx" {
				t.Fatalf("expected command %q, got %q", "npx", c.Command)
			}
			if c.Env["MCP_ROOT"] != "/tmp" {
				t.Fatal("env MCP_ROOT should be /tmp")
			}
		}
		if c.ID == "remote" {
			if c.Type != TypeHTTP {
				t.Fatalf("expected type %q, got %q", TypeHTTP, c.Type)
			}
			if c.URL != "https://mcp.example.com/api" {
				t.Fatal("URL mismatch")
			}
		}
	}
	if !found["filesystem"] || !found["remote"] {
		t.Fatal("missing expected servers")
	}
}

func TestLoadConfigNotFound(t *testing.T) {
	configs, err := LoadConfig("/nonexistent/mcp.json")
	if err != nil {
		t.Fatalf("should not error on missing file: %v", err)
	}
	if configs != nil {
		t.Fatal("should return nil for missing file")
	}
}

func TestLoadAllConfigs(t *testing.T) {
	dir := t.TempDir()
	spacesDir := filepath.Join(dir, "spaces")
	os.MkdirAll(filepath.Join(spacesDir, "myspace"), 0755)

	// Space config
	spaceConfig := `{"mcpServers": {"space-tool": {"type": "stdio", "command": "cat"}}}`
	os.WriteFile(filepath.Join(spacesDir, "myspace", "mcp.json"), []byte(spaceConfig), 0644)

	// User config
	userDir := filepath.Join(dir, "config")
	os.MkdirAll(userDir, 0755)
	userConfig := `{"mcpServers": {"user-tool": {"type": "http", "url": "http://localhost:3000"}}}`
	os.WriteFile(filepath.Join(userDir, "mcp.json"), []byte(userConfig), 0644)

	configs := LoadAllConfigs([]string{spacesDir}, userDir)
	if len(configs) != 2 {
		t.Fatalf("expected 2 configs, got %d", len(configs))
	}
}
