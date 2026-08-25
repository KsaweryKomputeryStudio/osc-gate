#!/usr/bin/env bash
# Install dependencies (macOS / Linux)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "==> DATA-DRIVER install"
echo "    $ROOT"
echo

if ! command -v node >/dev/null 2>&1; then
  echo "Error: Node.js is not installed."
  echo "Install from https://nodejs.org/ (LTS recommended) or: brew install node"
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "Error: npm is not installed."
  exit 1
fi

echo "Node $(node -v)"
echo "npm  $(npm -v)"
echo

npm install

echo
echo "Done."
echo "Run the app:  ./run"
