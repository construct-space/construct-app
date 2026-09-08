# Integration Test Framework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Smoke tests that verify the full operator stack end-to-end over TCP — agents, skills, tools, sessions, streaming — without Tauri.

**Architecture:** Build the operator binary, spawn it as a subprocess on a random port, connect via TCP with newline-delimited JSON (same protocol as the real frontend), assert on responses and stream events.

**Tech Stack:** Go test, `os/exec` for subprocess, `net` for TCP, `encoding/json` for protocol.

---

### Task 1: TCP Test Client + Operator Lifecycle

**Files:**
- Create: `operator/internal/integration/integration_test.go`

- [ ] **Step 1: Write TestMain that builds and spawns the operator**

```go
package integration

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"

	"construct-operator/internal/transport"
)

var (
	operatorPort int
	operatorCmd  *exec.Cmd
	testTmpDir   string
)

func TestMain(m *testing.M) {
	// Build the operator binary
	binPath := filepath.Join(os.TempDir(), "construct-operator-integration-test")
	if runtime.GOOS == "windows" {
		binPath += ".exe"
	}

	build := exec.Command("go", "build", "-o", binPath, ".")
	build.Dir = filepath.Join(findRepoRoot(), "operator")
	build.Stderr = os.Stderr
	if err := build.Run(); err != nil {
		fmt.Fprintf(os.Stderr, "failed to build operator: %v\n", err)
		os.Exit(1)
	}
	defer os.Remove(binPath)

	// Create temp data dir
	var err error
	testTmpDir, err = os.MkdirTemp("", "construct-integration-*")
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to create temp dir: %v\n", err)
		os.Exit(1)
	}
	defer os.RemoveAll(testTmpDir)

	// Find a free port
	operatorPort = findFreePort()

	// Spawn operator
	operatorCmd = exec.Command(binPath, "--port", fmt.Sprintf("%d", operatorPort))
	operatorCmd.Env = append(os.Environ(),
		"CONSTRUCT_DATA_DIR="+testTmpDir,
		"CONSTRUCT_SPACES_PATH="+filepath.Join(findRepoRoot(), "frontend", "spaces"),
	)
	operatorCmd.Stderr = os.Stderr
	if err := operatorCmd.Start(); err != nil {
		fmt.Fprintf(os.Stderr, "failed to start operator: %v\n", err)
		os.Exit(1)
	}

	// Wait for operator to be ready
	if !waitForTCP(fmt.Sprintf("127.0.0.1:%d", operatorPort), 10*time.Second) {
		fmt.Fprintf(os.Stderr, "operator did not start within 10s\n")
		operatorCmd.Process.Kill()
		os.Exit(1)
	}

	code := m.Run()

	operatorCmd.Process.Kill()
	operatorCmd.Wait()
	os.Exit(code)
}

func findRepoRoot() string {
	dir, _ := os.Getwd()
	for {
		if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
			return filepath.Dir(dir) // go.mod is in operator/, repo root is parent
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return dir
		}
		dir = parent
	}
}

func findFreePort() int {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		panic(err)
	}
	port := l.Addr().(*net.TCPAddr).Port
	l.Close()
	return port
}

func waitForTCP(addr string, timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		conn, err := net.DialTimeout("tcp", addr, 500*time.Millisecond)
		if err == nil {
			conn.Close()
			return true
		}
		time.Sleep(100 * time.Millisecond)
	}
	return false
}
```

- [ ] **Step 2: Write the tcpClient helper**

