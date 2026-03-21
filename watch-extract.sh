#!/bin/bash
# Auto-extract captured requests every 30 seconds
# Run: bash watch-extract.sh

DIR="/Users/flakerimi/Construct/construct-vue"
LAST_SIZE=0

echo "Watching claude-code-requests.json..."
echo "Press Ctrl+C to stop"
echo ""

while true; do
    SIZE=$(wc -c < "$DIR/claude-code-requests.json" 2>/dev/null || echo 0)
    if [ "$SIZE" != "$LAST_SIZE" ] && [ "$SIZE" -gt 10 ]; then
        echo "$(date +%H:%M:%S) | ${SIZE} bytes | extracting..."
        python3 "$DIR/extract-requests.py" 2>&1 | grep -E "^\[|^Total|^Raw"
        echo "---"
        LAST_SIZE=$SIZE
    fi
    sleep 30
done
