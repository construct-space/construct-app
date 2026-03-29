package mcp

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"sync"
)

// stdioConn implements mcpConn over a child process's stdin/stdout.
type stdioConn struct {
	cmd    *exec.Cmd
	stdin  io.WriteCloser
	reader *bufio.Reader
	mu     sync.Mutex
}

func newStdioConn(ctx context.Context, cfg ServerConfig) (*stdioConn, error) {
	cmd := exec.CommandContext(ctx, cfg.Command, cfg.Args...)

	// Set environment
	cmd.Env = os.Environ()
	for k, v := range cfg.Env {
		cmd.Env = append(cmd.Env, k+"="+v)
	}

	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, fmt.Errorf("stdin pipe: %w", err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("stdout pipe: %w", err)
	}
	cmd.Stderr = os.Stderr

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("start %s: %w", cfg.Command, err)
	}

	return &stdioConn{
		cmd:    cmd,
		stdin:  stdin,
		reader: bufio.NewReader(stdout),
	}, nil
}

func (c *stdioConn) Send(msg json.RawMessage) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	_, err := c.stdin.Write(append(msg, '\n'))
	return err
}

func (c *stdioConn) Recv() (json.RawMessage, error) {
	line, err := c.reader.ReadBytes('\n')
	if err != nil {
		return nil, err
	}
	return json.RawMessage(bytes.TrimSpace(line)), nil
}

func (c *stdioConn) Close() error {
	c.stdin.Close()
	return c.cmd.Process.Kill()
}