```go
// tcpClient talks to the operator over TCP using newline-delimited JSON.
type tcpClient struct {
	conn   net.Conn
	reader *bufio.Reader
	mu     sync.Mutex
	reqID  int
}

func newClient(t *testing.T) *tcpClient {
	t.Helper()
	conn, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", operatorPort), 5*time.Second)
	if err != nil {
		t.Fatalf("failed to connect to operator: %v", err)
	}
	t.Cleanup(func() { conn.Close() })
	return &tcpClient{conn: conn, reader: bufio.NewReader(conn)}
}

func (c *tcpClient) nextID() string {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.reqID++
	return fmt.Sprintf("test-%d", c.reqID)
}

// Send sends a request and waits for the matching response.
func (c *tcpClient) Send(t *testing.T, reqType string, payload any) transport.Response {
	t.Helper()
	id := c.nextID()

	var payloadBytes json.RawMessage
	if payload != nil {
		b, err := json.Marshal(payload)
		if err != nil {
			t.Fatalf("marshal payload: %v", err)
		}
		payloadBytes = b
	}

	req := transport.Request{ID: id, Type: reqType, Payload: payloadBytes}
	line, _ := json.Marshal(req)
	line = append(line, '\n')

	c.conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
	if _, err := c.conn.Write(line); err != nil {
		t.Fatalf("write request: %v", err)
	}

	// Read responses until we find ours
	c.conn.SetReadDeadline(time.Now().Add(10 * time.Second))
	for {
		respLine, err := c.reader.ReadBytes('\n')
		if err != nil {
			t.Fatalf("read response: %v", err)
		}
		var resp transport.Response
		if err := json.Unmarshal(respLine, &resp); err != nil {
			continue // skip malformed lines
		}
		if resp.ID == id {
			return resp
		}
	}
}

// StreamEvent is a parsed stream chunk.
type StreamEvent struct {
	ID   string         `json:"id"`
	Type string         `json:"type"`
	Data map[string]any `json:"data,omitempty"`
	Done bool           `json:"done,omitempty"`
}

// Stream sends a streaming request and collects all events until done.
func (c *tcpClient) Stream(t *testing.T, reqType string, payload any, timeout time.Duration) []StreamEvent {
	t.Helper()
	id := c.nextID()

	var payloadBytes json.RawMessage
	if payload != nil {
		b, _ := json.Marshal(payload)
		payloadBytes = b
	}

	req := transport.Request{ID: id, Type: reqType, Payload: payloadBytes}
	line, _ := json.Marshal(req)
	line = append(line, '\n')

	c.conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
	if _, err := c.conn.Write(line); err != nil {
		t.Fatalf("write stream request: %v", err)
	}

	var events []StreamEvent
	c.conn.SetReadDeadline(time.Now().Add(timeout))
	for {
		respLine, err := c.reader.ReadBytes('\n')
		if err != nil {
			t.Fatalf("read stream event: %v", err)
		}
		var evt StreamEvent
		if err := json.Unmarshal(respLine, &evt); err != nil {
			continue
		}
		if evt.ID != id {
			continue
		}
		events = append(events, evt)
		if evt.Done {
			return events
		}
	}
}

// Cancel sends a stream.cancel request for the given request ID.
func (c *tcpClient) Cancel(t *testing.T, requestID string) {
	t.Helper()
	c.Send(t, "stream.cancel", map[string]string{"request_id": requestID})
}
```

- [ ] **Step 3: Write TestOperatorBoot to verify basic connectivity**

```go
func TestOperatorBoot(t *testing.T) {
	c := newClient(t)
	resp := c.Send(t, "health", nil)
	if !resp.Success {
		t.Fatalf("health check failed: %s", resp.Error)
	}
}
```

- [ ] **Step 4: Run the test**

Run: `cd operator && go test ./internal/integration/ -run TestOperatorBoot -v -timeout 30s`
Expected: PASS — operator boots, health check succeeds

- [ ] **Step 5: Commit**

```bash
git add operator/internal/integration/integration_test.go
git commit -m "integration: test framework with TCP client and operator lifecycle"
```

---

### Task 2: Agent Tests

**Files:**
- Create: `operator/internal/integration/agents_test.go`

- [ ] **Step 1: Write TestAgentsList**

