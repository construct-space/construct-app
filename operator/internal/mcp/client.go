// Package mcp implements MCP (Model Context Protocol) client integration.
// Operator acts as an MCP client, connecting to MCP servers to get tools.
// Follows the full spec:
// JSON-RPC 2.0, tools/resources/prompts, stdio + HTTP transports.
package mcp

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"sync/atomic"

	"construct-operator/internal/provider"
	"construct-operator/internal/tool"
)

// ServerType is how the MCP server is connected.
type ServerType string

const (
	TypeStdio ServerType = "stdio" // Local process via stdin/stdout
	TypeHTTP  ServerType = "http"  // HTTP+SSE transport
	TypeURL   ServerType = "url"   // Streamable HTTP (new spec)
)

// ServerConfig describes an MCP server to connect to.
type ServerConfig struct {
	ID        string            `json:"id"`
	Name      string            `json:"name"`
	Type      ServerType        `json:"type"`
	Command   string            `json:"command,omitempty"` // For stdio
	Args      []string          `json:"args,omitempty"`    // For stdio
	URL       string            `json:"url,omitempty"`     // For http/url
	Env       map[string]string `json:"env,omitempty"`     // Environment vars
	Enabled   bool              `json:"enabled"`
	Kind      string            `json:"kind,omitempty"`      // url, npm, local, builtin
	Package   string            `json:"package,omitempty"`   // npm package name
	Path      string            `json:"path,omitempty"`      // local executable path
	Transport string            `json:"transport,omitempty"` // ui-facing transport: http, sse, stdio
	Source    string            `json:"-"`                   // user or space:<id>
}

// ServerInfo is the runtime state of a connected MCP server.
type ServerInfo struct {
	Config ServerConfig       `json:"config"`
	Status string             `json:"status"` // disconnected, connecting, running, error
	Tools  []provider.ToolDef `json:"tools,omitempty"`
	Error  string             `json:"error,omitempty"`
	conn   mcpConn            // transport connection (stdio or HTTP)
}

// mcpConn abstracts the transport layer.
type mcpConn interface {
	Send(msg json.RawMessage) error
	Recv() (json.RawMessage, error)
	Close() error
}

// JSON-RPC 2.0 types
type jsonRPCRequest struct {
	JSONRPC string `json:"jsonrpc"`
	ID      int64  `json:"id"`
	Method  string `json:"method"`
	Params  any    `json:"params,omitempty"`
}

