package lsp

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"maps"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// Client is a JSON-RPC 2.0 LSP client speaking over the server's stdio.
// One Client per (workspace, language). Safe for concurrent use.
type Client struct {
	cfg ServerConfig

	cmd    *exec.Cmd
	stdin  io.WriteCloser
	stdout *bufio.Reader

	writeMu sync.Mutex // serialises writes on stdin

	pendMu  sync.Mutex
	pending map[int64]chan rpcResult
	nextID  atomic.Int64

	docMu    sync.Mutex
	openDocs map[string]int // uri -> version

	diagMu      sync.RWMutex
	diagnostics map[string][]Diagnostic // uri -> diagnostics

	lastUsed atomic.Int64 // unix nano of most recent call (for idle GC)
	dead     atomic.Bool
}

type rpcResult struct {
	result json.RawMessage
	err    string
}

// Connect spawns the server, starts the read loop, and runs the initialize
// handshake. If initialize fails the process is killed before returning.
func Connect(cfg ServerConfig) (*Client, error) {
	cmd := exec.Command(cfg.Command, cfg.Args...)
	if cfg.WorkspaceRoot != "" {
		cmd.Dir = cfg.WorkspaceRoot
	}
	cmd.Env = append(os.Environ(), cfg.Env...)
	cmd.Stderr = io.Discard

	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, fmt.Errorf("lsp stdin: %w", err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("lsp stdout: %w", err)
	}
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("lsp start %s: %w", cfg.Command, err)
	}

	c := &Client{
		cfg:         cfg,
		cmd:         cmd,
		stdin:       stdin,
		stdout:      bufio.NewReaderSize(stdout, 256*1024),
		pending:     make(map[int64]chan rpcResult),
		openDocs:    make(map[string]int),
		diagnostics: make(map[string][]Diagnostic),
	}
	c.nextID.Store(1)
	c.touch()

	go c.readLoop()

	if err := c.initialize(); err != nil {
		c.Shutdown()
		return nil, fmt.Errorf("lsp initialize %s: %w", cfg.Name, err)
	}
	return c, nil
}

func (c *Client) touch() {
	c.lastUsed.Store(time.Now().UnixNano())
}

// IdleFor reports how long since the last successful tool call.
func (c *Client) IdleFor() time.Duration {
	return time.Duration(time.Now().UnixNano() - c.lastUsed.Load())
}

func (c *Client) initialize() error {
	rootURI := fileURI(c.cfg.WorkspaceRoot)
	params := map[string]any{
		"processId": os.Getpid(),
		"rootUri":   rootURI,
		"rootPath":  c.cfg.WorkspaceRoot,
		"workspaceFolders": []map[string]any{
			{"uri": rootURI, "name": filepath.Base(c.cfg.WorkspaceRoot)},
		},
		"capabilities": map[string]any{
			"textDocument": map[string]any{
				"publishDiagnostics": map[string]any{"relatedInformation": true},
				"definition":         map[string]any{"linkSupport": true},
				"references":         map[string]any{},
				"callHierarchy":      map[string]any{"dynamicRegistration": false},
			},
			"workspace": map[string]any{
				"workspaceFolders": true,
			},
		},
	}
	if c.cfg.InitOptions != nil {
		params["initializationOptions"] = c.cfg.InitOptions
	}
	if _, err := c.request("initialize", params); err != nil {
		return err
	}
	return c.notify("initialized", map[string]any{})
}

// OpenDocument sends textDocument/didOpen for path.
func (c *Client) OpenDocument(path string) error {
	content, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	uri := fileURI(path)

	c.docMu.Lock()
	c.openDocs[uri] = 1
	c.docMu.Unlock()

	return c.notify("textDocument/didOpen", map[string]any{
		"textDocument": map[string]any{
			"uri":        uri,
			"languageId": c.cfg.LanguageID(path),
			"version":    1,
			"text":       string(content),
		},
	})
}

// SyncDocument re-reads disk and sends didChange + didSave; opens the doc
// first if the server hasn't seen it yet.
func (c *Client) SyncDocument(path string) error {
	content, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	uri := fileURI(path)

	c.docMu.Lock()
	ver, open := c.openDocs[uri]
	if !open {
		c.docMu.Unlock()
		return c.OpenDocument(path)
	}
	ver++
	c.openDocs[uri] = ver
	c.docMu.Unlock()

	if err := c.notify("textDocument/didChange", map[string]any{
		"textDocument":   map[string]any{"uri": uri, "version": ver},
		"contentChanges": []map[string]any{{"text": string(content)}},
	}); err != nil {
		return err
	}
	return c.notify("textDocument/didSave", map[string]any{
		"textDocument": map[string]any{"uri": uri},
	})
}