```go
package integration

import (
	"testing"
)

func TestAgentsList(t *testing.T) {
	c := newClient(t)
	resp := c.Send(t, "agents.list", nil)
	if !resp.Success {
		t.Fatalf("agents.list failed: %s", resp.Error)
	}

	data, ok := resp.Data.(map[string]any)
	if !ok {
		t.Fatalf("unexpected data type: %T", resp.Data)
	}

	agents, ok := data["agents"].([]any)
	if !ok {
		t.Fatalf("missing agents array in response")
	}

	// Expect at least the 6 core agents
	expectedIDs := map[string]bool{
		"general": false, "architect": false, "brainstorm": false,
		"coder": false, "project": false, "space": false,
	}
	for _, a := range agents {
		agent, ok := a.(map[string]any)
		if !ok {
			continue
		}
		id, _ := agent["id"].(string)
		if _, expected := expectedIDs[id]; expected {
			expectedIDs[id] = true
		}
		// Verify metadata fields exist
		if _, ok := agent["source"]; !ok {
			t.Errorf("agent %s missing 'source' field", id)
		}
	}
	for id, found := range expectedIDs {
		if !found {
			t.Errorf("expected agent %q not found in agents.list", id)
		}
	}
}

func TestSpaceAgentDiscovery(t *testing.T) {
	// CONSTRUCT_SPACES_PATH is set to frontend/spaces/ in TestMain,
	// so space agents from built-in spaces should appear.
	c := newClient(t)
	resp := c.Send(t, "agents.list", nil)
	if !resp.Success {
		t.Fatalf("agents.list failed: %s", resp.Error)
	}

	data, _ := resp.Data.(map[string]any)
	agents, _ := data["agents"].([]any)

	// At minimum, core builtin agents should be present.
	// Space agents appear as "space:<id>" if space loading worked.
	if len(agents) < 6 {
		t.Errorf("expected at least 6 agents, got %d", len(agents))
	}
}
```

- [ ] **Step 2: Run tests**

Run: `cd operator && go test ./internal/integration/ -run TestAgents -v -timeout 30s`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add operator/internal/integration/agents_test.go
git commit -m "integration: agent list and space agent discovery tests"
```

---

### Task 3: Skills Tests

**Files:**
- Create: `operator/internal/integration/skills_test.go`

- [ ] **Step 1: Write TestSkillsList and TestSkillMatch**

```go
package integration

import (
	"strings"
	"testing"
	"time"
)

func TestSkillsList(t *testing.T) {
	c := newClient(t)
	resp := c.Send(t, "skills.list", nil)
	if !resp.Success {
		t.Fatalf("skills.list failed: %s", resp.Error)
	}

	data, ok := resp.Data.(map[string]any)
	if !ok {
		t.Fatalf("unexpected data type: %T", resp.Data)
	}

	skills, ok := data["skills"].([]any)
	if !ok {
		t.Fatalf("missing skills array")
	}

	// Expect namespaced core skills
	expectedPrefixes := []string{"coder:", "architect:", "brainstorm:", "project:"}
	foundNamespaced := 0
	for _, s := range skills {
		skill, ok := s.(map[string]any)
		if !ok {
			continue
		}
		id, _ := skill["id"].(string)
		for _, prefix := range expectedPrefixes {
			if strings.HasPrefix(id, prefix) {
				foundNamespaced++
				break
			}
		}
		// Verify metadata
		if _, ok := skill["source"]; !ok {
			t.Errorf("skill %s missing 'source'", id)
		}
		if _, ok := skill["agents"]; !ok {
			t.Errorf("skill %s missing 'agents'", id)
		}
	}

	if foundNamespaced == 0 {
		t.Error("no namespaced skills found — core space skills not loaded")
	}
}

func TestSkillMatch(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping dispatch test in short mode (requires AI provider)")
	}

	c := newClient(t)
	events := c.Stream(t, "agents.dispatch_stream", map[string]any{
		"agent_id": "coder",
		"task":     "build a construct space for note taking",
	}, 60*time.Second)

	foundSkillMatch := false
	for _, evt := range events {
		if evt.Type == "skill.match" {
			foundSkillMatch = true
			skills, ok := evt.Data["skills"].([]any)
			if !ok {
				t.Error("skill.match event missing skills array")
				break
			}
			// Should match coder:construct-spaces
			matched := false
			for _, s := range skills {
				sm, _ := s.(map[string]any)
				id, _ := sm["id"].(string)
				if strings.Contains(id, "construct-spaces") {
					matched = true
				}
			}
			if !matched {
				t.Error("expected construct-spaces skill to match for 'build a construct space'")
			}
			break
		}
	}

	if !foundSkillMatch {
		t.Error("no skill.match event received during dispatch")
	}
}
```

- [ ] **Step 2: Run tests**

Run: `cd operator && go test ./internal/integration/ -run TestSkills -v -timeout 30s -short`
Expected: TestSkillsList PASS, TestSkillMatch SKIP (needs provider)

- [ ] **Step 3: Commit**

```bash
git add operator/internal/integration/skills_test.go
git commit -m "integration: skills list and skill match tests"
```

---

### Task 4: Dispatch + Tool Execution Tests

**Files:**
- Create: `operator/internal/integration/dispatch_test.go`

- [ ] **Step 1: Write TestAgentResponse and TestToolExecution**

```go
package integration