type jsonRPCResponse struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      int64           `json:"id"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   *jsonRPCError   `json:"error,omitempty"`
}

type jsonRPCError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

// Client manages connections to MCP servers and exposes their tools.
type Client struct {
	mu      sync.RWMutex
	servers map[string]*ServerInfo
	nextID  atomic.Int64
}

func NewClient() *Client {
	return &Client{
		servers: make(map[string]*ServerInfo),
	}
}

// Add registers an MCP server config.
func (c *Client) Add(cfg ServerConfig) {
	c.mu.Lock()
	defer c.mu.Unlock()

	cfg = normalizeConfig(cfg)
	if existing, ok := c.servers[cfg.ID]; ok {
		if existing.conn != nil {
			_ = existing.conn.Close()
		}
		existing.Config = cfg
		existing.Status = "disconnected"
		existing.Tools = nil
		existing.Error = ""
		existing.conn = nil
		return
	}
	c.servers[cfg.ID] = &ServerInfo{Config: cfg, Status: "disconnected"}
}

// Connect starts the MCP server and discovers its tools.
func (c *Client) Connect(ctx context.Context, id string) error {
	c.mu.Lock()
	info, ok := c.servers[id]
	if !ok {
		c.mu.Unlock()
		return fmt.Errorf("mcp server %q not found", id)
	}
	if info.conn != nil && info.Status == "running" {
		c.mu.Unlock()
		return nil
	}
	info.Status = "connecting"
	info.Error = ""
	c.mu.Unlock()

	var conn mcpConn
	var err error

	switch info.Config.Type {
	case TypeStdio:
		conn, err = newStdioConn(ctx, info.Config)
	case TypeHTTP, TypeURL:
		conn, err = newHTTPConn(info.Config)
	default:
		err = fmt.Errorf("unsupported transport type: %s", info.Config.Type)
	}

	if err != nil {
		c.mu.Lock()
		info.Status = "error"
		info.Error = err.Error()
		c.mu.Unlock()
		return err
	}

	c.mu.Lock()
	info.conn = conn
	c.mu.Unlock()

	// Initialize
	if err := c.initialize(info); err != nil {
		c.mu.Lock()
		info.Status = "error"
		info.Error = err.Error()
		c.mu.Unlock()
		conn.Close()
		return err
	}

	// Discover tools
	tools, err := c.listTools(info)
	if err != nil {
		c.mu.Lock()
		info.Status = "error"
		info.Error = err.Error()
		c.mu.Unlock()
		conn.Close()
		return err
	}

	c.mu.Lock()
	info.Tools = tools
	info.Status = "running"
	c.mu.Unlock()

	fmt.Fprintf(os.Stderr, "[mcp] connected to %s (%d tools)\n", id, len(tools))
	return nil
}

// Disconnect stops an MCP server connection.
func (c *Client) Disconnect(id string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	info, ok := c.servers[id]
	if !ok {
		return
	}
	if info.conn != nil {
		_ = info.conn.Close()
		info.conn = nil
	}
	info.Status = "disconnected"
	info.Tools = nil
	info.Error = ""
}

// Remove deletes an MCP server from the client and closes any active connection.
func (c *Client) Remove(id string) {
	c.mu.Lock()
	defer c.mu.Unlock()

	info, ok := c.servers[id]
	if !ok {
		return
	}
	if info.conn != nil {
		_ = info.conn.Close()
	}
	delete(c.servers, id)
}

// Get returns a copy of a server's current runtime info.
func (c *Client) Get(id string) (ServerInfo, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()

	info, ok := c.servers[id]
	if !ok {
		return ServerInfo{}, false
	}
	return *info, true
}

func (c *Client) initialize(info *ServerInfo) error {
	resp, err := c.call(info, "initialize", map[string]any{
		"protocolVersion": "2024-11-05",
		"capabilities":    map[string]any{},
		"clientInfo": map[string]any{
			"name":    "construct-operator",
			"version": "0.2.0",
		},
	})
	if err != nil {
		return fmt.Errorf("initialize: %w", err)
	}

	// Send initialized notification
	notif, _ := json.Marshal(jsonRPCRequest{
		JSONRPC: "2.0",
		Method:  "notifications/initialized",
	})
	info.conn.Send(notif)

	_ = resp // Could parse server capabilities here
	return nil
}

func (c *Client) listTools(info *ServerInfo) ([]provider.ToolDef, error) {
	resp, err := c.call(info, "tools/list", nil)
	if err != nil {
		return nil, fmt.Errorf("tools/list: %w", err)
	}

	var result struct {
		Tools []struct {
			Name        string `json:"name"`
			Description string `json:"description"`
			InputSchema any    `json:"inputSchema"`
		} `json:"tools"`
	}
	if err := json.Unmarshal(resp, &result); err != nil {
		return nil, fmt.Errorf("parse tools: %w", err)
	}

	defs := make([]provider.ToolDef, len(result.Tools))
	for i, t := range result.Tools {
		defs[i] = provider.ToolDef{
			Name:        fmt.Sprintf("mcp-%s-%s", info.Config.ID, t.Name),
			Description: t.Description,
			InputSchema: t.InputSchema,
		}
	}
	return defs, nil
}

// CallTool invokes a tool on an MCP server.
func (c *Client) CallTool(ctx context.Context, serverID, toolName, input string) (string, error) {
	c.mu.RLock()
	info, ok := c.servers[serverID]
	c.mu.RUnlock()
	if !ok || info.conn == nil {
		return "", fmt.Errorf("mcp server %q not connected", serverID)
	}

	var args any
	if input != "" {
		json.Unmarshal([]byte(input), &args)
	}

	// Strip the mcp-{serverID}- prefix to get the original tool name
	origName := toolName
	prefix := fmt.Sprintf("mcp-%s-", serverID)
	if strings.HasPrefix(toolName, prefix) {
		origName = strings.TrimPrefix(toolName, prefix)
	}

	resp, err := c.call(info, "tools/call", map[string]any{
		"name":      origName,
		"arguments": args,
	})
	if err != nil {
		return "", err
	}

	var result struct {
		Content []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"content"`
		IsError bool `json:"isError"`
	}
	if err := json.Unmarshal(resp, &result); err != nil {
		return string(resp), nil
	}

	var texts []string
	for _, c := range result.Content {
		if c.Type == "text" {
			texts = append(texts, c.Text)
		}
	}
	return strings.Join(texts, "\n"), nil
}

