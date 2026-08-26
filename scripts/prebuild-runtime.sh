#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
docker build --tag kujolang/workcell-kujo:local "$ROOT/docker/kujo-runtime"
docker run --rm --network none kujolang/workcell-kujo:local kujo --version
