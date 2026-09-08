// probe-structured.go — probe every (provider, model) pair the active
// Construct profile has credentials for and classify whether the upstream
// actually enforces an OpenAI-style `response_format: json_schema`.
//
// Output: a markdown matrix on stdout — provider/model → ENFORCED | LOOSE
// | IGNORED | ERROR. Drives the per-model SupportsStructuredOutput
// rewrite (replaces today's per-provider opt-out switch in
// connectors/openai_compat.go::Capabilities).
//
// Usage:
//   cd construct-app && go run scripts/probe-structured.go            # all providers, all models
//   go run scripts/probe-structured.go -provider alibaba              # one provider
//   go run scripts/probe-structured.go -provider alibaba -model qwen3-max
//   go run scripts/probe-structured.go -out docs/structured-output-matrix.md
//
// Reads credentials from the active profile under
//   ~/Library/Application Support/Construct/profiles/<active>/
// — settings.json holds `provider_key:<id>` rows; providers.json holds
// the catalog (base URL, model list). No env vars needed.
//
// Anthropic and Google Gemini speak different request shapes and are
// skipped — this probe is OpenAI-compat only, which is where the
// silent-ignore problem actually lives.

package main

import (
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// ─── Result classification ───────────────────────────────────────────────

type verdict string

const (
	verdictEnforced verdict = "ENFORCED" // valid JSON, all required fields present + correct types, no extras
	verdictLoose    verdict = "LOOSE"    // parseable JSON but schema not enforced (missing/extra/wrong-typed)
	verdictIgnored  verdict = "IGNORED"  // not JSON at all (free-form text)
	verdictError    verdict = "ERROR"    // HTTP / network / decode error
	verdictSkipped  verdict = "SKIP"     // no key, or model excluded
)

type result struct {
	Provider string
	Model    string
	Verdict  verdict
	Note     string // short detail (HTTP code, missing field name, etc.)
	Latency  time.Duration
}

// ─── Probe payload ───────────────────────────────────────────────────────

// Schema deliberately small + strict. additionalProperties:false catches
// the common "model returns extra explanatory fields" failure mode.
const schemaJSON = `{
  "type": "object",
  "properties": {
    "name": {"type": "string"},
    "age":  {"type": "integer"},
    "tags": {"type": "array", "items": {"type": "string"}}
  },
  "required": ["name", "age", "tags"],
  "additionalProperties": false
}`

const userPrompt = `Return information about a fictional person named "Ada" aged 36 whose tags are ["math","engineer","poet"]. Output ONLY the JSON object, no prose.`

const systemPrompt = `You are a strict JSON emitter. Reply with a single JSON object that matches the requested schema. Do not include markdown fences or commentary.`

// ─── Profile loading ─────────────────────────────────────────────────────

type profilesIndex struct {
	ActiveProfile string `json:"active_profile"`
}

type settingsFile struct {
	Items []struct {
		Key   string `json:"key"`
		Value any    `json:"value"`
	} `json:"items"`
}

type providersFile struct {
	Providers []providerEntry `json:"providers"`
}

type providerEntry struct {
	ID     string `json:"id"`
	Slug   string `json:"slug"`
	Name   string `json:"name"`
	APIKey struct {
		Enabled bool   `json:"enabled"`
		BaseURL string `json:"base_url"`
	} `json:"api_key"`
	BaseURL string `json:"base_url"` // legacy fallback
	Models  []struct {
		ID                string   `json:"id"`
		Name              string   `json:"name"`
		Capabilities      []string `json:"capabilities"`
		AvailableOnApiKey bool     `json:"available_on_api_key"`
		Deprecated        bool     `json:"deprecated"`
	} `json:"models"`
}

func profileRoot() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	root := filepath.Join(home, "Library", "Application Support", "Construct")
	idxPath := filepath.Join(root, "profiles.json")
	data, err := os.ReadFile(idxPath)
	if err != nil {
		return "", fmt.Errorf("read profiles.json: %w", err)
	}
	var idx profilesIndex
	if err := json.Unmarshal(data, &idx); err != nil {
		return "", fmt.Errorf("decode profiles.json: %w", err)
	}
	if idx.ActiveProfile == "" {
		return "", fmt.Errorf("no active_profile in profiles.json")
	}
	return filepath.Join(root, "profiles", idx.ActiveProfile), nil
}