func (c *Client) ensureOpen(path string) error {
	uri := fileURI(path)
	c.docMu.Lock()
	_, open := c.openDocs[uri]
	c.docMu.Unlock()
	if open {
		return nil
	}
	return c.OpenDocument(path)
}

// GoToDefinition returns definition locations for a (path, line, character)
// position. Line/character are LSP-style (0-indexed).
func (c *Client) GoToDefinition(path string, line, character int) ([]Location, error) {
	if err := c.ensureOpen(path); err != nil {
		return nil, err
	}
	raw, err := c.request("textDocument/definition", map[string]any{
		"textDocument": map[string]any{"uri": fileURI(path)},
		"position":     map[string]any{"line": line, "character": character},
	})
	if err != nil {
		return nil, err
	}
	c.touch()
	return parseLocations(raw)
}

// FindReferences returns all references to the symbol under the cursor.
func (c *Client) FindReferences(path string, line, character int, includeDecl bool) ([]Location, error) {
	if err := c.ensureOpen(path); err != nil {
		return nil, err
	}
	raw, err := c.request("textDocument/references", map[string]any{
		"textDocument": map[string]any{"uri": fileURI(path)},
		"position":     map[string]any{"line": line, "character": character},
		"context":      map[string]any{"includeDeclaration": includeDecl},
	})
	if err != nil {
		return nil, err
	}
	c.touch()
	return parseLocations(raw)
}

// PrepareCallHierarchy returns the items at the given position that can be
// used as anchors for incomingCalls/outgoingCalls. LSP-3.17.
func (c *Client) PrepareCallHierarchy(path string, line, character int) ([]CallHierarchyItem, error) {
	if err := c.ensureOpen(path); err != nil {
		return nil, err
	}
	raw, err := c.request("textDocument/prepareCallHierarchy", map[string]any{
		"textDocument": map[string]any{"uri": fileURI(path)},
		"position":     map[string]any{"line": line, "character": character},
	})
	if err != nil {
		return nil, err
	}
	c.touch()
	if len(raw) == 0 || string(raw) == "null" {
		return nil, nil
	}
	var items []CallHierarchyItem
	if err := json.Unmarshal(raw, &items); err != nil {
		return nil, fmt.Errorf("prepareCallHierarchy decode: %w", err)
	}
	return items, nil
}

// IncomingCalls fetches callers of an item returned by PrepareCallHierarchy.
func (c *Client) IncomingCalls(item CallHierarchyItem) ([]CallHierarchyCall, error) {
	raw, err := c.request("callHierarchy/incomingCalls", map[string]any{"item": item})
	if err != nil {
		return nil, err
	}
	c.touch()
	return decodeCalls(raw)
}

// OutgoingCalls fetches callees of an item returned by PrepareCallHierarchy.
func (c *Client) OutgoingCalls(item CallHierarchyItem) ([]CallHierarchyCall, error) {
	raw, err := c.request("callHierarchy/outgoingCalls", map[string]any{"item": item})
	if err != nil {
		return nil, err
	}
	c.touch()
	return decodeCalls(raw)
}

func decodeCalls(raw json.RawMessage) ([]CallHierarchyCall, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return nil, nil
	}
	var calls []CallHierarchyCall
	if err := json.Unmarshal(raw, &calls); err != nil {
		return nil, err
	}
	return calls, nil
}

// Diagnostics returns a snapshot of the latest published diagnostics keyed
// by URI. The map is a fresh copy — safe to read concurrently.
func (c *Client) Diagnostics() map[string][]Diagnostic {
	c.diagMu.RLock()
	defer c.diagMu.RUnlock()
	out := make(map[string][]Diagnostic, len(c.diagnostics))
	maps.Copy(out, c.diagnostics)
	return out
}

