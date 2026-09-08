# Provider Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make provider credentials profile-scoped only — no OpenCode auto-discovery, no OAuth env var fallback, accurate "Connected" status.

**Architecture:** Remove OpenCode token auto-loading and OAuth env vars from bootstrap. Credentials come from profile's `providers/auth.json` (OAuth) and source settings (API keys) only. `ConnectedProviderEntries` only marks providers as connected when stored credentials exist. Profile switch clears and reloads all providers.

**Tech Stack:** Go (operator), TypeScript (frontend)

---

## File Structure

| File | Action | Purpose |
|------|--------|---------|
| `operator/internal/provider/bootstrap/bootstrap_providers.go` | **Modify** | Remove `AllowOpenCodeAutoLoad`, `NewAnthropicOAuthFromOpenCode` fields; remove OpenCode auto-load block; remove `ANTHROPIC_OAUTH_TOKEN/REFRESH` env var fallback; remove those from `CurrentEnv()` |
| `operator/internal/provider/bootstrap/bootstrap_providers_test.go` | **Modify** | Remove OpenCode auto-load tests; add test that OAuth providers come only from storage |
| `operator/internal/provider/bootstrap/oauth_runtime.go` | **Modify** | Fix `ConnectedProviderEntries` — remove runtime ID fallback for "connected" status |
| `operator/internal/provider/bootstrap/oauth_runtime_test.go` | **Modify** | Update `TestOAuthConnectedProviderEntriesMarksStoredAndRuntimeProviders` — openai-codex without stored creds should NOT be connected |
| `operator/main.go` | **Modify** | Remove `AllowOpenCodeAutoLoad` from both Bootstrap calls (lines 265, 475) |

---

## Task 1: Remove OpenCode auto-discovery from bootstrap

**Files:**
- Modify: `operator/internal/provider/bootstrap/bootstrap_providers.go`

- [ ] **Step 1: Remove OpenCode fields from BootstrapConfig**

Remove `AllowOpenCodeAutoLoad` and `NewAnthropicOAuthFromOpenCode` from the struct:

```go
type BootstrapConfig struct {
	Settings       map[string]string
	Env            map[string]string
	OAuthData      oauth.StorageData
	IsDisconnected func(string) bool
	NewOpenRouter  func(string) provider.Provider
	Logf           func(string, ...any)
}
```

- [ ] **Step 2: Remove OpenCode auto-load block from Bootstrap()**

Remove lines 31-35 (NewAnthropicOAuthFromOpenCode default) and lines 57-71 (the entire OpenCode auto-load + ANTHROPIC_OAUTH_TOKEN env var block):

The function should go straight from the `NewOpenRouter` default to the API key providers. The comment changes to:

```go
// ── OAuth providers (from profile's providers/auth.json only) ──
// Loaded by appendOAuthRuntimeProviders at the end.
// No auto-discovery from external tools. No OAuth env vars.

// ── API key providers (env vars + source settings) ──
```

- [ ] **Step 3: Clean up CurrentEnv()**

Remove `ANTHROPIC_OAUTH_REFRESH` and `ANTHROPIC_OAUTH_TOKEN` from `CurrentEnv()`:

```go
func CurrentEnv() map[string]string {
	return map[string]string{
		"DEEPSEEK_API_KEY":   os.Getenv("DEEPSEEK_API_KEY"),
		"MIMO_API_KEY":       os.Getenv("MIMO_API_KEY"),
		"OPENAI_API_KEY":     os.Getenv("OPENAI_API_KEY"),
		"OPENROUTER_API_KEY": os.Getenv("OPENROUTER_API_KEY"),
		"XAI_API_KEY":        os.Getenv("XAI_API_KEY"),
		"ZAI_API_KEY":        os.Getenv("ZAI_API_KEY"),
	}
}
```

- [ ] **Step 4: Build**

```bash
cd operator && go build ./...
```

Expected: Compilation errors in main.go and tests (they still reference removed fields). That's expected — we fix them in Tasks 2 and 3.

---

## Task 2: Fix callers in main.go

**Files:**
- Modify: `operator/main.go`

- [ ] **Step 1: Remove AllowOpenCodeAutoLoad from first Bootstrap call (line ~265)**

Change from:
```go
provResult := appproviders.Bootstrap(appproviders.BootstrapConfig{
	Settings:              stateStore.Settings(),
	Env:                   providerEnv,
	OAuthData:             oauthData,
	IsDisconnected:        oauthStore.IsDisconnected,
	AllowOpenCodeAutoLoad: false,
	Logf:                  func(format string, args ...any) { fmt.Fprintf(os.Stderr, format, args...) },
})
```

To:
```go
provResult := appproviders.Bootstrap(appproviders.BootstrapConfig{
	Settings:       stateStore.Settings(),
	Env:            providerEnv,
	OAuthData:      oauthData,
	IsDisconnected: oauthStore.IsDisconnected,
	Logf:           func(format string, args ...any) { fmt.Fprintf(os.Stderr, format, args...) },
})
```