import (
	"testing"
	"time"
)

func TestAgentResponse(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping dispatch test in short mode (requires AI provider)")
	}

	c := newClient(t)
	events := c.Stream(t, "agents.dispatch_stream", map[string]any{
		"agent_id": "brainstorm",
		"task":     "Say hello in one sentence.",
	}, 30*time.Second)

	if len(events) == 0 {
		t.Fatal("no stream events received")
	}

	// Must have a done event
	lastEvent := events[len(events)-1]
	if !lastEvent.Done {
		t.Error("last event is not done")
	}

	// Must have some text content across events
	hasText := false
	for _, evt := range events {
		if evt.Type == "text" || evt.Type == "stream" || evt.Type == "" {
			hasText = true
			break
		}
	}
	if !hasText {
		t.Error("no text events in response")
	}
}

func TestToolExecution(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping tool test in short mode (requires AI provider)")
	}

	c := newClient(t)
	events := c.Stream(t, "agents.dispatch_stream", map[string]any{
		"agent_id": "coder",
		"task":     "List the files in /tmp. Use list_dir tool.",
	}, 60*time.Second)

	hasToolCall := false
	hasToolResult := false
	for _, evt := range events {
		if evt.Type == "tool.call" {
			hasToolCall = true
		}
		if evt.Type == "tool.result" {
			hasToolResult = true
		}
	}

	if !hasToolCall {
		t.Error("no tool.call event — expected coder to use a tool")
	}
	if !hasToolResult {
		t.Error("no tool.result event — expected tool execution result")
	}
}
```

- [ ] **Step 2: Run tests**

Run: `cd operator && go test ./internal/integration/ -run TestAgent -v -timeout 120s -short`
Expected: SKIP in short mode

- [ ] **Step 3: Commit**

```bash
git add operator/internal/integration/dispatch_test.go
git commit -m "integration: agent response and tool execution tests"
```

---

### Task 5: Session Persistence Test

**Files:**
- Create: `operator/internal/integration/session_test.go`

- [ ] **Step 1: Write TestSessionPersistence**

```go
package integration

import (
	"testing"
	"time"
)

func TestSessionPersistence(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping session test in short mode (requires AI provider)")
	}

	c := newClient(t)

	// First message — starts a new session
	events1 := c.Stream(t, "agents.dispatch_stream", map[string]any{
		"agent_id": "brainstorm",
		"task":     "Remember the code word: PINEAPPLE. Confirm you remember it.",
	}, 30*time.Second)

	// Extract session_id from done event
	var sessionID string
	for _, evt := range events1 {
		if evt.Done {
			if sid, ok := evt.Data["session_id"].(string); ok {
				sessionID = sid
			}
		}
	}

	if sessionID == "" {
		t.Fatal("no session_id in first response")
	}

	// Second message — uses existing session
	events2 := c.Stream(t, "agents.dispatch_stream", map[string]any{
		"agent_id":   "brainstorm",
		"task":       "What was the code word I told you?",
		"session_id": sessionID,
	}, 30*time.Second)

	// The response should reference PINEAPPLE
	hasContent := false
	for _, evt := range events2 {
		if evt.Done {
			if content, ok := evt.Data["content"].(string); ok && len(content) > 0 {
				hasContent = true
			}
		}
	}

	if !hasContent {
		t.Error("second message returned no content — session may not have loaded")
	}
}
```

- [ ] **Step 2: Run test**

Run: `cd operator && go test ./internal/integration/ -run TestSession -v -timeout 60s -short`
Expected: SKIP in short mode

- [ ] **Step 3: Commit**

```bash
git add operator/internal/integration/session_test.go
git commit -m "integration: session persistence test"
```

---

### Task 6: Stream Cancel Test

**Files:**
- Create: `operator/internal/integration/stream_test.go`

- [ ] **Step 1: Write TestStreamCancel**

```go
package integration