func (c *Client) call(info *ServerInfo, method string, params any) (json.RawMessage, error) {
	id := c.nextID.Add(1)
	req := jsonRPCRequest{
		JSONRPC: "2.0",
		ID:      id,
		Method:  method,
		Params:  params,
	}
	data, _ := json.Marshal(req)
	if err := info.conn.Send(data); err != nil {
		return nil, fmt.Errorf("send %s: %w", method, err)
	}

	// Read response (skip notifications)
	for {
		respData, err := info.conn.Recv()
		if err != nil {
			return nil, fmt.Errorf("recv %s: %w", method, err)
		}

		var resp jsonRPCResponse
		if err := json.Unmarshal(respData, &resp); err != nil {
			continue
		}

		// Skip notifications (no id)
		if resp.ID == 0 && resp.Result == nil && resp.Error == nil {
			continue
		}

		if resp.ID == id {
			if resp.Error != nil {
				return nil, fmt.Errorf("rpc error %d: %s", resp.Error.Code, resp.Error.Message)
			}
			return resp.Result, nil
		}
	}
}

// RegisterTools adds all connected MCP server tools to the tool registry.
func (c *Client) RegisterTools(registry *tool.Registry) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	for serverID, info := range c.servers {
		if info.Status != "running" {
			continue
		}
		registerServerToolsLocked(registry, serverID, info, c)
	}
}

// RegisterServerTools adds a single connected server's tools to the tool registry.
func (c *Client) RegisterServerTools(registry *tool.Registry, id string) bool {
	c.mu.RLock()
	defer c.mu.RUnlock()

	info, ok := c.servers[id]
	if !ok || info.Status != "running" {
		return false
	}
	registerServerToolsLocked(registry, id, info, c)
	return true
}

// List returns all server infos.
func (c *Client) List() []ServerInfo {
	c.mu.RLock()
	defer c.mu.RUnlock()
	result := make([]ServerInfo, 0, len(c.servers))
	for _, info := range c.servers {
		result = append(result, *info)
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].Config.ID < result[j].Config.ID
	})
	return result
}

// mcpToolExecutor calls a tool on an MCP server.
type mcpToolExecutor struct {
	serverID string
	toolName string
	client   *Client
}

func (e *mcpToolExecutor) Execute(ctx context.Context, input string) (*tool.Result, error) {
	content, err := e.client.CallTool(ctx, e.serverID, e.toolName, input)
	if err != nil {
		return &tool.Result{Content: err.Error(), IsError: true}, nil
	}
	return &tool.Result{Content: content}, nil
}

// --- stdio transport ---

type stdioConn struct {
	cmd    *exec.Cmd
	stdin  io.WriteCloser
	reader *bufio.Reader
	mu     sync.Mutex
}

func newStdioConn(ctx context.Context, cfg ServerConfig) (*stdioConn, error) {
	cmd := exec.CommandContext(ctx, cfg.Command, cfg.Args...)

	// Set environment
	cmd.Env = os.Environ()
	for k, v := range cfg.Env {
		cmd.Env = append(cmd.Env, k+"="+v)
	}

	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, fmt.Errorf("stdin pipe: %w", err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("stdout pipe: %w", err)
	}
	cmd.Stderr = os.Stderr

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("start %s: %w", cfg.Command, err)
	}

	return &stdioConn{
		cmd:    cmd,
		stdin:  stdin,
		reader: bufio.NewReader(stdout),
	}, nil
}

