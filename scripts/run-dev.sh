#!/usr/bin/env bash
# Vite dev server only (macOS / Linux)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

[[ -d node_modules ]] || "$ROOT/scripts/install.sh"

echo "==> Web UI → http://localhost:5173"
echo "    (Start ./scripts/run-gateway.sh in another terminal for OSC)"
echo

npm run dev
