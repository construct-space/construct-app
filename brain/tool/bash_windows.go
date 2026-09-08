//go:build windows

package tool

import "os/exec"

// setupProcessGroup is a no-op on Windows: there is no POSIX process
// group to kill, and CommandContext's default Process.Kill plus the
// WaitDelay in bash.go bound the hang either way.
func setupProcessGroup(cmd *exec.Cmd) {}
