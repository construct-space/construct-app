package tool

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// OrgInvite sends an email invitation to join the org.
type OrgInvite struct {
	SourceURL string
	AuthToken string
}

func (OrgInvite) Name() string { return "org_invite" }

func (OrgInvite) Description() string {
	return "Invite someone to join the org by email. Sends an invitation email with a join link. Use when the user says 'invite X to the team' or 'add X as a member'."
}

func (OrgInvite) InputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"email": map[string]any{
				"type":        "string",
				"description": "Email address to invite.",
			},
			"role": map[string]any{
				"type":        "string",
				"description": "Role to assign: member, admin. Defaults to member.",
				"enum":        []string{"member", "admin"},
			},
			"department_id": map[string]any{
				"type":        "string",
				"description": "Optional department ID to assign. Get IDs from org_departments.",
			},
		},
		"required": []string{"email"},
	}
}

func (t OrgInvite) Execute(ctx context.Context, raw json.RawMessage) (string, error) {
	var in struct {
		Email        string  `json:"email"`
		Role         string  `json:"role"`
		DepartmentID *string `json:"department_id"`
	}
	if err := json.Unmarshal(raw, &in); err != nil || strings.TrimSpace(in.Email) == "" {
		return "", fmt.Errorf("org_invite: email is required")
	}

	sourceURL := strings.TrimRight(t.SourceURL, "/")
	if sourceURL == "" {
		sourceURL = "https://my.construct.space/api/source"
	}

	payload, _ := json.Marshal(map[string]any{
		"email":         strings.TrimSpace(in.Email),
		"role":          in.Role,
		"department_id": in.DepartmentID,
	})

	client := &http.Client{Timeout: 15 * time.Second}
	req, err := http.NewRequestWithContext(ctx, "POST", sourceURL+"/org/invites", bytes.NewReader(payload))
	if err != nil {
		return "", fmt.Errorf("org_invite: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+t.AuthToken)
	req.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("org_invite: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<10))
	if resp.StatusCode != 200 && resp.StatusCode != 201 {
		var e struct {
			Error string `json:"error"`
		}
		_ = json.Unmarshal(body, &e)
		msg := e.Error
		if msg == "" {
			msg = fmt.Sprintf("HTTP %d", resp.StatusCode)
		}
		return "", fmt.Errorf("org_invite failed: %s", msg)
	}

	var result map[string]any
	_ = json.Unmarshal(body, &result)
	out, _ := json.MarshalIndent(map[string]any{
		"status":  "invited",
		"email":   in.Email,
		"details": result,
	}, "", "  ")
	return string(out), nil
}