func loadKeys(profileDir string) (map[string]string, error) {
	data, err := os.ReadFile(filepath.Join(profileDir, "state", "settings.json"))
	if err != nil {
		return nil, fmt.Errorf("read settings.json: %w", err)
	}
	var s settingsFile
	if err := json.Unmarshal(data, &s); err != nil {
		return nil, fmt.Errorf("decode settings.json: %w", err)
	}
	keys := map[string]string{}
	for _, it := range s.Items {
		// Only api-key slot (not _monthly which is an OAuth-style token plan).
		if !strings.HasPrefix(it.Key, "provider_key:") {
			continue
		}
		id := strings.TrimPrefix(it.Key, "provider_key:")
		v, ok := it.Value.(string)
		if !ok || v == "" {
			continue
		}
		keys[id] = v
	}
	return keys, nil
}

func loadProviders(profileDir string) ([]providerEntry, error) {
	data, err := os.ReadFile(filepath.Join(profileDir, "providers.json"))
	if err != nil {
		return nil, fmt.Errorf("read providers.json: %w", err)
	}
	var pf providersFile
	if err := json.Unmarshal(data, &pf); err != nil {
		return nil, fmt.Errorf("decode providers.json: %w", err)
	}
	return pf.Providers, nil
}

// ─── Probe ───────────────────────────────────────────────────────────────

// providerBaseURL — falls back through the modes the catalog exposes.
// Some entries (mimo) carry only the legacy BaseURL field; others fill
// api_key.base_url. We need at least one.
func providerBaseURL(p providerEntry) string {
	if p.APIKey.BaseURL != "" {
		return p.APIKey.BaseURL
	}
	if p.BaseURL != "" {
		return p.BaseURL
	}
	// Hardcoded fallbacks for providers whose catalog entry is sparse.
	switch p.ID {
	case "alibaba":
		return "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"
	case "kimi":
		return "https://api.moonshot.ai/v1"
	case "mimo":
		return "https://api.xiaomimimo.com/v1"
	case "xai":
		return "https://api.x.ai/v1"
	case "zai":
		return "https://api.z.ai/api/coding/paas/v4"
	}
	return ""
}

