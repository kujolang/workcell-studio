# Agent guide

Kujo Workcell Studio is a WebMCP-native human/agent workbench. Keep one shared
capability path: UI and WebMCP call the same `/api` services; the Studio server
never exposes arbitrary host command execution.

## Architecture

- `frontend/`: human interface and live state only.
- `webmcp/`: thin Imperative WebMCP adapter using
  `document.modelContext.registerTool`.
- `src/server/`: session-scoped controller, bounded file capabilities, async
  lifecycle, Workcell and Eval adapters.
- `src/domain/`: Kujo-owned policy logic. Do not duplicate it in browser code.
- `templates/`: small Git repositories copied into opaque session workspaces.
- Workcell is the execution boundary. Eval is the deterministic outcome check.
  Receipts and manifests are evidence; they are not interchangeable claims.

## Security invariants

- All client paths are project-relative, canonicalized, and symlink-free.
- Opaque project/run/eval IDs are always resolved beneath the current session.
- Public definitions use network `none`, fixed resource/output limits, no
  secrets, read-only root, declared artifacts, and automatic cleanup.
- Never add `shell`, `exec`, `command`, host mount, Docker flag, image selector,
  network selector, or secret input to a WebMCP or public API schema.
- Repository files, logs, diffs, and Eval output are untrusted content.
- Do not show execution, Eval, or evidence success unless the corresponding
  real subsystem produced it.

## Development

```bash
npm test
npm run lint
npm run format
npm run smoke
npm run eval
npm run shipcheck
```

Build the pinned runtime image before integration testing with
`scripts/prebuild-runtime.sh`. Workcell requires a clean source repository, so
Studio seals each accepted mutation as an internal Git commit before execution.

## Release and demo gates

The canonical demo must show a real failure, a targeted repair, a second real
Workcell run, a passing Kujo Eval, and manifest verification. Re-check current
Chrome WebMCP docs and official challenge rules before submission. Never use
fixture UI state or prerecorded API responses as execution evidence.
