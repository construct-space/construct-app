#!/bin/bash
# Install Python 3.12, create venv, install GEPA + deps
set -e

EVAL_DIR="$(cd "$(dirname "$0")" && pwd)"
VENV="$EVAL_DIR/.venv"

echo "=== Construct Eval Setup ==="

# Install Python 3.12 if missing
if ! /opt/homebrew/opt/python@3.12/bin/python3 --version &>/dev/null; then
    echo "Installing Python 3.12..."
    brew install python@3.12
fi
PYTHON="/opt/homebrew/opt/python@3.12/bin/python3"
echo "Python: $($PYTHON --version)"

# Create venv
if [ ! -d "$VENV" ]; then
    echo "Creating venv..."
    $PYTHON -m venv "$VENV"
fi
source "$VENV/bin/activate"

# Install deps
pip install --upgrade pip --quiet
pip install "gepa[full]" pyyaml httpx --quiet

echo ""
echo "Done. Run: ./eval.sh --param coder_skill_frontend"
