#!/bin/bash
# Run GEPA optimization on an agent parameter
# Usage: ./optimize.sh --param coder_skill_frontend
#        ./optimize.sh --param coder_config --tasks landing_page --generations 5
#        ./optimize.sh --param coder_skill_frontend --generations 10 --population 5
set -e

EVAL_DIR="$(cd "$(dirname "$0")" && pwd)"
VENV="$EVAL_DIR/.venv"

if [ ! -d "$VENV" ]; then
    echo "Run ./setup.sh first"
    exit 1
fi
source "$VENV/bin/activate"

cd "$EVAL_DIR"
python3 run_optimization.py "$@"
