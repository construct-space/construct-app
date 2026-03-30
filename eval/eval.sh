#!/bin/bash
# Evaluate current agent params without optimizing
# Usage: ./eval.sh --param coder_skill_frontend
#        ./eval.sh --param coder_config --tasks landing_page
set -e

EVAL_DIR="$(cd "$(dirname "$0")" && pwd)"
VENV="$EVAL_DIR/.venv"

if [ ! -d "$VENV" ]; then
    echo "Run ./setup.sh first"
    exit 1
fi
source "$VENV/bin/activate"

cd "$EVAL_DIR"
python3 run_optimization.py --eval-only "$@"
