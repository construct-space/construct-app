package desktop

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCallSuccess(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer test-token" {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		var req Request
		body, _ := io.ReadAll(r.Body)
		if err := json.Unmarshal(body, &req); err != nil {
			http.Error(w, "bad json", 400)
			return
		}

		if req.Method != "space.snapshot" {
			t.Errorf("expected method space.snapshot, got %s", req.Method)
		}

		resp := Response{
			ID:     req.ID,
			Result: json.RawMessage(`{"space_id":"project","title":"Test"}`),
		}
		json.NewEncoder(w).Encode(resp)
	}))
	defer srv.Close()

	c := &Client{
		addr:  srv.URL,
		token: "test-token",
		http:  http.DefaultClient,
	}

	result, err := c.Call(context.Background(), "space.snapshot", map[string]any{"space_id": "project"})
	if err != nil {
		t.Fatal(err)
	}

	var snap struct {
		SpaceID string `json:"space_id"`
		Title   string `json:"title"`
	}
	if err := json.Unmarshal(result, &snap); err != nil {
		t.Fatal(err)
	}
	if snap.SpaceID != "project" {
		t.Errorf("expected space_id project, got %s", snap.SpaceID)
	}
	if snap.Title != "Test" {
		t.Errorf("expected title Test, got %s", snap.Title)
	}
}

func TestCallBridgeError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req Request
		body, _ := io.ReadAll(r.Body)
		json.Unmarshal(body, &req)

		resp := Response{
			ID: req.ID,
			Error: &BridgeError{
				Code:    "no_target",
				Message: "No active space",
			},
		}
		json.NewEncoder(w).Encode(resp)
	}))
	defer srv.Close()

	c := &Client{
		addr:  srv.URL,
		token: "tok",
		http:  http.DefaultClient,
	}

	_, err := c.Call(context.Background(), "space.snapshot", nil)
	if err == nil {
		t.Fatal("expected error")
	}

	bridgeErr, ok := err.(*BridgeError)
	if !ok {
		t.Fatalf("expected *BridgeError, got %T: %v", err, err)
	}
	if bridgeErr.Code != "no_target" {
		t.Errorf("expected code no_target, got %s", bridgeErr.Code)
	}
}

func TestCallUnauthorized(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
	}))
	defer srv.Close()

	c := &Client{
		addr:  srv.URL,
		token: "bad-token",
		http:  http.DefaultClient,
	}

	_, err := c.Call(context.Background(), "ping", nil)
	if err == nil {
		t.Fatal("expected unauthorized error")
	}
}

func TestCallConnectionRefused(t *testing.T) {
	c := NewClient("tok")
	// Override addr to a port nothing is listening on
	c.addr = "http://127.0.0.1:19999/bridge"

	_, err := c.Call(context.Background(), "ping", nil)
	if err == nil {
		t.Fatal("expected connection error")
	}
}

func TestPing(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req Request
		body, _ := io.ReadAll(r.Body)
		json.Unmarshal(body, &req)

		resp := Response{
			ID:     req.ID,
			Result: json.RawMessage(`{"status":"ok"}`),
		}
		json.NewEncoder(w).Encode(resp)
	}))
	defer srv.Close()

	c := &Client{
		addr:  srv.URL,
		token: "tok",
		http:  http.DefaultClient,
	}

	if err := c.Ping(context.Background()); err != nil {
		t.Fatal(err)
	}
}

func TestNewClientAddr(t *testing.T) {
	c := NewClient("my-token")
	expected := fmt.Sprintf("http://127.0.0.1:%d/bridge", 60101)
	if c.addr != expected {
		t.Errorf("expected addr %s, got %s", expected, c.addr)
	}
	if c.token != "my-token" {
		t.Errorf("expected token my-token, got %s", c.token)
	}
}
