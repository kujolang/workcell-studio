#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT=43174
mkdir -p "$ROOT/../.workcell-host-tmp"
DATA_ROOT="$(mktemp -d "$ROOT/../.workcell-host-tmp/studio-eval.XXXXXX")"
cleanup() {
  if [ -n "${SERVER_PID:-}" ]; then kill "$SERVER_PID" 2>/dev/null || true; wait "$SERVER_PID" 2>/dev/null || true; fi
  rm -rf "$DATA_ROOT"
}
trap cleanup EXIT
STUDIO_DATA_ROOT="$DATA_ROOT/data" PORT="$PORT" node "$ROOT/src/server/main.js" >"$DATA_ROOT/server.log" 2>&1 &
SERVER_PID=$!
for _ in $(seq 1 40); do curl -fsS "http://127.0.0.1:$PORT/api/ready" >/dev/null 2>&1 && break; sleep 0.25; done
cd "$ROOT"
kujo run ../eval/main.kujo run eval/studio.json --output-dir .eval-results --artifact-checksums --json
kujo run ../eval/main.kujo verify-manifest --output-dir .eval-results --json
