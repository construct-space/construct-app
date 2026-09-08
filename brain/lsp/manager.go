package lsp

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// IdleTimeout is how long an LSP server can sit unused before the idle
// sweeper kills it. Servers are heavy (rust-analyzer in particular) so we
// want them gone soon after the agent stops asking.
const IdleTimeout = 5 * time.Minute

// idleSweepInterval is how often we check for idle clients.
const idleSweepInterval = 60 * time.Second

// Manager owns lazy LSP clients keyed by (workspaceRoot, serverName).
// brain is workspace-agnostic — different tool calls may target different
// roots, so we don't bind a single workspace at construction time.
type Manager struct {
	mu sync.Mutex

	// Configured servers, indexed by name. Each entry has an associated
	// set of file extensions; the same server can be spawned per workspace.
	servers map[string]ServerConfig
	extMap  map[string]string // ".go" -> "gopls"

	clients map[clientKey]*Client

	stop chan struct{}
}

type clientKey struct {
	root   string
	server string
}

// NewManager returns an empty manager. Call RegisterDefaults to populate
// it with the language servers that exist on PATH.
func NewManager() *Manager {
	m := &Manager{
		servers: make(map[string]ServerConfig),
		extMap:  make(map[string]string),
		clients: make(map[clientKey]*Client),
		stop:    make(chan struct{}),
	}
	go m.idleSweeper()
	return m
}

// RegisterServer adds a server template. WorkspaceRoot in cfg is ignored —
// workspace is resolved per call from the file path.
func (m *Manager) RegisterServer(cfg ServerConfig) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.servers[cfg.Name] = cfg
	for ext := range cfg.Extensions {
		m.extMap[strings.ToLower(ext)] = cfg.Name
	}
}

// SupportsFile reports whether any registered server claims this extension.
func (m *Manager) SupportsFile(path string) bool {
	ext := strings.ToLower(filepath.Ext(path))
	m.mu.Lock()
	_, ok := m.extMap[ext]
	m.mu.Unlock()
	return ok
}

// GoToDefinition routes to the right client and returns definition locations.
func (m *Manager) GoToDefinition(path string, line, character int) ([]Location, error) {
	c, err := m.clientForPath(path)
	if err != nil {
		return nil, err
	}
	return c.GoToDefinition(path, line, character)
}

// FindReferences routes to the right client and returns reference locations.
func (m *Manager) FindReferences(path string, line, character int, includeDecl bool) ([]Location, error) {
	c, err := m.clientForPath(path)
	if err != nil {
		return nil, err
	}
	return c.FindReferences(path, line, character, includeDecl)
}

// PrepareCallHierarchy resolves the anchor items at a position.
func (m *Manager) PrepareCallHierarchy(path string, line, character int) (*Client, []CallHierarchyItem, error) {
	c, err := m.clientForPath(path)
	if err != nil {
		return nil, nil, err
	}
	items, err := c.PrepareCallHierarchy(path, line, character)
	return c, items, err
}

// SyncFile refreshes the server's view of a file (after an edit).
func (m *Manager) SyncFile(path string) error {
	c, err := m.clientForPath(path)
	if err != nil {
		return err
	}
	return c.SyncDocument(path)
}

// CollectDiagnostics gathers diagnostics from every active client across
// every workspace. If workspaceRoot is non-empty, only clients rooted at
// that workspace are included.
func (m *Manager) CollectDiagnostics(workspaceRoot string) *WorkspaceDiagnostics {
	m.mu.Lock()
	clients := make([]*Client, 0, len(m.clients))
	for k, c := range m.clients {
		if workspaceRoot != "" && k.root != workspaceRoot {
			continue
		}
		clients = append(clients, c)
	}
	m.mu.Unlock()

	wd := &WorkspaceDiagnostics{}
	for _, c := range clients {
		for uri, diags := range c.Diagnostics() {
			if len(diags) == 0 {
				continue
			}
			wd.Files = append(wd.Files, FileDiagnostics{
				Path:        uriToPath(uri),
				URI:         uri,
				Diagnostics: diags,
			})
		}
	}
	return wd
}

// Shutdown closes every active client and stops the idle sweeper.
func (m *Manager) Shutdown() {
	select {
	case <-m.stop:
		// already stopped
	default:
		close(m.stop)
	}
	m.mu.Lock()
	clients := make([]*Client, 0, len(m.clients))
	for k, c := range m.clients {
		clients = append(clients, c)
		delete(m.clients, k)
	}
	m.mu.Unlock()
	for _, c := range clients {
		c.Shutdown()
	}
}

