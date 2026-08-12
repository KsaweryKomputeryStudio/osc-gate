#!/usr/bin/env bash
# OSC gateway only (macOS / Linux)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

[[ -d node_modules ]] || "$ROOT/scripts/install.sh"

echo "==> OSC gateway"
echo "    ws://127.0.0.1:8081"
echo "    out udp://127.0.0.1:9000  in udp://0.0.0.0:9001"
echo

npm run gateway
