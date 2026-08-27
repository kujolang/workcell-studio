#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

required_runtime="$(tr -d '[:space:]' < "$ROOT/../workcell/RUNTIME_VERSION")"
if ! rg -q "ARG KUJO_COMMIT=$required_runtime" docker/kujo-runtime/Dockerfile; then
  echo "Pinned container runtime does not match Workcell RUNTIME_VERSION" >&2
  exit 1
fi

docker image inspect kujolang/workcell-kujo:local >/dev/null
test "$(docker image inspect kujolang/workcell-kujo:local --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')" = "$required_runtime"
test "$(docker run --rm --network none --read-only kujolang/workcell-kujo:local kujo --version)" = "kujo 1.0.0"
npm test
npm run lint
npm run format
npm run smoke
npm run eval
npm run shipcheck

git diff --check
test -f LICENSE
test -f docs/HACKATHON.md
test -f docs/SUBMISSION.md
test -f frontend/access.html
rg -q '^EnvironmentFile=/etc/workcell-studio/access\.env$' deploy/workcell-studio.service
rg -q 'timingSafeEqual' src/server/access.js
echo "Workcell Studio repository release gate passed"
