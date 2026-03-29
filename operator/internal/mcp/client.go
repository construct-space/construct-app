// Package mcp implements MCP (Model Context Protocol) client integration.
// Operator acts as an MCP client, connecting to MCP servers to get tools.
// Follows the full spec:
// JSON-RPC 2.0, tools/resources/prompts, stdio + HTTP transports.
package mcp

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"strings"
	"sync"
	"sync/atomic"

	"construct-operator/internal/provider"
	"construct-operator/internal/tool"
)

// mcpConn abstracts the transport layer.
type mcpConn interface {
	Send(msg json.RawMessage) error
	Recv() (json.RawMessage, error)
	Close() error
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

func registerServerToolsLocked(registry *tool.Registry, serverID string, info *ServerInfo, client *Client) {
	for _, td := range info.Tools {
		registry.Register(&tool.Tool{
			Def:      td,
			Executor: &mcpToolExecutor{serverID: serverID, toolName: td.Name, client: client},
			Source:   "mcp:" + serverID,
		})
	}
}