// clientForPath finds or lazily spawns the client matching this file.
func (m *Manager) clientForPath(path string) (*Client, error) {
	abs, err := filepath.Abs(path)
	if err != nil {
		abs = path
	}
	ext := strings.ToLower(filepath.Ext(abs))

	m.mu.Lock()
	serverName, ok := m.extMap[ext]
	if !ok {
		m.mu.Unlock()
		return nil, fmt.Errorf("no LSP server registered for %s files", ext)
	}
	cfg, ok := m.servers[serverName]
	if !ok {
		m.mu.Unlock()
		return nil, fmt.Errorf("LSP server %q not configured", serverName)
	}
	root := DetectWorkspaceRoot(filepath.Dir(abs), serverName)
	key := clientKey{root: root, server: serverName}

	if c, ok := m.clients[key]; ok && !c.dead.Load() {
		m.mu.Unlock()
		return c, nil
	}
	// Drop a dead one before respawning.
	if c, ok := m.clients[key]; ok && c.dead.Load() {
		delete(m.clients, key)
	}
	m.mu.Unlock()

	// Spawn outside the lock — initialize handshake can take seconds and
	// we don't want to block every other call.
	cfg.WorkspaceRoot = root
	c, err := Connect(cfg)
	if err != nil {
		return nil, fmt.Errorf("lsp connect %s: %w", serverName, err)
	}

	m.mu.Lock()
	// Race: another goroutine may have connected. Use theirs and shut ours.
	if existing, ok := m.clients[key]; ok && !existing.dead.Load() {
		m.mu.Unlock()
		c.Shutdown()
		return existing, nil
	}
	m.clients[key] = c
	m.mu.Unlock()
	return c, nil
}

// idleSweeper kills clients that have not been used for IdleTimeout.
func (m *Manager) idleSweeper() {
	t := time.NewTicker(idleSweepInterval)
	defer t.Stop()
	for {
		select {
		case <-m.stop:
			return
		case <-t.C:
			m.sweepIdle()
		}
	}
}

func (m *Manager) sweepIdle() {
	now := time.Now().UnixNano()
	m.mu.Lock()
	var victims []*Client
	for k, c := range m.clients {
		if c.dead.Load() || time.Duration(now-c.lastUsed.Load()) > IdleTimeout {
			victims = append(victims, c)
			delete(m.clients, k)
		}
	}
	m.mu.Unlock()
	for _, c := range victims {
		c.Shutdown()
	}
}

// DetectWorkspaceRoot walks up from startDir looking for a project marker
// appropriate to the server. Falls back to startDir.
func DetectWorkspaceRoot(startDir, server string) string {
	// Per-server markers (most specific first).
	var markers []string
	switch server {
	case "gopls":
		markers = []string{"go.mod", "go.work"}
	case "typescript":
		markers = []string{"package.json", "tsconfig.json", "jsconfig.json"}
	case "rust":
		markers = []string{"Cargo.toml"}
	case "python":
		markers = []string{"pyproject.toml", "setup.py", "setup.cfg", "requirements.txt"}
	}
	// Generic VCS fallback applies to every language.
	markers = append(markers, ".git", ".hg", ".svn")

	dir := startDir
	for {
		for _, m := range markers {
			if _, err := os.Stat(filepath.Join(dir, m)); err == nil {
				return dir
			}
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return startDir
		}
		dir = parent
	}
}

// RegisterDefaults adds the well-known servers whose binaries are on PATH.
// Returns the list of registered server names.
func (m *Manager) RegisterDefaults() []string {
	var registered []string

	if _, err := exec.LookPath("gopls"); err == nil {
		m.RegisterServer(ServerConfig{
			Name:    "gopls",
			Command: "gopls",
			Args:    []string{"serve"},
			Extensions: map[string]string{
				".go": "go",
			},
		})
		registered = append(registered, "gopls")
	}

	if _, err := exec.LookPath("typescript-language-server"); err == nil {
		m.RegisterServer(ServerConfig{
			Name:    "typescript",
			Command: "typescript-language-server",
			Args:    []string{"--stdio"},
			Extensions: map[string]string{
				".ts":  "typescript",
				".tsx": "typescriptreact",
				".js":  "javascript",
				".jsx": "javascriptreact",
				".mjs": "javascript",
				".cjs": "javascript",
				".vue": "vue",
			},
		})
		registered = append(registered, "typescript")
	}

	if path, err := exec.LookPath("pyright-langserver"); err == nil {
		m.RegisterServer(ServerConfig{
			Name:       "python",
			Command:    path,
			Args:       []string{"--stdio"},
			Extensions: map[string]string{".py": "python", ".pyi": "python"},
		})
		registered = append(registered, "python(pyright)")
	} else if path, err := exec.LookPath("pylsp"); err == nil {
		m.RegisterServer(ServerConfig{
			Name:       "python",
			Command:    path,
			Extensions: map[string]string{".py": "python", ".pyi": "python"},
		})
		registered = append(registered, "python(pylsp)")
	}

	if _, err := exec.LookPath("rust-analyzer"); err == nil {
		m.RegisterServer(ServerConfig{
			Name:       "rust",
			Command:    "rust-analyzer",
			Extensions: map[string]string{".rs": "rust"},
		})
		registered = append(registered, "rust-analyzer")
	}

	return registered
}
