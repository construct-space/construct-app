#!/bin/bash
# Apply an optimized result back to the skill/config file
# Usage: ./apply.sh --param coder_skill_frontend --apply results/best_coder_skill_frontend_20260330.md
#
# Lists available results if no --apply given
set -e

EVAL_DIR="$(cd "$(dirname "$0")" && pwd)"
VENV="$EVAL_DIR/.venv"
RESULTS="$EVAL_DIR/results"

if [ ! -d "$VENV" ]; then
    echo "Run ./setup.sh first"
    exit 1
fi

# If no --apply flag, list available results
if ! echo "$@" | grep -q "\-\-apply"; then
    echo "Available results:"
    if [ -d "$RESULTS" ]; then
        ls -lt "$RESULTS"/best_*.md 2>/dev/null || echo "  (none yet — run ./optimize.sh first)"
    else
        echo "  (none yet — run ./optimize.sh first)"
    fi
    echo ""
    echo "Usage: ./apply.sh --param <name> --apply results/<file>.md"
    exit 0
fi

source "$VENV/bin/activate"
cd "$EVAL_DIR"
python3 run_optimization.py "$@"
