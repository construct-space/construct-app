package mcp

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sync"
)

// httpConn implements mcpConn over HTTP POST (used for both TypeHTTP/SSE and TypeURL/Streamable HTTP).
type httpConn struct {
	url    string
	client *http.Client
	mu     sync.Mutex
	respCh chan json.RawMessage
}

func newHTTPConn(cfg ServerConfig) (*httpConn, error) {
	url := cfg.URL
	if url == "" {
		return nil, fmt.Errorf("URL required for HTTP transport")
	}
	return &httpConn{
		url:    url,
		client: &http.Client{},
		respCh: make(chan json.RawMessage, 64),
	}, nil
}

func (c *httpConn) Send(msg json.RawMessage) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	resp, err := c.client.Post(c.url, "application/json", bytes.NewReader(msg))
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	// If response has content, parse it
	if resp.StatusCode == http.StatusOK {
		body, err := io.ReadAll(resp.Body)
		if err != nil {
			return err
		}
		if len(body) > 0 {
			c.respCh <- json.RawMessage(body)
		}
	}
	return nil
}

func (c *httpConn) Recv() (json.RawMessage, error) {
	msg, ok := <-c.respCh
	if !ok {
		return nil, fmt.Errorf("connection closed")
	}
	return msg, nil
}

func (c *httpConn) Close() error {
	close(c.respCh)
	return nil
}