// Shutdown asks the server to exit cleanly, killing it after 3s if it stalls.
func (c *Client) Shutdown() {
	if c.dead.Swap(true) {
		return
	}
	// Best-effort — ignore errors; we're killing the process either way.
	_, _ = c.request("shutdown", map[string]any{})
	_ = c.notify("exit", nil)
	_ = c.stdin.Close()
	done := make(chan struct{})
	go func() { _ = c.cmd.Wait(); close(done) }()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		_ = c.cmd.Process.Kill()
	}
}

// ── JSON-RPC transport ──────────────────────────────────────────────────

func (c *Client) request(method string, params any) (json.RawMessage, error) {
	if c.dead.Load() {
		return nil, fmt.Errorf("lsp client closed")
	}
	id := c.nextID.Add(1) - 1
	ch := make(chan rpcResult, 1)

	c.pendMu.Lock()
	c.pending[id] = ch
	c.pendMu.Unlock()

	if err := c.send(map[string]any{
		"jsonrpc": "2.0",
		"id":      id,
		"method":  method,
		"params":  params,
	}); err != nil {
		c.pendMu.Lock()
		delete(c.pending, id)
		c.pendMu.Unlock()
		return nil, err
	}

	select {
	case res := <-ch:
		if res.err != "" {
			return nil, fmt.Errorf("lsp %s: %s", method, res.err)
		}
		return res.result, nil
	case <-time.After(30 * time.Second):
		c.pendMu.Lock()
		delete(c.pending, id)
		c.pendMu.Unlock()
		return nil, fmt.Errorf("lsp request %s timed out", method)
	}
}

func (c *Client) notify(method string, params any) error {
	return c.send(map[string]any{
		"jsonrpc": "2.0",
		"method":  method,
		"params":  params,
	})
}

func (c *Client) send(msg any) error {
	body, err := json.Marshal(msg)
	if err != nil {
		return err
	}
	header := fmt.Sprintf("Content-Length: %d\r\n\r\n", len(body))
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	if _, err := io.WriteString(c.stdin, header); err != nil {
		return err
	}
	_, err = c.stdin.Write(body)
	return err
}

func (c *Client) readLoop() {
	for {
		msg, err := readMessage(c.stdout)
		if err != nil {
			// Server died — fail all pending requests.
			c.dead.Store(true)
			c.pendMu.Lock()
			for id, ch := range c.pending {
				ch <- rpcResult{err: "lsp server closed"}
				delete(c.pending, id)
			}
			c.pendMu.Unlock()
			return
		}

		var env struct {
			ID     *int64          `json:"id"`
			Method string          `json:"method"`
			Result json.RawMessage `json:"result"`
			Error  *struct {
				Message string `json:"message"`
			} `json:"error"`
			Params json.RawMessage `json:"params"`
		}
		_ = json.Unmarshal(msg, &env)

		// Response
		if env.ID != nil {
			c.pendMu.Lock()
			ch, ok := c.pending[*env.ID]
			if ok {
				delete(c.pending, *env.ID)
			}
			c.pendMu.Unlock()
			if ok {
				if env.Error != nil {
					ch <- rpcResult{err: env.Error.Message}
				} else {
					ch <- rpcResult{result: env.Result}
				}
			}
			continue
		}

		// Notification
		switch env.Method {
		case "textDocument/publishDiagnostics":
			var p struct {
				URI         string       `json:"uri"`
				Diagnostics []Diagnostic `json:"diagnostics"`
			}
			if err := json.Unmarshal(env.Params, &p); err != nil {
				continue
			}
			c.diagMu.Lock()
			if len(p.Diagnostics) == 0 {
				delete(c.diagnostics, p.URI)
			} else {
				c.diagnostics[p.URI] = p.Diagnostics
			}
			c.diagMu.Unlock()
		}
	}
}

func readMessage(r *bufio.Reader) (json.RawMessage, error) {
	var contentLength int
	for {
		line, err := r.ReadString('\n')
		if err != nil {
			return nil, err
		}
		line = strings.TrimRight(line, "\r\n")
		if line == "" {
			break
		}
		if after, ok := strings.CutPrefix(line, "Content-Length:"); ok {
			contentLength, _ = strconv.Atoi(strings.TrimSpace(after))
		}
	}
	if contentLength == 0 {
		return nil, fmt.Errorf("missing Content-Length")
	}
	body := make([]byte, contentLength)
	if _, err := io.ReadFull(r, body); err != nil {
		return nil, err
	}
	return body, nil
}