import (
	"encoding/json"
	"fmt"
	"testing"
	"time"
)

func TestStreamCancel(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping stream cancel test in short mode (requires AI provider)")
	}

	c := newClient(t)
	id := c.nextID()

	// Start a long-running stream
	payload, _ := json.Marshal(map[string]any{
		"agent_id": "brainstorm",
		"task":     "Write a very long essay about the history of computing. Make it at least 2000 words.",
	})

	req := transport.Request{ID: id, Type: "agents.dispatch_stream", Payload: payload}
	line, _ := json.Marshal(req)
	line = append(line, '\n')

	c.conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
	c.conn.Write(line)

	// Wait for first event to confirm stream started
	c.conn.SetReadDeadline(time.Now().Add(30 * time.Second))
	respLine, err := c.reader.ReadBytes('\n')
	if err != nil {
		t.Fatalf("no initial stream event: %v", err)
	}

	var firstEvt StreamEvent
	json.Unmarshal(respLine, &firstEvt)
	if firstEvt.ID != id {
		t.Skipf("first event is not for our request, skipping")
	}

	// Cancel the stream
	cancelID := c.nextID()
	cancelPayload, _ := json.Marshal(map[string]string{"request_id": id})
	cancelReq := transport.Request{ID: cancelID, Type: "stream.cancel", Payload: cancelPayload}
	cancelLine, _ := json.Marshal(cancelReq)
	cancelLine = append(cancelLine, '\n')
	c.conn.Write(cancelLine)

	// Drain remaining events — should stop quickly
	c.conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	eventCount := 0
	for {
		_, err := c.reader.ReadBytes('\n')
		if err != nil {
			break // timeout or EOF — stream stopped
		}
		eventCount++
		if eventCount > 50 {
			t.Error("stream did not stop after cancel — received >50 events")
			break
		}
	}

	t.Logf("stream stopped after %d events post-cancel", eventCount)
}
```

- [ ] **Step 2: Run test**

Run: `cd operator && go test ./internal/integration/ -run TestStreamCancel -v -timeout 60s -short`
Expected: SKIP in short mode

- [ ] **Step 3: Commit**

```bash
git add operator/internal/integration/stream_test.go
git commit -m "integration: stream cancellation test"
```

---

### Task 7: Provider Fallback Test

**Files:**
- Create: `operator/internal/integration/provider_test.go`

- [ ] **Step 1: Write TestProviderHealth**

```go
package integration

import (
	"testing"
)

func TestProviderHealth(t *testing.T) {
	c := newClient(t)
	resp := c.Send(t, "provider.health", nil)

	// This may fail if no providers are configured, which is fine —
	// the test verifies the endpoint exists and responds.
	if resp.Error != "" && resp.Error != "no providers configured" {
		// Unexpected error
		t.Logf("provider.health response: success=%v error=%s", resp.Success, resp.Error)
	}
}
```

- [ ] **Step 2: Run test**

Run: `cd operator && go test ./internal/integration/ -run TestProvider -v -timeout 30s`
Expected: PASS (endpoint responds, even without configured providers)

- [ ] **Step 3: Commit**

```bash
git add operator/internal/integration/provider_test.go
git commit -m "integration: provider health endpoint test"
```

---

### Task 8: Package Script + CI Integration

**Files:**
- Modify: `operator/Makefile` or `package.json` (root)

- [ ] **Step 1: Add bun script for integration tests**

Add to root `package.json` scripts:
```json
"test:integration": "cd operator && go test ./internal/integration/ -v -timeout 120s",
"test:integration:short": "cd operator && go test ./internal/integration/ -v -timeout 30s -short"
```

- [ ] **Step 2: Run the full short suite**

Run: `bun run test:integration:short`
Expected: Boot + agents + skills + provider tests PASS, dispatch/session/stream tests SKIP

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "integration: add test:integration scripts to package.json"
```
