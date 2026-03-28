package main

import "os"

type operatorConfig struct {
	port    string
	workDir string
	isDev   bool
}

func parseOperatorConfig(args []string) operatorConfig {
	cfg := operatorConfig{
		port: "60100",
	}
	for i, arg := range args {
		if arg == "--port" && i+1 < len(args) {
			cfg.port = args[i+1]
		}
		if arg == "--dir" && i+1 < len(args) {
			cfg.workDir = args[i+1]
		}
		if arg == "--dev" {
			cfg.isDev = true
		}
	}
	if cfg.workDir == "" {
		cfg.workDir, _ = os.Getwd()
	}
	return cfg
}
