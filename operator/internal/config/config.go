// Package config provides configuration loading for the Construct Operator.
// It reads a simple key=value file (TOML-like) without external dependencies.
package config

import (
	"bufio"
	"fmt"
	"os"
	"strconv"
	"strings"
)

// Config holds all operator settings.
type Config struct {
	Port         int               `json:"port"`
	WorkDir      string            `json:"work_dir"`
	DefaultModel string            `json:"default_model"`
	LogLevel     string            `json:"log_level"`
	LogDir       string            `json:"log_dir"`
	Providers    map[string]string `json:"providers"`    // provider_id → api_key
	HookTimeout  int               `json:"hook_timeout"` // seconds
	MaxSessions  int               `json:"max_sessions"`
	RetryMax     int               `json:"retry_max"`
}

// Default returns a Config with sensible production defaults.
func Default() Config {
	return Config{
		Port:         PortOperator,
		WorkDir:      ".",
		DefaultModel: "claude-sonnet-4-6",
		LogLevel:     "info",
		LogDir:       "logs",
		Providers:    map[string]string{},
		HookTimeout:  30,
		MaxSessions:  100,
		RetryMax:     3,
	}
}

// Load reads a config file at path and returns a Config.
// The file format is line-based key = value (TOML-like).
//
// Supported syntax:
//
//	key = value
//	key = "quoted value"
//	# comment lines
//	[section]           — section headers set a prefix (e.g. [providers])
//
// Provider keys use the pattern:
//
//	[providers]
//	anthropic = sk-ant-...
//	deepseek  = sk-ds-...
func Load(path string) (Config, error) {
	cfg := Default()

	f, err := os.Open(path)
	if err != nil {
		return cfg, fmt.Errorf("config: open %s: %w", path, err)
	}
	defer f.Close()

	section := ""
	scanner := bufio.NewScanner(f)
	lineNum := 0

	for scanner.Scan() {
		lineNum++
		line := strings.TrimSpace(scanner.Text())

		// Skip empty lines and comments.
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}

		// Section header
		if strings.HasPrefix(line, "[") && strings.HasSuffix(line, "]") {
			section = strings.TrimSpace(line[1 : len(line)-1])
			continue
		}

		// Key = value
		idx := strings.Index(line, "=")
		if idx < 0 {
			return cfg, fmt.Errorf("config: line %d: expected key = value, got %q", lineNum, line)
		}

		key := strings.TrimSpace(line[:idx])
		val := strings.TrimSpace(line[idx+1:])

		// Strip surrounding quotes.
		if len(val) >= 2 && val[0] == '"' && val[len(val)-1] == '"' {
			val = val[1 : len(val)-1]
		}

		if section == "providers" {
			cfg.Providers[key] = val
			continue
		}

		// Top-level keys
		switch key {
		case "port":
			n, err := strconv.Atoi(val)
			if err != nil {
				return cfg, fmt.Errorf("config: line %d: port must be integer: %w", lineNum, err)
			}
			cfg.Port = n
		case "work_dir":
			cfg.WorkDir = val
		case "default_model":
			cfg.DefaultModel = val
		case "log_level":
			cfg.LogLevel = val
		case "log_dir":
			cfg.LogDir = val
		case "hook_timeout":
			n, err := strconv.Atoi(val)
			if err != nil {
				return cfg, fmt.Errorf("config: line %d: hook_timeout must be integer: %w", lineNum, err)
			}
			cfg.HookTimeout = n
		case "max_sessions":
			n, err := strconv.Atoi(val)
			if err != nil {
				return cfg, fmt.Errorf("config: line %d: max_sessions must be integer: %w", lineNum, err)
			}
			cfg.MaxSessions = n
		case "retry_max":
			n, err := strconv.Atoi(val)
			if err != nil {
				return cfg, fmt.Errorf("config: line %d: retry_max must be integer: %w", lineNum, err)
			}
			cfg.RetryMax = n
		default:
			// Unknown keys under a section are silently accepted for forward compat.
			if section == "" {
				return cfg, fmt.Errorf("config: line %d: unknown key %q", lineNum, key)
			}
		}
	}

	if err := scanner.Err(); err != nil {
		return cfg, fmt.Errorf("config: read %s: %w", path, err)
	}

	return cfg, nil
}
