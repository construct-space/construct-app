package main

import (
	"construct-operator/internal/transport"
	"context"
	"fmt"
	"os"
)

const Version = "0.6.7"

func main() {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	setupOperatorLifecycle(cancel)

	cfg := parseOperatorConfig(os.Args[1:])
	opRuntime := newOperatorRuntime(cfg.workDir)
	requestDeps := assembleOperatorRuntime(opRuntime, ctx, cfg.isDev)

	// Start TCP transport
	srv := transport.NewTCPServer("127.0.0.1:" + cfg.port)
	srv.SetIdleShutdown(0, func() {
		fmt.Fprintf(os.Stderr, "[operator] idle timeout reached; no connected clients remain\n")
		cancel()
	})

	// Streaming handler — for *_stream request types
	srv.OnStream(func(reqCtx context.Context, req transport.Request, emit func(transport.StreamChunk)) {
		opRuntime.handleStream(reqCtx, req, emit)
	})

	requestDeps.server = srv
	srv.OnRequest(func(reqCtx context.Context, req transport.Request) transport.Response {
		return opRuntime.dispatchRequest(reqCtx, req, requestDeps)
	})

	fmt.Fprintf(os.Stderr, "[operator] v%s starting on :%s (workdir: %s)\n", Version, cfg.port, opRuntime.workDir)
	fmt.Fprintf(os.Stderr, "[operator] tools: %d registered\n", len(opRuntime.tools.All()))

	if err := srv.Serve(ctx); err != nil {
		fmt.Fprintf(os.Stderr, "[operator] error: %v\n", err)
		os.Exit(1)
	}
}
