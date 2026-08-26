#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/../shipcheck"
kujo run shipcheck.kujo scan --dir "$ROOT" --format json
kujo run shipcheck.kujo gate --dir "$ROOT" --format json
