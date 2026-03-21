package transport

import (
	"bufio"
	"context"
	"encoding/json"
	"net"
	"strings"
	"testing"
)

func TestTCPServerRecoversFromStreamHandlerPanic(t *testing.T) {
	server := NewTCPServer("127.0.0.1:0")
	server.OnStream(func(ctx context.Context, req Request, emit func(StreamChunk)) {
		panic("boom")
	})

	serverConn, clientConn := net.Pipe()
	defer clientConn.Close()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	done := make(chan struct{})
	go func() {
		server.handleConn(ctx, serverConn)
		close(done)
	}()

	req := Request{ID: "stream-1", Type: "boom_stream"}
	if err := json.NewEncoder(clientConn).Encode(req); err != nil {
		t.Fatalf("encode request: %v", err)
	}

	line, err := bufio.NewReader(clientConn).ReadString('\n')
	if err != nil {
		t.Fatalf("read response: %v", err)
	}

	var chunk StreamChunk
	if err := json.Unmarshal([]byte(line), &chunk); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}

	if chunk.Type != "error" || !chunk.Done {
		t.Fatalf("expected terminal error chunk, got %#v", chunk)
	}

	data, _ := chunk.Data.(map[string]any)
	if !strings.Contains(data["error"].(string), "handler panic: boom") {
		t.Fatalf("expected panic error in chunk, got %#v", chunk.Data)
	}

	cancel()
	clientConn.Close()
	<-done
}

func TestTCPServerRecoversFromRequestHandlerPanic(t *testing.T) {
	server := NewTCPServer("127.0.0.1:0")
	server.OnRequest(func(ctx context.Context, req Request) Response {
		panic("boom")
	})

	serverConn, clientConn := net.Pipe()
	defer clientConn.Close()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	done := make(chan struct{})
	go func() {
		server.handleConn(ctx, serverConn)
		close(done)
	}()

	req := Request{ID: "req-1", Type: "boom.request"}
	if err := json.NewEncoder(clientConn).Encode(req); err != nil {
		t.Fatalf("encode request: %v", err)
	}

	line, err := bufio.NewReader(clientConn).ReadString('\n')
	if err != nil {
		t.Fatalf("read response: %v", err)
	}

	var resp Response
	if err := json.Unmarshal([]byte(line), &resp); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}

	if resp.Success {
		t.Fatalf("expected request failure response, got %#v", resp)
	}
	if !strings.Contains(resp.Error, "handler panic: boom") {
		t.Fatalf("expected panic error in response, got %#v", resp)
	}

	cancel()
	clientConn.Close()
	<-done
}
