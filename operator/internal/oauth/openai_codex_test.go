package oauth

import (
	"encoding/base64"
	"encoding/json"
	"testing"
)

func TestExtractOpenAICodexIdentity(t *testing.T) {
	payload := map[string]any{
		"email": "user@example.com",
		"https://api.openai.com/auth": map[string]any{
			"chatgpt_account_id": "acct_123",
		},
	}
	payloadJSON, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}

	token := "header." + base64.RawURLEncoding.EncodeToString(payloadJSON) + ".signature"
	accountID, email := extractOpenAICodexIdentity(token)

	if accountID != "acct_123" {
		t.Fatalf("expected account id acct_123, got %q", accountID)
	}
	if email != "user@example.com" {
		t.Fatalf("expected email user@example.com, got %q", email)
	}
}