- [ ] **Step 2: Remove AllowOpenCodeAutoLoad from second Bootstrap call (line ~475)**

Same change for the profile-switch re-bootstrap.

- [ ] **Step 3: Build**

```bash
cd operator && go build ./...
```

Expected: Build succeeds (test file still broken — fixed in Task 3).

---

## Task 3: Update tests

**Files:**
- Modify: `operator/internal/provider/bootstrap/bootstrap_providers_test.go`

- [ ] **Step 1: Replace both tests with profile-storage-only test**

```go
package bootstrap

import (
	"testing"

	"construct-operator/internal/oauth"
)

func TestBootstrapLoadsNoProvidersWithEmptyConfig(t *testing.T) {
	result := Bootstrap(BootstrapConfig{})

	if len(result.Providers) != 0 {
		t.Fatalf("expected no providers with empty config, got %d", len(result.Providers))
	}
}

func TestBootstrapLoadsOAuthProvidersFromStorageOnly(t *testing.T) {
	result := Bootstrap(BootstrapConfig{
		OAuthData: oauth.StorageData{
			"claude": {
				Type: "oauth",
				Credentials: &oauth.Credentials{
					Access:  "test-access",
					Refresh: "test-refresh",
					Expires: 9999999999999,
				},
			},
		},
	})

	if !result.ActiveProviderIDs["claude-oauth"] {
		t.Fatal("expected claude-oauth provider from storage")
	}
	if result.ActiveProviderIDs["anthropic-oauth"] {
		t.Fatal("did not expect anthropic-oauth — OpenCode auto-discovery should be removed")
	}
}

func TestBootstrapLoadsAPIKeyProvidersFromEnv(t *testing.T) {
	result := Bootstrap(BootstrapConfig{
		Env: map[string]string{
			"DEEPSEEK_API_KEY": "test-key",
		},
	})

	if !result.ActiveProviderIDs["deepseek"] {
		t.Fatal("expected deepseek provider from env var")
	}
	if len(result.Providers) != 1 {
		t.Fatalf("expected exactly 1 provider, got %d", len(result.Providers))
	}
}
```

- [ ] **Step 2: Run tests**

```bash
cd operator && go test ./internal/provider/bootstrap/ -v
```

Expected: All pass.

---

## Task 4: Fix ConnectedProviderEntries

**Files:**
- Modify: `operator/internal/provider/bootstrap/oauth_runtime.go`

- [ ] **Step 1: Remove runtime ID fallback from ConnectedProviderEntries**

In `ConnectedProviderEntries()`, change the connection logic from:

```go
if cred != nil && cred.Type == "disconnected" {
	connected = false
} else if cred != nil && cred.Type == "oauth" && cred.Credentials != nil {
	connected = true
} else if desc.RuntimeID != "" && activeIDs[desc.RuntimeID] {
	connected = true
}
```

To:

```go
// Connected = has stored credentials in profile. Not from runtime presence.
if cred != nil && cred.Type == "disconnected" {
	connected = false
} else if cred != nil && cred.Type == "oauth" && cred.Credentials != nil {
	connected = true
}
```

- [ ] **Step 2: Build**

```bash
cd operator && go build ./...
```

---

## Task 5: Update oauth_runtime tests

**Files:**
- Modify: `operator/internal/provider/bootstrap/oauth_runtime_test.go`

- [ ] **Step 1: Fix TestOAuthConnectedProviderEntriesMarksStoredAndRuntimeProviders**

The test at line 156 expects openai-codex to be connected from runtime presence alone. This should now be `false`:

Change:
```go
if connected, _ := byID["openai-codex"]["connected"].(bool); !connected {
	t.Fatal("expected openai-codex to be connected from active runtime provider")
}
```

To:
```go
if connected, _ := byID["openai-codex"]["connected"].(bool); connected {
	t.Fatal("expected openai-codex to NOT be connected — runtime presence alone is not sufficient")
}
```

- [ ] **Step 2: Run all bootstrap tests**

```bash
cd operator && go test ./internal/provider/bootstrap/ -v
```

Expected: All pass.

---

## Task 6: Full build + test verification

- [ ] **Step 1: Build operator**

```bash
bun run operator:build
```

- [ ] **Step 2: Run all operator tests**

```bash
bun run operator:test
```

Expected: All unit tests pass. Integration tests skip (no auth).

- [ ] **Step 3: Run frontend typecheck**

```bash
bun run typecheck
```

- [ ] **Step 4: Commit**

```bash
git add operator/internal/provider/bootstrap/ operator/main.go
git commit -m "feat: provider isolation — profile-scoped credentials only

- Remove OpenCode auto-discovery (no more ~/.local/share/opencode/auth.json)
- Remove ANTHROPIC_OAUTH_TOKEN/REFRESH env var fallback
- ConnectedProviderEntries only marks connected when stored credentials exist
- Credentials come from profile providers/auth.json (OAuth) and source settings (API keys)
- No cross-profile credential leaking"
```
