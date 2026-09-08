// Package wire defines the JSON-line protocol brain speaks over TCP.
//
// Frame: one JSON object per line, both directions.
//
// Request:  {"id":"r1","type":"prompt","client_id":"...","payload":{...}}
// Response: {"id":"r1","success":true,"data":...,"done":true}
// Chunk:    {"id":"r1","type":"text_delta","data":{"delta":"hi"}}
// Final:    {"id":"r1","type":"end","success":true,"done":true}
package wire

import "encoding/json"

type Request struct {
	ID       string          `json:"id"`
	Type     string          `json:"type"`
	ClientID string          `json:"client_id,omitempty"`
	Payload  json.RawMessage `json:"payload,omitempty"`
}

type Response struct {
	ID      string `json:"id"`
	Type    string `json:"type,omitempty"`
	Success bool   `json:"success,omitempty"`
	Data    any    `json:"data,omitempty"`
	Error   string `json:"error,omitempty"`
	Done    bool   `json:"done,omitempty"`
}
