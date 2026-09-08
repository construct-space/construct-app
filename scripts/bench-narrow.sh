#!/usr/bin/env bash
# bench-narrow.sh — score a local OpenAI-compat model on narrow-flow tool calling.
#
# Usage:
#   bench-narrow.sh                              # defaults: LM Studio :1234, first model
#   bench-narrow.sh --url http://localhost:1234/v1 --model qwen3-4b-instruct-2507
#   bench-narrow.sh --url http://localhost:11435/v1 --model mlx-community/gemma-4-e2b-it-4bit
#
# Each case sends a user message + a small tool set. Pass = model emits a
# tool_call whose name matches the expected one. No retries, no second turn.
# That's the narrow-flow contract.

set -u

URL="http://localhost:1234/v1"
MODEL=""
VERBOSE=0

while [ $# -gt 0 ]; do
  case "$1" in
    --url) URL="$2"; shift 2 ;;
    --model) MODEL="$2"; shift 2 ;;
    -v|--verbose) VERBOSE=1; shift ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

if [ -z "$MODEL" ]; then
  MODEL=$(curl -sS "$URL/models" | jq -r '.data[0].id // empty')
  if [ -z "$MODEL" ]; then
    echo "no model loaded at $URL — pass --model or load one" >&2
    exit 1
  fi
fi

echo "endpoint: $URL"
echo "model:    $MODEL"
echo

# Tool set used for every case — mirrors a flower-shop space surface.
TOOLS='[
  {"type":"function","function":{"name":"add_order","description":"Add a flower order for a customer.","parameters":{"type":"object","properties":{"customer":{"type":"string"},"item":{"type":"string"},"qty":{"type":"integer"}},"required":["customer","item","qty"]}}},
  {"type":"function","function":{"name":"list_orders","description":"List orders for a given day.","parameters":{"type":"object","properties":{"day":{"type":"string","description":"YYYY-MM-DD or natural language like today, tomorrow"}},"required":["day"]}}},
  {"type":"function","function":{"name":"check_stock","description":"Check stock for a flower variety.","parameters":{"type":"object","properties":{"item":{"type":"string"}},"required":["item"]}}},
  {"type":"function","function":{"name":"cancel_order","description":"Cancel an order by id.","parameters":{"type":"object","properties":{"order_id":{"type":"string"}},"required":["order_id"]}}},
  {"type":"function","function":{"name":"daily_summary","description":"Summarize the day: revenue, orders, stock alerts.","parameters":{"type":"object","properties":{"day":{"type":"string"}},"required":["day"]}}}
]'

# Each line: <expected_tool>|<user_message>
CASES=(
  "add_order|Add 12 red tulips for Maria"
  "list_orders|What's on the schedule for today?"
  "check_stock|Do we have any sunflowers left?"
  "cancel_order|Cancel order A-2231 — customer changed mind"
  "daily_summary|Wrap up the day for me"
  "add_order|Put down 3 white lilies for John tomorrow"
  "list_orders|Show me Friday's deliveries"
  "check_stock|How many roses are in the cooler"
  "cancel_order|Kill order #88, the address was wrong"
  "daily_summary|Give me today's totals"
)

PASS=0
FAIL=0
TOTAL=${#CASES[@]}

for line in "${CASES[@]}"; do
  EXPECT="${line%%|*}"
  MSG="${line#*|}"

  REQ=$(jq -n --arg model "$MODEL" --arg msg "$MSG" --argjson tools "$TOOLS" '{
    model: $model,
    messages: [{role:"user", content:$msg}],
    tools: $tools,
    tool_choice: "required",
    max_tokens: 1024,
    temperature: 0
  }')

  RESP=$(curl -sS "$URL/chat/completions" \
    -H 'content-type: application/json' \
    -d "$REQ")

  GOT=$(echo "$RESP" | jq -r '.choices[0].message.tool_calls[0].function.name // "<none>"')

  if [ "$GOT" = "$EXPECT" ]; then
    PASS=$((PASS+1))
    printf "  PASS  %-18s  %s\n" "$EXPECT" "$MSG"
  else
    FAIL=$((FAIL+1))
    printf "  FAIL  expected=%-12s got=%-12s  %s\n" "$EXPECT" "$GOT" "$MSG"
    if [ "$VERBOSE" = "1" ]; then
      echo "$RESP" | jq '.choices[0].message' | sed 's/^/        /'
    fi
  fi
done

echo
PCT=$(( PASS * 100 / TOTAL ))
echo "result: $PASS / $TOTAL passed ($PCT%)"
