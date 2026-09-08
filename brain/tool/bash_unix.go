//go:build unix

package tool

import (
	"os/exec"
	"syscall"
)

// setupProcessGroup puts the command in its own process group and makes
// cancel/timeout kill the whole group, so children spawned by `sh -c`
// (dev servers, package managers) die with it instead of orphaning and
// holding the output pipe open.
func setupProcessGroup(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Cancel = func() error {
		if cmd.Process == nil {
			return nil
		}
		return syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
	}
}
