#!/bin/bash
# Bridge script for book-to-skill extraction.
# Usage: ./run-extract.sh <mode> <paths...>
#   mode: technical | text
#   paths: one or more document file paths

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PYTHON_BIN="${PYTHON_BIN:-python3}"

if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
    PYTHON_BIN="python"
fi

exec "$PYTHON_BIN" "$SCRIPT_DIR/extract.py" "$@"
