#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${STUDIO_SMOKE_PORT:-43173}"
mkdir -p "$ROOT/../.workcell-host-tmp"
DATA_ROOT="$(mktemp -d "$ROOT/../.workcell-host-tmp/studio-smoke.XXXXXX")"
COOKIE_FILE="$DATA_ROOT/cookies"
cleanup() {
  status=$?
  if [ -n "${SERVER_PID:-}" ]; then kill "$SERVER_PID" 2>/dev/null || true; wait "$SERVER_PID" 2>/dev/null || true; fi
  if [ "$status" -ne 0 ]; then
    echo "Smoke diagnostics:" >&2
    sed -n '1,200p' "$DATA_ROOT/server.log" >&2 || true
    for artifact in status.json eval.json status2.json eval2.json; do
      if [ -f "$DATA_ROOT/$artifact" ]; then echo "$artifact" >&2; sed -n '1,160p' "$DATA_ROOT/$artifact" >&2; fi
    done
  fi
  rm -rf "$DATA_ROOT"
  return "$status"
}
trap cleanup EXIT
STUDIO_DATA_ROOT="$DATA_ROOT/data" PORT="$PORT" node "$ROOT/src/server/main.js" >"$DATA_ROOT/server.log" 2>&1 &
SERVER_PID=$!
for _ in $(seq 1 30); do curl -fsS "http://127.0.0.1:$PORT/api/ready" >/dev/null && break; sleep 0.2; done
curl -fsS -c "$COOKIE_FILE" -b "$COOKIE_FILE" -H 'Content-Type: application/json' -d '{"name":"Smoke","objective":"Verify the real Workcell loop","template":"invoice-scanner"}' "http://127.0.0.1:$PORT/api/projects" >"$DATA_ROOT/project.json"
PROJECT_ID="$(jq -r '.project.id' "$DATA_ROOT/project.json")"
curl -fsS -c "$COOKIE_FILE" -b "$COOKIE_FILE" "http://127.0.0.1:$PORT/api/projects/$PROJECT_ID/policy" | jq -e '.ok == true' >/dev/null
curl -fsS -c "$COOKIE_FILE" -b "$COOKIE_FILE" -H 'Content-Type: application/json' -d '{}' "http://127.0.0.1:$PORT/api/projects/$PROJECT_ID/runs" >"$DATA_ROOT/run.json"
RUN_ID="$(jq -r '.run_id' "$DATA_ROOT/run.json")"
for _ in $(seq 1 120); do
  curl -fsS -c "$COOKIE_FILE" -b "$COOKIE_FILE" "http://127.0.0.1:$PORT/api/projects/$PROJECT_ID/runs/$RUN_ID" >"$DATA_ROOT/status.json"
  jq -e '.exit_category != null' "$DATA_ROOT/status.json" >/dev/null && break
  sleep 0.25
done
jq -e '.exit_category == "completed"' "$DATA_ROOT/status.json" >/dev/null
curl -fsS -c "$COOKIE_FILE" -b "$COOKIE_FILE" -H 'Content-Type: application/json' -d '{}' "http://127.0.0.1:$PORT/api/projects/$PROJECT_ID/runs/$RUN_ID/evals" >"$DATA_ROOT/eval.json"
jq -e '.status == "failed"' "$DATA_ROOT/eval.json" >/dev/null
curl -fsS -c "$COOKIE_FILE" -b "$COOKIE_FILE" -H 'Content-Type: application/json' -d "{\"patch\":\"diff --git a/main.kujo b/main.kujo\\n--- a/main.kujo\\n+++ b/main.kujo\\n@@ -39,7 +39,7 @@ for csv_row in csv_rows {\\n mut duplicates := []\\n for invoice in invoices {\\n     # Demo bug: blank invoice IDs should be ignored.\\n-    if counts[invoice[\\\"invoice_id\\\"]] > 1 {\\n+    if invoice[\\\"invoice_id\\\"] != \\\"\\\" && counts[invoice[\\\"invoice_id\\\"]] > 1 {\\n         duplicates = push(duplicates, invoice)\\n     }\\n }\\n\"}" "http://127.0.0.1:$PORT/api/projects/$PROJECT_ID/patch" >/dev/null
curl -fsS -c "$COOKIE_FILE" -b "$COOKIE_FILE" -H 'Content-Type: application/json' -d '{}' "http://127.0.0.1:$PORT/api/projects/$PROJECT_ID/runs" >"$DATA_ROOT/run2.json"
RUN_ID="$(jq -r '.run_id' "$DATA_ROOT/run2.json")"
for _ in $(seq 1 120); do
  curl -fsS -c "$COOKIE_FILE" -b "$COOKIE_FILE" "http://127.0.0.1:$PORT/api/projects/$PROJECT_ID/runs/$RUN_ID" >"$DATA_ROOT/status2.json"
  jq -e '.exit_category != null' "$DATA_ROOT/status2.json" >/dev/null && break
  sleep 0.25
done
jq -e '.exit_category == "completed"' "$DATA_ROOT/status2.json" >/dev/null
curl -fsS -c "$COOKIE_FILE" -b "$COOKIE_FILE" -H 'Content-Type: application/json' -d '{}' "http://127.0.0.1:$PORT/api/projects/$PROJECT_ID/runs/$RUN_ID/evals" >"$DATA_ROOT/eval2.json"
jq -e '.status == "passed"' "$DATA_ROOT/eval2.json" >/dev/null
EVAL_ID="$(jq -r '.eval_id' "$DATA_ROOT/eval2.json")"
curl -fsS -c "$COOKIE_FILE" -b "$COOKIE_FILE" -H 'Content-Type: application/json' -d "{\"eval_id\":\"$EVAL_ID\"}" "http://127.0.0.1:$PORT/api/projects/$PROJECT_ID/runs/$RUN_ID/verify" | jq -e '.ok == true and .evidence_verified == true and .eval_manifest_verified == true' >/dev/null
echo "Workcell Studio smoke passed: failure → repair → Eval pass → manifest verification"
