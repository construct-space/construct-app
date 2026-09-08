package tool

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// OrgDepartments fetches the org's department list including member counts.
type OrgDepartments struct {
	SourceURL string
	AuthToken string
}

func (OrgDepartments) Name() string { return "org_departments" }

func (OrgDepartments) Description() string {
	return "List departments in the org — name, code, head, member count. Use when the user asks about org structure, departments, or to resolve 'tell the dev team' / 'email finance'."
}

func (OrgDepartments) InputSchema() map[string]any {
	return map[string]any{"type": "object", "properties": map[string]any{}}
}

type department struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	Code        string  `json:"code,omitempty"`
	Description string  `json:"description,omitempty"`
	HeadID      *string `json:"head_id,omitempty"`
}

func (t OrgDepartments) Execute(ctx context.Context, _ json.RawMessage) (string, error) {
	sourceURL := strings.TrimRight(t.SourceURL, "/")
	if sourceURL == "" {
		sourceURL = "https://my.construct.space/api/source"
	}

	client := &http.Client{Timeout: 10 * time.Second}

	// Fetch departments
	depts, err := fetchJSON[[]department](ctx, client, t.AuthToken, sourceURL+"/org/departments")
	if err != nil {
		return "", fmt.Errorf("org_departments: %w", err)
	}

	// Fetch members to compute per-department count
	members, _ := fetchJSON[[]orgMember](ctx, client, t.AuthToken, sourceURL+"/org/members")

	type deptOut struct {
		ID          string `json:"id"`
		Name        string `json:"name"`
		Code        string `json:"code,omitempty"`
		Description string `json:"description,omitempty"`
		Members     int    `json:"members"`
	}

	// Count members per department_id
	counts := map[string]int{}
	for _, m := range members {
		if m.DepartmentID != "" {
			counts[m.DepartmentID]++
		}
	}

	out := make([]deptOut, 0, len(depts))
	for _, d := range depts {
		out = append(out, deptOut{
			ID:          d.ID,
			Name:        d.Name,
			Code:        d.Code,
			Description: d.Description,
			Members:     counts[d.ID],
		})
	}

	body, _ := json.MarshalIndent(map[string]any{
		"total":       len(out),
		"departments": out,
	}, "", "  ")
	return string(body), nil
}

// fetchJSON is a tiny generic helper shared by org tools to avoid boilerplate.
func fetchJSON[T any](ctx context.Context, client *http.Client, token, url string) (T, error) {
	var zero T
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return zero, err
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := client.Do(req)
	if err != nil {
		return zero, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return zero, fmt.Errorf("HTTP %d: %s", resp.StatusCode, b)
	}
	b, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if err != nil {
		return zero, err
	}
	var v T
	return v, json.Unmarshal(b, &v)
}
