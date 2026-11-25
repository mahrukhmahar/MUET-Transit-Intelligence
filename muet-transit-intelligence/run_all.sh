#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"
export PYTHONPATH=.

echo "[1/2] Running canonical Python experiments, generating figures and compiled PDF..."
python3 -m experiments.run_experiments

echo "[2/2] Running verification test suite..."
if command -v pytest >/dev/null 2>&1; then
  pytest -v
else
  python3 -m unittest discover -s tests -t . -v
fi