func probe(client *http.Client, baseURL, key, model string) result {
	body := map[string]any{
		"model": model,
		"messages": []map[string]any{
			{"role": "system", "content": systemPrompt},
			{"role": "user", "content": userPrompt},
		},
		"response_format": map[string]any{
			"type": "json_schema",
			"json_schema": map[string]any{
				"name":   "person",
				"strict": true,
				"schema": json.RawMessage(schemaJSON),
			},
		},
		// No temperature — Kimi-K rejects anything but 1 ("only 1 is
		// allowed for this model"); other providers default to 1 anyway.
		// Determinism doesn't matter for the schema-enforcement question.
		"max_tokens": 300,
	}
	raw, _ := json.Marshal(body)

	url := strings.TrimRight(baseURL, "/") + "/chat/completions"
	req, err := http.NewRequest("POST", url, bytes.NewReader(raw))
	if err != nil {
		return result{Verdict: verdictError, Note: err.Error()}
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+key)

	start := time.Now()
	resp, err := client.Do(req)
	if err != nil {
		return result{Verdict: verdictError, Note: err.Error(), Latency: time.Since(start)}
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	lat := time.Since(start)

	if resp.StatusCode != 200 {
		// Trim to keep matrix compact.
		snip := strings.TrimSpace(string(respBody))
		if len(snip) > 120 {
			snip = snip[:120] + "…"
		}
		return result{Verdict: verdictError, Note: fmt.Sprintf("HTTP %d: %s", resp.StatusCode, snip), Latency: lat}
	}

	// Decode OpenAI-compat envelope.
	var env struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(respBody, &env); err != nil {
		return result{Verdict: verdictError, Note: "envelope decode: " + err.Error(), Latency: lat}
	}
	if len(env.Choices) == 0 {
		return result{Verdict: verdictError, Note: "no choices", Latency: lat}
	}
	content := strings.TrimSpace(env.Choices[0].Message.Content)
	// Strip ```json fences if the model added them despite instructions.
	content = stripFences(content)
	if content == "" {
		return result{Verdict: verdictIgnored, Note: "empty content", Latency: lat}
	}

	// Try to parse as JSON.
	var parsed map[string]any
	if err := json.Unmarshal([]byte(content), &parsed); err != nil {
		return result{Verdict: verdictIgnored, Note: firstLine(content), Latency: lat}
	}

	// Classify against schema.
	v, note := classify(parsed)
	return result{Verdict: v, Note: note, Latency: lat}
}

func stripFences(s string) string {
	s = strings.TrimSpace(s)
	if strings.HasPrefix(s, "```") {
		// Drop opening ``` plus optional language tag, then trailing ```
		if i := strings.Index(s, "\n"); i > 0 {
			s = s[i+1:]
		}
		s = strings.TrimSuffix(strings.TrimSpace(s), "```")
	}
	return strings.TrimSpace(s)
}

func firstLine(s string) string {
	if i := strings.Index(s, "\n"); i > 0 {
		s = s[:i]
	}
	if len(s) > 80 {
		s = s[:80] + "…"
	}
	return s
}

// classify returns ENFORCED iff name+age+tags present with correct types
// and no extra keys (we sent additionalProperties:false). Anything else
// parseable but mismatched is LOOSE — the model produced JSON but the
// schema was not enforced.
func classify(m map[string]any) (verdict, string) {
	missing := []string{}
	wrong := []string{}
	if v, ok := m["name"]; !ok {
		missing = append(missing, "name")
	} else if _, ok := v.(string); !ok {
		wrong = append(wrong, "name(not string)")
	}
	if v, ok := m["age"]; !ok {
		missing = append(missing, "age")
	} else {
		// JSON numbers decode as float64 — accept any numeric.
		switch n := v.(type) {
		case float64:
			if n != float64(int64(n)) {
				wrong = append(wrong, "age(not integer)")
			}
		default:
			wrong = append(wrong, "age(not number)")
		}
	}
	if v, ok := m["tags"]; !ok {
		missing = append(missing, "tags")
	} else if arr, ok := v.([]any); !ok {
		wrong = append(wrong, "tags(not array)")
	} else {
		for i, e := range arr {
			if _, ok := e.(string); !ok {
				wrong = append(wrong, fmt.Sprintf("tags[%d](not string)", i))
				break
			}
		}
	}
	extras := []string{}
	for k := range m {
		if k != "name" && k != "age" && k != "tags" {
			extras = append(extras, k)
		}
	}
	sort.Strings(extras)
	if len(missing) == 0 && len(wrong) == 0 && len(extras) == 0 {
		return verdictEnforced, "ok"
	}
	notes := []string{}
	if len(missing) > 0 {
		notes = append(notes, "missing="+strings.Join(missing, ","))
	}
	if len(wrong) > 0 {
		notes = append(notes, "wrong="+strings.Join(wrong, ","))
	}
	if len(extras) > 0 {
		notes = append(notes, "extras="+strings.Join(extras, ","))
	}
	return verdictLoose, strings.Join(notes, "; ")
}

// ─── Main ────────────────────────────────────────────────────────────────

func main() {
	var (
		onlyProvider = flag.String("provider", "", "probe only this provider id (e.g. alibaba)")
		onlyModel    = flag.String("model", "", "probe only this model id")
		outFile      = flag.String("out", "", "write markdown matrix to this file (default: stdout)")
		concurrency  = flag.Int("concurrency", 1, "concurrent requests per provider (keep at 1 unless you trust the rate limits)")
	)
	flag.Parse()
	_ = concurrency // sequential by default — prevents 429 floods

	profileDir, err := profileRoot()
	if err != nil {
		die(err)
	}
	fmt.Fprintf(os.Stderr, "profile: %s\n", profileDir)

	keys, err := loadKeys(profileDir)
	if err != nil {
		die(err)
	}
	providers, err := loadProviders(profileDir)
	if err != nil {
		die(err)
	}

	client := &http.Client{Timeout: 60 * time.Second}
	results := []result{}

	// Inject providers that have keys in settings but were dropped from
	// the catalog (e.g. mimo / zai are flagged disabled in oracle but the
	// keys are still on disk and worth probing).
	providers = appendMissing(providers, keys)

	// Ad-hoc single-model override: -provider X -model Y probes that exact
	// pair even if the catalog snapshot doesn't list the model. Lets you
	// test new releases (e.g. grok-4.3) before the oracle catalog is updated.
	if *onlyProvider != "" && *onlyModel != "" {
		providers = ensureModelStub(providers, *onlyProvider, *onlyModel)
	}

	for _, p := range providers {
		if *onlyProvider != "" && p.ID != *onlyProvider {
			continue
		}
		// Skip providers we don't speak OpenAI-compat to in this probe.
		if p.ID == "anthropic" || p.ID == "google" {
			fmt.Fprintf(os.Stderr, "skip %s (non-OpenAI-compat shape — separate probe needed)\n", p.ID)
			continue
		}
		key, ok := keys[p.ID]
		if !ok || key == "" {
			fmt.Fprintf(os.Stderr, "skip %s (no api key in settings)\n", p.ID)
			continue
		}
		baseURL := providerBaseURL(p)
		if baseURL == "" {
			fmt.Fprintf(os.Stderr, "skip %s (no base url)\n", p.ID)
			continue
		}

		for _, m := range p.Models {
			if *onlyModel != "" && m.ID != *onlyModel {
				continue
			}
			if m.Deprecated || !m.AvailableOnApiKey {
				continue
			}
			// Skip vision/tts-only models — structured output not their job.
			if isVisionOrTTS(m.ID) {
				continue
			}
			fmt.Fprintf(os.Stderr, "→ %s/%s … ", p.ID, m.ID)
			r := probe(client, baseURL, key, m.ID)
			r.Provider = p.ID
			r.Model = m.ID
			fmt.Fprintf(os.Stderr, "%s (%dms) %s\n", r.Verdict, r.Latency.Milliseconds(), r.Note)
			results = append(results, r)
		}
	}

	out := os.Stdout
	if *outFile != "" {
		f, err := os.Create(*outFile)
		if err != nil {
			die(err)
		}
		defer f.Close()
		out = f
	}
	writeMatrix(out, results)
}

// appendMissing — add stub catalog entries for providers that have a key
// in settings but no row in providers.json. Lets the probe cover providers
// that were disabled in oracle but still have credentials on disk.
func appendMissing(providers []providerEntry, keys map[string]string) []providerEntry {
	have := map[string]bool{}
	for _, p := range providers {
		have[p.ID] = true
	}
	type stub struct {
		baseURL string
		models  []string
	}
	stubs := map[string]stub{
		"mimo": {
			baseURL: "https://api.xiaomimimo.com/v1",
			models:  []string{"mimo-v2.5-pro", "mimo-v2.5", "mimo-v2-pro", "mimo-v2-flash"},
		},
		"zai": {
			baseURL: "https://api.z.ai/api/coding/paas/v4",
			models:  []string{"glm-4.7", "glm-4.6", "glm-4.5", "glm-4.5-air", "GLM-4.7-Flash"},
		},
	}
	for id, s := range stubs {
		if have[id] {
			continue
		}
		if _, ok := keys[id]; !ok {
			continue
		}
		entry := providerEntry{ID: id, Name: id}
		entry.APIKey.Enabled = true
		entry.APIKey.BaseURL = s.baseURL
		entry.BaseURL = s.baseURL
		for _, m := range s.models {
			entry.Models = append(entry.Models, struct {
				ID                string   `json:"id"`
				Name              string   `json:"name"`
				Capabilities      []string `json:"capabilities"`
				AvailableOnApiKey bool     `json:"available_on_api_key"`
				Deprecated        bool     `json:"deprecated"`
			}{ID: m, Name: m, AvailableOnApiKey: true})
		}
		providers = append(providers, entry)
	}
	return providers
}

// ensureModelStub — make sure (provider, model) is probeable even when the
// catalog snapshot doesn't include it. Mutates the providers slice and
// returns it.
func ensureModelStub(providers []providerEntry, providerID, modelID string) []providerEntry {
	for i, p := range providers {
		if p.ID != providerID {
			continue
		}
		for _, m := range p.Models {
			if m.ID == modelID {
				return providers
			}
		}
		providers[i].Models = append(providers[i].Models, struct {
			ID                string   `json:"id"`
			Name              string   `json:"name"`
			Capabilities      []string `json:"capabilities"`
			AvailableOnApiKey bool     `json:"available_on_api_key"`
			Deprecated        bool     `json:"deprecated"`
		}{ID: modelID, Name: modelID, AvailableOnApiKey: true})
		return providers
	}
	return providers
}

func isVisionOrTTS(id string) bool {
	low := strings.ToLower(id)
	for _, sub := range []string{"-tts", "-vision", "-vl-", "vl-max", "vl-plus", "-image", "-audio"} {
		if strings.Contains(low, sub) {
			return true
		}
	}
	return false
}

func writeMatrix(w io.Writer, results []result) {
	sort.Slice(results, func(i, j int) bool {
		if results[i].Provider != results[j].Provider {
			return results[i].Provider < results[j].Provider
		}
		return results[i].Model < results[j].Model
	})
	fmt.Fprintln(w, "# Structured-output probe matrix")
	fmt.Fprintln(w, "")
	fmt.Fprintln(w, "Generated by `scripts/probe-structured.go`. Each row sends a single")
	fmt.Fprintln(w, "`response_format: json_schema` chat completion with a strict 3-field")
	fmt.Fprintln(w, "schema (`name:string, age:integer, tags:string[]`, `additionalProperties:false`)")
	fmt.Fprintln(w, "and classifies the response.")
	fmt.Fprintln(w, "")
	fmt.Fprintln(w, "| Provider | Model | Verdict | Latency | Note |")
	fmt.Fprintln(w, "|---|---|---|---:|---|")
	for _, r := range results {
		fmt.Fprintf(w, "| %s | `%s` | %s | %dms | %s |\n",
			r.Provider, r.Model, r.Verdict, r.Latency.Milliseconds(), r.Note)
	}
}

func die(err error) {
	fmt.Fprintln(os.Stderr, "error:", err)
	os.Exit(1)
}
