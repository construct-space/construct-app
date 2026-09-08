package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/construct-space/brain/catalog"
)

// testRegistry builds a catalog.Registry from a fixture snapshot by
// writing the on-disk cache and loading it — the Registry has no
// injection seam, and that's fine: this also exercises the cache path.
func testRegistry(t *testing.T) *catalog.Registry {
	t.Helper()
	dir := t.TempDir()
	cat := catalog.Catalog{
		Version: "test",
		Providers: []catalog.ProviderEntry{
			{
				Slug: "nvidia", Name: "NVIDIA", Enabled: true,
				APIKey: catalog.APIKeyAuth{Enabled: true, BaseURL: "https://integrate.api.nvidia.com/v1", EnvKeys: []string{"BRAINTEST_NVIDIA_KEY"}},
				Models: []catalog.ModelEntry{
					{ID: "z-ai/glm-5.2", Name: "GLM 5.2", Default: true, AvailableOnAPIKey: true},
					{ID: "minimaxai/minimax-m3", Name: "MiniMax M3", AvailableOnAPIKey: true},
				},
			},
			{
				Slug: "openrouter", Name: "OpenRouter", Enabled: true,
				APIKey: catalog.APIKeyAuth{Enabled: true, BaseURL: "https://openrouter.ai/api/v1", EnvKeys: []string{"BRAINTEST_OPENROUTER_KEY"}},
				Models: []catalog.ModelEntry{
					{ID: "openai/gpt-oss-20b:free", Name: "GPT-OSS 20B (free)", Default: true, AvailableOnAPIKey: true},
				},
			},
			{
				Slug: "testprov", Name: "Test Provider", Enabled: true,
				APIKey: catalog.APIKeyAuth{Enabled: true, BaseURL: "https://example.invalid/v1", EnvKeys: []string{"BRAINTEST_TESTPROV_KEY"}},
				Models: []catalog.ModelEntry{
					{ID: "test-default", Name: "Test Default", Default: true, AvailableOnAPIKey: true},
					{ID: "test-other", Name: "Test Other", AvailableOnAPIKey: true},
				},
			},
		},
	}
	body, err := json.Marshal(cat)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "catalog.json"), body, 0o600); err != nil {
		t.Fatal(err)
	}
	reg := catalog.New(dir, "http://127.0.0.1:0/unused")
	if err := reg.LoadCache(); err != nil {
		t.Fatal(err)
	}
	if reg.Snapshot() == nil {
		t.Fatal("fixture catalog did not load")
	}
	return reg
}

func resolveForTest(t *testing.T, reg *catalog.Registry, providerArg, modelArg string) (modelRoute, error) {
	t.Helper()
	// nil OAuth/codex/orgKeys/state/idLoader = no credentials anywhere
	// except env vars, which individual tests control via t.Setenv.
	return resolveModelRoute(providerArg, modelArg, reg, nil, nil, nil, nil, nil)
}

func TestResolveNamedProviderWithoutCredentialsErrors(t *testing.T) {
	reg := testRegistry(t)
	_, err := resolveForTest(t, reg, "nvidia", "z-ai/glm-5.2")
	if err == nil {
		t.Fatal("expected an error for a named provider without credentials")
	}
	if !strings.Contains(err.Error(), "nvidia") || !strings.Contains(err.Error(), "API key") {
		t.Fatalf("error should be actionable and name the provider, got: %v", err)
	}
}

func TestResolveCompositePeelNamesProvider(t *testing.T) {
	reg := testRegistry(t)
	// Composite id with no separate provider field still counts as the
	// caller's pick — it must error, not silently reroute.
	_, err := resolveForTest(t, reg, "", "nvidia:z-ai/glm-5.2")
	if err == nil || !strings.Contains(err.Error(), "nvidia") {
		t.Fatalf("composite prefix should name the provider, got: %v", err)
	}
}

func TestResolveFreeSuffixNotPeeled(t *testing.T) {
	reg := testRegistry(t)
	t.Setenv("BRAINTEST_OPENROUTER_KEY", "test-key")
	// ':free' suffix — the prefix contains '/', so it's a model path,
	// not a slug. Catalog lookup owns it (openrouter) and the full id
	// including ':free' must survive.
	route, err := resolveForTest(t, reg, "", "openai/gpt-oss-20b:free")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if route.Slug != "openrouter" {
		t.Fatalf("slug = %q, want openrouter", route.Slug)
	}
	if route.Model != "openai/gpt-oss-20b:free" {
		t.Fatalf("model = %q, want the full :free id intact", route.Model)
	}
}

func TestResolveNamedProviderWithKeySucceeds(t *testing.T) {
	reg := testRegistry(t)
	t.Setenv("BRAINTEST_NVIDIA_KEY", "test-key")
	route, err := resolveForTest(t, reg, "nvidia", "nvidia:minimaxai/minimax-m3")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if route.Slug != "nvidia" || route.Model != "minimaxai/minimax-m3" {
		t.Fatalf("route = %+v, want nvidia / bare minimax id", route)
	}
}

func TestResolveEmptyModelUsesCatalogDefault(t *testing.T) {
	reg := testRegistry(t)
	t.Setenv("BRAINTEST_NVIDIA_KEY", "test-key")
	route, err := resolveForTest(t, reg, "nvidia", "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if route.Model != "z-ai/glm-5.2" {
		t.Fatalf("model = %q, want the catalog default z-ai/glm-5.2", route.Model)
	}
}

func TestResolveNoSignalWalksFallbackChain(t *testing.T) {
	reg := testRegistry(t)
	t.Setenv("BRAINTEST_TESTPROV_KEY", "test-key")
	// No provider, no model. construct is unusable here (nil idLoader),
	// no catalog default has credentials except testprov.
	route, err := resolveForTest(t, reg, "", "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if route.Slug != "testprov" || route.Model != "test-default" {
		t.Fatalf("route = %+v, want testprov/test-default", route)
	}
}

func TestResolveNoProvidersAnywhereErrors(t *testing.T) {
	reg := testRegistry(t)
	_, err := resolveForTest(t, reg, "", "")
	if err == nil || !strings.Contains(err.Error(), "no AI provider configured") {
		t.Fatalf("want the no-provider error, got: %v", err)
	}
}

func TestFinishRouteMapsConstructSentinel(t *testing.T) {
	reg := testRegistry(t)
	route := finishModelRoute("construct", "", reg)
	if route.Model != "source-medium" {
		t.Fatalf("construct empty model = %q, want source-medium", route.Model)
	}
	route = finishModelRoute("construct", defaultModel, reg)
	if route.Model != "source-medium" {
		t.Fatalf("construct sentinel model = %q, want source-medium", route.Model)
	}
	// A concrete construct model must pass through untouched.
	route = finishModelRoute("construct", "code", reg)
	if route.Model != "code" {
		t.Fatalf("construct concrete model = %q, want code", route.Model)
	}
}
