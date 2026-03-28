package main

import "testing"

func TestProviderFromSettingSupportsMimo(t *testing.T) {
	prov := providerFromSetting("provider_key:mimo", "sk-test")
	if prov == nil {
		t.Fatal("expected mimo provider")
	}
	if prov.ID() != "mimo" {
		t.Fatalf("expected mimo provider id, got %q", prov.ID())
	}
	models := prov.Models()
	if len(models) != 1 || models[0] != "mimo-v2-flash" {
		t.Fatalf("expected mimo-v2-flash model, got %#v", models)
	}
}

func TestProviderEnvVarAndIDForSettingSupportMimo(t *testing.T) {
	if got := providerEnvVarForSetting("provider_key:mimo"); got != "MIMO_API_KEY" {
		t.Fatalf("expected MIMO_API_KEY, got %q", got)
	}
	if got := providerIDForSetting("provider_key:mimo"); got != "mimo" {
		t.Fatalf("expected mimo id, got %q", got)
	}
}

func TestProviderStatusReadsMimoSetting(t *testing.T) {
	status := providerStatus(map[string]string{"provider_key:mimo": "sk-test"})
	if !status["mimo"] {
		t.Fatalf("expected mimo to be enabled, got %#v", status)
	}
}
