package main

import (
	"context"
	"fmt"
	"os"

	"construct-operator/internal/transport"
)

// dispatchRequest preserves the current request-match order while moving
// domain routing out of main.go.
func (rt *operatorRuntime) dispatchRequest(reqCtx context.Context, req transport.Request, deps requestDispatchDeps) transport.Response {
	if resp, handled := rt.dispatchFrontRequests(reqCtx, req, deps); handled {
		return resp
	}
	if resp, handled := rt.handleOAuthRequest(reqCtx, req); handled {
		return resp
	}
	if resp, handled := rt.handleSkillsHooksRequest(req); handled {
		return resp
	}

	fmt.Fprintf(os.Stderr, "[operator] unknown request type: %s\n", req.Type)
	return transport.Response{ID: req.ID, Success: false, Error: "unknown request type: " + req.Type}
}
