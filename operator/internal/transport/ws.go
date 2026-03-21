// WebSocket transport — alternative to TCP for browser clients.
// Uses gorilla/websocket-compatible handshake but with stdlib only.
// Each WebSocket message is a JSON frame (same Request/Response/StreamChunk types).
package transport

import (
	"bufio"
	"context"
	"crypto/sha1"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
)

const wsGUID = "258EAFA5-E914-47DA-95CA-5AB5DC085B11"

// WSServer implements Server over WebSocket.
type WSServer struct {
	addr    string
	handler Handler
	streamH StreamHandler

	clients   map[*wsConn]bool
	clientsMu sync.Mutex
}

func NewWSServer(addr string) *WSServer {
	return &WSServer{
		addr:    addr,
		clients: make(map[*wsConn]bool),
	}
}

func (s *WSServer) OnRequest(h Handler)      { s.handler = h }
func (s *WSServer) OnStream(h StreamHandler) { s.streamH = h }

func (s *WSServer) Serve(ctx context.Context) error {
	ln, err := net.Listen("tcp", s.addr)
	if err != nil {
		return fmt.Errorf("ws listen: %w", err)
	}
	defer ln.Close()

	fmt.Fprintf(os.Stderr, "[operator] websocket listening on %s\n", ln.Addr().String())

	go func() {
		<-ctx.Done()
		ln.Close()
	}()

	for {
		conn, err := ln.Accept()
		if err != nil {
			select {
			case <-ctx.Done():
				return nil
			default:
				continue
			}
		}
		go s.handleUpgrade(ctx, conn)
	}
}

func (s *WSServer) handleUpgrade(ctx context.Context, conn net.Conn) {
	defer conn.Close()

	reader := bufio.NewReader(conn)
	req, err := http.ReadRequest(reader)
	if err != nil {
		return
	}

	// Validate WebSocket upgrade
	if !strings.EqualFold(req.Header.Get("Upgrade"), "websocket") {
		conn.Write([]byte("HTTP/1.1 400 Bad Request\r\n\r\n"))
		return
	}

	key := req.Header.Get("Sec-WebSocket-Key")
	if key == "" {
		conn.Write([]byte("HTTP/1.1 400 Bad Request\r\n\r\n"))
		return
	}

	// Complete handshake
	accept := computeAcceptKey(key)
	resp := fmt.Sprintf("HTTP/1.1 101 Switching Protocols\r\n"+
		"Upgrade: websocket\r\n"+
		"Connection: Upgrade\r\n"+
		"Sec-WebSocket-Accept: %s\r\n\r\n", accept)
	conn.Write([]byte(resp))

	wsc := &wsConn{conn: conn, reader: reader}
	s.clientsMu.Lock()
	s.clients[wsc] = true
	s.clientsMu.Unlock()
	defer func() {
		s.clientsMu.Lock()
		delete(s.clients, wsc)
		s.clientsMu.Unlock()
	}()

	s.handleMessages(ctx, wsc)
}

func (s *WSServer) handleMessages(ctx context.Context, wsc *wsConn) {
	for {
		msg, err := wsc.readMessage()
		if err != nil {
			return
		}

		var req Request
		if err := json.Unmarshal(msg, &req); err != nil {
			wsc.writeJSON(Response{Success: false, Error: "invalid JSON"})
			continue
		}

		if s.isStreamRequest(req.Type) && s.streamH != nil {
			s.streamH(ctx, req, func(chunk StreamChunk) {
				chunk.ID = req.ID
				wsc.writeJSON(chunk)
			})
			continue
		}

		if s.handler != nil {
			resp := s.handler(ctx, req)
			resp.ID = req.ID
			if s.isStreamRequest(req.Type) {
				chunk := StreamChunk{ID: req.ID, Type: "done", Data: resp.Data, Done: true}
				if resp.Error != "" {
					chunk.Type = "error"
					chunk.Data = map[string]any{"error": resp.Error}
				}
				wsc.writeJSON(chunk)
			} else {
				wsc.writeJSON(resp)
			}
		}
	}
}

func (s *WSServer) isStreamRequest(reqType string) bool {
	return len(reqType) > 7 && reqType[len(reqType)-7:] == "_stream"
}

// Broadcast sends an event to all connected WebSocket clients.
func (s *WSServer) Broadcast(event StreamChunk) {
	s.clientsMu.Lock()
	defer s.clientsMu.Unlock()
	for wsc := range s.clients {
		wsc.writeJSON(event)
	}
}

// wsConn wraps a net.Conn with WebSocket framing.
type wsConn struct {
	conn   net.Conn
	reader *bufio.Reader
	mu     sync.Mutex
}

func (c *wsConn) readMessage() ([]byte, error) {
	// Read frame header
	header := make([]byte, 2)
	if _, err := io.ReadFull(c.reader, header); err != nil {
		return nil, err
	}

	// opcode := header[0] & 0x0f
	if header[0]&0x08 != 0 { // control frame (close, ping, pong)
		return nil, fmt.Errorf("connection closed")
	}

	masked := header[1]&0x80 != 0
	payloadLen := int64(header[1] & 0x7f)

	switch payloadLen {
	case 126:
		ext := make([]byte, 2)
		if _, err := io.ReadFull(c.reader, ext); err != nil {
			return nil, err
		}
		payloadLen = int64(binary.BigEndian.Uint16(ext))
	case 127:
		ext := make([]byte, 8)
		if _, err := io.ReadFull(c.reader, ext); err != nil {
			return nil, err
		}
		payloadLen = int64(binary.BigEndian.Uint64(ext))
	}

	var mask [4]byte
	if masked {
		if _, err := io.ReadFull(c.reader, mask[:]); err != nil {
			return nil, err
		}
	}

	payload := make([]byte, payloadLen)
	if _, err := io.ReadFull(c.reader, payload); err != nil {
		return nil, err
	}

	if masked {
		for i := range payload {
			payload[i] ^= mask[i%4]
		}
	}

	return payload, nil
}

func (c *wsConn) writeMessage(data []byte) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	frame := make([]byte, 0, 10+len(data))

	// FIN + text opcode
	frame = append(frame, 0x81)

	// Payload length (server frames are unmasked)
	switch {
	case len(data) < 126:
		frame = append(frame, byte(len(data)))
	case len(data) < 65536:
		frame = append(frame, 126)
		frame = append(frame, byte(len(data)>>8), byte(len(data)))
	default:
		frame = append(frame, 127)
		b := make([]byte, 8)
		binary.BigEndian.PutUint64(b, uint64(len(data)))
		frame = append(frame, b...)
	}

	frame = append(frame, data...)
	_, err := c.conn.Write(frame)
	return err
}

func (c *wsConn) writeJSON(v any) error {
	data, err := json.Marshal(v)
	if err != nil {
		return err
	}
	return c.writeMessage(data)
}

func computeAcceptKey(key string) string {
	h := sha1.New()
	h.Write([]byte(key + wsGUID))
	return base64.StdEncoding.EncodeToString(h.Sum(nil))
}
