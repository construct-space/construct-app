package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"
)

func setupOperatorLifecycle(cancel context.CancelFunc) {
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-sig
		fmt.Fprintf(os.Stderr, "\n[operator] shutting down...\n")
		cancel()
	}()

	if ppidStr := os.Getenv("CONSTRUCT_PARENT_PID"); ppidStr != "" {
		if ppid, err := strconv.Atoi(ppidStr); err == nil && ppid > 0 {
			go func() {
				for {
					time.Sleep(2 * time.Second)
					proc, err := os.FindProcess(ppid)
					if err != nil {
						break
					}
					if err := proc.Signal(syscall.Signal(0)); err != nil {
						fmt.Fprintf(os.Stderr, "[operator] parent (pid=%d) is gone, self-terminating\n", ppid)
						cancel()
						return
					}
				}
			}()
		}
	}
}
