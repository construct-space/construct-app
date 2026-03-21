// Package config — Construct port allocation.
// All Construct services use ports in the 60100–60109 range.
// See docs/ports.md for the full map.
package config

const (
	// PortOperator is the primary TCP port for Tauri → Operator communication.
	PortOperator = 60100

	// PortDesktopBridge is the HTTP port for Operator → Tauri reverse bridge.
	PortDesktopBridge = 60101

	// PortOperatorHTTP is reserved for external HTTP/SSE clients.
	PortOperatorHTTP = 60102
)