func (c *stdioConn) Send(msg json.RawMessage) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	_, err := c.stdin.Write(append(msg, '\n'))
	return err
}

func (c *stdioConn) Recv() (json.RawMessage, error) {
	line, err := c.reader.ReadBytes('\n')
	if err != nil {
		return nil, err
	}
	return json.RawMessage(bytes.TrimSpace(line)), nil
}

func (c *stdioConn) Close() error {
	c.stdin.Close()
	return c.cmd.Process.Kill()
}

// --- HTTP transport ---

type httpConn struct {
	url    string
	client *http.Client
	mu     sync.Mutex
	respCh chan json.RawMessage
}

func newHTTPConn(cfg ServerConfig) (*httpConn, error) {
	url := cfg.URL
	if url == "" {
		return nil, fmt.Errorf("URL required for HTTP transport")
	}
	return &httpConn{
		url:    url,
		client: &http.Client{},
		respCh: make(chan json.RawMessage, 64),
	}, nil
}

func (c *httpConn) Send(msg json.RawMessage) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	resp, err := c.client.Post(c.url, "application/json", bytes.NewReader(msg))
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	// If response has content, parse it
	if resp.StatusCode == http.StatusOK {
		body, err := io.ReadAll(resp.Body)
		if err != nil {
			return err
		}
		if len(body) > 0 {
			c.respCh <- json.RawMessage(body)
		}
	}
	return nil
}

func (c *httpConn) Recv() (json.RawMessage, error) {
	msg, ok := <-c.respCh
	if !ok {
		return nil, fmt.Errorf("connection closed")
	}
	return msg, nil
}

func (c *httpConn) Close() error {
	close(c.respCh)
	return nil
}

// --- Config loading ---

// MCPConfig is the format of mcp.json files.
type MCPConfig struct {
	Servers map[string]rawServerConfig `json:"mcpServers"`
}

type rawServerConfig struct {
	ID        string            `json:"id"`
	Name      string            `json:"name"`
	Type      ServerType        `json:"type"`
	Command   string            `json:"command,omitempty"`
	Args      []string          `json:"args,omitempty"`
	URL       string            `json:"url,omitempty"`
	Env       map[string]string `json:"env,omitempty"`
	Enabled   *bool             `json:"enabled,omitempty"`
	Kind      string            `json:"kind,omitempty"`
	Package   string            `json:"package,omitempty"`
	Path      string            `json:"path,omitempty"`
	Transport string            `json:"transport,omitempty"`
}

// LoadConfig reads an mcp.json file and returns server configs.
func LoadConfig(path string) ([]ServerConfig, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}

	var cfg MCPConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("parse %s: %w", path, err)
	}

	var configs []ServerConfig
	for id, sc := range cfg.Servers {
		enabled := true
		if sc.Enabled != nil {
			enabled = *sc.Enabled
		}
		configs = append(configs, normalizeConfig(ServerConfig{
			ID:        firstNonEmpty(sc.ID, id),
			Name:      firstNonEmpty(sc.Name, id),
			Type:      sc.Type,
			Command:   sc.Command,
			Args:      sc.Args,
			URL:       sc.URL,
			Env:       sc.Env,
			Enabled:   enabled,
			Kind:      sc.Kind,
			Package:   sc.Package,
			Path:      sc.Path,
			Transport: sc.Transport,
		}))
	}
	sort.Slice(configs, func(i, j int) bool { return configs[i].ID < configs[j].ID })
	return configs, nil
}

