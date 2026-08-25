#!/usr/bin/env bash
# Start OSC gateway + Vite dev server (macOS / Linux)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ ! -d node_modules ]]; then
  echo "node_modules missing — running install first..."
  "$ROOT/scripts/install.sh"
fi

GATEWAY_PID=""
VITE_PID=""

cleanup() {
  echo
  echo "==> stopping..."
  [[ -n "$GATEWAY_PID" ]] && kill "$GATEWAY_PID" 2>/dev/null || true
  [[ -n "$VITE_PID" ]] && kill "$VITE_PID" 2>/dev/null || true
  wait 2>/dev/null || true
}

trap cleanup EXIT INT TERM

echo "==> DATA-DRIVER"
echo "    OSC gateway  →  ws://127.0.0.1:8081"
echo "    Web UI       →  http://localhost:5173"
echo "    OSC out/in   →  udp :57121 / :9001  (change in UI)"
echo
echo "Press Ctrl+C to stop both services."
echo

npm run gateway &
GATEWAY_PID=$!

# Brief pause so gateway binds before the browser opens
sleep 0.5

npm run dev &
VITE_PID=$!

wait "$VITE_PID" "$GATEWAY_PID"
