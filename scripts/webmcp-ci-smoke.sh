#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
mkdir -p "$ROOT/../.workcell-host-tmp"
DATA_ROOT="$(mktemp -d "$ROOT/../.workcell-host-tmp/studio-webmcp.XXXXXX")"
cleanup() {
  status=$?
  for pid in "${CHROME_PID:-}" "${SERVER_PID:-}"; do
    if [ -n "$pid" ]; then kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; fi
  done
  if [ "$status" -ne 0 ]; then
    cat "$DATA_ROOT/server.log" "$DATA_ROOT/chrome.log" >&2 || true
  fi
  rm -rf "$DATA_ROOT"
  return "$status"
}
trap cleanup EXIT
google-chrome --version
STUDIO_DATA_ROOT="$DATA_ROOT/data" PORT=4173 node src/server/main.js >"$DATA_ROOT/server.log" 2>&1 &
SERVER_PID=$!
for _ in $(seq 1 50); do
  if curl -fsS http://127.0.0.1:4173/api/ready >/dev/null; then break; fi
  sleep 0.2
done
curl -fsS http://127.0.0.1:4173/api/ready >/dev/null
google-chrome --headless --no-first-run --no-default-browser-check \
  --enable-features=WebMCP,WebMCPTesting,DevToolsWebMCPSupport \
  --remote-debugging-port=9333 --user-data-dir="$DATA_ROOT/chrome" \
  http://127.0.0.1:4173 >"$DATA_ROOT/chrome.log" 2>&1 &
CHROME_PID=$!
for _ in $(seq 1 50); do
  if curl -fsS http://127.0.0.1:9333/json/list | jq -e 'any(.[]; .url | startswith("http://127.0.0.1:4173"))' >/dev/null; then break; fi
  sleep 0.2
done
timeout 240 npm run webmcp:smoke