// SaveConfig writes user-managed MCP servers back to mcp.json.
func SaveConfig(path string, configs []ServerConfig) error {
	if path == "" {
		return fmt.Errorf("path is required")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}

	cfg := MCPConfig{Servers: make(map[string]rawServerConfig, len(configs))}
	sort.Slice(configs, func(i, j int) bool { return configs[i].ID < configs[j].ID })
	for _, sc := range configs {
		sc = normalizeConfig(sc)
		enabled := sc.Enabled
		cfg.Servers[sc.ID] = rawServerConfig{
			ID:        sc.ID,
			Name:      sc.Name,
			Type:      sc.Type,
			Command:   sc.Command,
			Args:      sc.Args,
			URL:       sc.URL,
			Env:       sc.Env,
			Enabled:   &enabled,
			Kind:      sc.Kind,
			Package:   sc.Package,
			Path:      sc.Path,
			Transport: sc.Transport,
		}
	}

	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// LoadAllConfigs loads MCP configs from all space directories and user config.
// spacesDirs should include all directories from appdir.AllSpacesDirs() so that
// spaces provided via CONSTRUCT_SPACES_PATH are not silently ignored.
func LoadAllConfigs(spacesDirs []string, userConfigDir string) []ServerConfig {
	var all []ServerConfig

	// Load from all space directories
	for _, spacesDir := range spacesDirs {
		if entries, err := os.ReadDir(spacesDir); err == nil {
			for _, e := range entries {
				if !e.IsDir() {
					continue
				}
				cfgPath := filepath.Join(spacesDir, e.Name(), "mcp.json")
				if configs, err := LoadConfig(cfgPath); err == nil {
					for i := range configs {
						configs[i].Source = "space:" + e.Name()
						configs[i] = normalizeConfig(configs[i])
					}
					all = append(all, configs...)
				}
			}
		}
	}

	// Load from user config
	if userConfigDir != "" {
		cfgPath := filepath.Join(userConfigDir, "mcp.json")
		if configs, err := LoadConfig(cfgPath); err == nil {
			for i := range configs {
				configs[i].Source = "user"
				configs[i] = normalizeConfig(configs[i])
			}
			all = append(all, configs...)
		}
	}

	sort.Slice(all, func(i, j int) bool { return all[i].ID < all[j].ID })
	return all
}

func registerServerToolsLocked(registry *tool.Registry, serverID string, info *ServerInfo, client *Client) {
	for _, td := range info.Tools {
		registry.Register(&tool.Tool{
			Def:      td,
			Executor: &mcpToolExecutor{serverID: serverID, toolName: td.Name, client: client},
			Source:   "mcp:" + serverID,
		})
	}
}

func normalizeConfig(cfg ServerConfig) ServerConfig {
	if cfg.ID != "" && cfg.Name == "" {
		cfg.Name = cfg.ID
	}
	if cfg.Kind == "" {
		switch {
		case cfg.Package != "":
			cfg.Kind = "npm"
		case cfg.Path != "":
			cfg.Kind = "local"
		case cfg.URL != "":
			cfg.Kind = "url"
		case cfg.Source != "" && cfg.Source != "user":
			cfg.Kind = "builtin"
		case strings.EqualFold(filepath.Base(cfg.Command), "npx"):
			cfg.Kind = "npm"
		case cfg.Command != "":
			cfg.Kind = "local"
		}
	}
	if cfg.Package == "" && cfg.Kind == "npm" {
		for i := len(cfg.Args) - 1; i >= 0; i-- {
			arg := strings.TrimSpace(cfg.Args[i])
			if arg == "" || strings.HasPrefix(arg, "-") {
				continue
			}
			cfg.Package = arg
			break
		}
	}
	if cfg.Path == "" && cfg.Kind == "local" {
		cfg.Path = cfg.Command
	}
	if cfg.Transport == "" {
		switch cfg.Type {
		case TypeHTTP:
			cfg.Transport = "sse"
		case TypeURL:
			cfg.Transport = "http"
		default:
			cfg.Transport = "stdio"
		}
	}
	if cfg.Type == "" {
		switch cfg.Transport {
		case "http":
			cfg.Type = TypeURL
		case "sse":
			cfg.Type = TypeHTTP
		default:
			cfg.Type = TypeStdio
		}
	}
	return cfg
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}
