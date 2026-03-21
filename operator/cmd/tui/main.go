package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"net"
	"os"
	"strings"
	"sync/atomic"
	"time"
)

var reqCounter atomic.Int64

func nextID() string {
	return fmt.Sprintf("r%d", reqCounter.Add(1))
}

func send(conn net.Conn, reqType string, payload map[string]any) (map[string]any, error) {
	id := nextID()
	req := map[string]any{"id": id, "type": reqType}
	if payload != nil {
		req["payload"] = payload
	}

	data, _ := json.Marshal(req)
	conn.Write(append(data, '\n'))

	reader := bufio.NewReader(conn)
	for {
		conn.SetReadDeadline(time.Now().Add(120 * time.Second))
		line, err := reader.ReadString('\n')
		if err != nil {
			return nil, err
		}
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		var resp map[string]any
		if err := json.Unmarshal([]byte(line), &resp); err != nil {
			continue
		}

		// Match by request ID
		if respID, _ := resp["id"].(string); respID == id {
			return resp, nil
		}

		// Print broadcasts inline
		if bType, _ := resp["type"].(string); bType != "" {
			fmt.Printf("  \033[33m⚡ %s\033[0m\n", bType)
		}
	}
}

func main() {
	addr := "127.0.0.1:60100"
	if len(os.Args) > 1 {
		addr = os.Args[1]
	}

	fmt.Printf("\033[36m🔌 Connecting to operator at %s...\033[0m\n", addr)
	conn, err := net.DialTimeout("tcp", addr, 5*time.Second)
	if err != nil {
		fmt.Fprintf(os.Stderr, "❌ Failed to connect: %v\n", err)
		os.Exit(1)
	}
	defer conn.Close()
	fmt.Printf("\033[32m✅ Connected\033[0m\n\n")

	// Interactive REPL
	scanner := bufio.NewScanner(os.Stdin)
	fmt.Printf("Commands: ping, providers, agents, dispatch <agent> <task>, tools, quit\n")
	fmt.Printf("Or type a raw request: <type> [json-payload]\n\n")

	for {
		fmt.Print("\033[35moperator>\033[0m ")
		if !scanner.Scan() {
			break
		}
		input := strings.TrimSpace(scanner.Text())
		if input == "" {
			continue
		}

		switch {
		case input == "quit" || input == "exit":
			return

		case input == "ping":
			resp, err := send(conn, "system.ping", nil)
			if err != nil {
				fmt.Printf("❌ %v\n", err)
				continue
			}
			printResp(resp)

		case input == "providers":
			resp, err := send(conn, "providers.list", nil)
			if err != nil {
				fmt.Printf("❌ %v\n", err)
				continue
			}
			printResp(resp)

		case input == "agents":
			resp, err := send(conn, "agents.list", nil)
			if err != nil {
				fmt.Printf("❌ %v\n", err)
				continue
			}
			printResp(resp)

		case input == "tools":
			resp, err := send(conn, "tools.list", nil)
			if err != nil {
				fmt.Printf("❌ %v\n", err)
				continue
			}
			printResp(resp)

		case strings.HasPrefix(input, "dispatch "):
			parts := strings.SplitN(input[9:], " ", 2)
			if len(parts) < 2 {
				fmt.Println("Usage: dispatch <agent_id> <task>")
				continue
			}
			agentID := parts[0]
			task := parts[1]
			fmt.Printf("⏳ Dispatching %s...\n", agentID)
			resp, err := send(conn, "agents.dispatch", map[string]any{
				"agent_id": agentID,
				"task":     task,
			})
			if err != nil {
				fmt.Printf("❌ %v\n", err)
				continue
			}
			printResp(resp)

		case strings.HasPrefix(input, "chat "):
			message := input[5:]
			fmt.Printf("⏳ Sending to AI...\n")
			resp, err := send(conn, "ai.chat", map[string]any{
				"message": message,
			})
			if err != nil {
				fmt.Printf("❌ %v\n", err)
				continue
			}
			printResp(resp)

		default:
			// Raw request: type [json-payload]
			parts := strings.SplitN(input, " ", 2)
			reqType := parts[0]
			var payload map[string]any
			if len(parts) > 1 {
				if err := json.Unmarshal([]byte(parts[1]), &payload); err != nil {
					fmt.Printf("❌ Invalid JSON payload: %v\n", err)
					continue
				}
			}
			resp, err := send(conn, reqType, payload)
			if err != nil {
				fmt.Printf("❌ %v\n", err)
				continue
			}
			printResp(resp)
		}
		fmt.Println()
	}
}

func printResp(resp map[string]any) {
	success, _ := resp["success"].(bool)
	if success {
		fmt.Printf("\033[32m✅ Success\033[0m\n")
	} else {
		errMsg, _ := resp["error"].(string)
		fmt.Printf("\033[31m❌ Error: %s\033[0m\n", errMsg)
	}

	if data, ok := resp["data"]; ok {
		pretty, _ := json.MarshalIndent(data, "  ", "  ")
		output := string(pretty)
		// Truncate long output
		if len(output) > 3000 {
			output = output[:3000] + "\n  ... (truncated)"
		}
		fmt.Printf("  %s\n", output)
	}
}
