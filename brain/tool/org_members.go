package tool

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

// OrgMembers fetches the current org's member roster from the source API.
// Exposes name, email, role, department, and avatar so the agent can
// resolve "who is Valmir?", "list my team", "who's in sales?", etc.
// without asking the user.
type OrgMembers struct {
	SourceURL string
	AuthToken string
}

func (OrgMembers) Name() string { return "org_members" }

func (OrgMembers) Description() string {
	return "List members of the current org — name, email, role, department. Use to resolve a person by name before sending email, to answer 'who is on my team', or to look up someone's role."
}

func (OrgMembers) InputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"department": map[string]any{
				"type":        "string",
				"description": "Filter by department name (case-insensitive substring match). Omit to return all members.",
			},
			"role": map[string]any{
				"type":        "string",
				"description": "Filter by role (case-insensitive substring match). Omit to return all roles.",
			},
			"q": map[string]any{
				"type":        "string",
				"description": "Search by name or email (case-insensitive substring match).",
			},
		},
	}
}

type orgMember struct {
	ID           string `json:"id"`
	UserID       string `json:"user_id"`
	Name         string `json:"name"`
	Email        string `json:"email"`
	Role         string `json:"role"`
	Department   string `json:"department,omitempty"`    // resolved name, set by Execute
	DepartmentID string `json:"department_id,omitempty"` // raw FK from API
	Avatar       string `json:"avatar,omitempty"`
	Status       string `json:"status,omitempty"`
}

func (t OrgMembers) Execute(ctx context.Context, raw json.RawMessage) (string, error) {
	var in struct {
		Department string `json:"department"`
		Role       string `json:"role"`
		Q          string `json:"q"`
	}
	_ = json.Unmarshal(raw, &in)

	sourceURL := t.SourceURL
	if sourceURL == "" {
		sourceURL = "https://my.construct.space/api/source"
	}
	sourceURL = strings.TrimRight(sourceURL, "/")

	client := &http.Client{Timeout: 10 * time.Second}

	members, err := fetchJSON[[]orgMember](ctx, client, t.AuthToken, sourceURL+"/org/members")
	if err != nil {
		return "", fmt.Errorf("org_members: %w", err)
	}

	// Resolve department IDs → names
	depts, _ := fetchJSON[[]department](ctx, client, t.AuthToken, sourceURL+"/org/departments")
	deptNames := map[string]string{}
	for _, d := range depts {
		deptNames[d.ID] = d.Name
	}
	for i := range members {
		if members[i].DepartmentID != "" && members[i].Department == "" {
			if name, ok := deptNames[members[i].DepartmentID]; ok {
				members[i].Department = name
			}
		}
	}

	// Apply filters
	dept := strings.ToLower(strings.TrimSpace(in.Department))
	role := strings.ToLower(strings.TrimSpace(in.Role))
	q := strings.ToLower(strings.TrimSpace(in.Q))

	filtered := members[:0]
	for _, m := range members {
		if dept != "" && !strings.Contains(strings.ToLower(m.Department), dept) {
			continue
		}
		if role != "" && !strings.Contains(strings.ToLower(m.Role), role) {
			continue
		}
		if q != "" {
			hay := strings.ToLower(m.Name + " " + m.Email)
			if !strings.Contains(hay, q) {
				continue
			}
		}
		filtered = append(filtered, m)
	}

	if len(filtered) == 0 {
		return "no members found", nil
	}

	out, err := json.MarshalIndent(map[string]any{
		"total":   len(filtered),
		"members": filtered,
	}, "", "  ")
	if err != nil {
		return "", err
	}
	return string(out), nil
}
