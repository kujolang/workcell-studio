# Kujo Workcell Studio

A WebMCP-native workspace where humans and browser agents build and verify
software together inside bounded Kujo Workcells.

```text
Human + browser agent
        │
      WebMCP
        │
  Studio capabilities
        │
  Kujo policy guard
        │
  Kujo Workcell ── receipt / patch / manifest
        │
     Kujo Eval ─── deterministic report
```

WebMCP gives the browser agent structured access to the application. Kujo gives
those actions a controlled execution boundary, verification loop, and evidence
trail the human can inspect.

## What works

- Create one of three small, session-isolated Kujo projects.
- Inspect and edit the same live workspace through the UI or 16 focused WebMCP
  tools.
- Execute the project in the real Workcell 1.0 Docker harness with network
  disabled, bounded resources, a disposable Git worktree, declared artifacts,
  automatic cleanup, structured receipt, patch, and integrity manifest.
- Run real Kujo Eval checks against exported artifacts.
- Distinguish execution success, Eval success, and evidence integrity.
- Follow the canonical invoice demo from intentional failure to repair and
  verified result.

## Quick start

Requirements: Node 20+, Kujo 1.0.0, Git, `jq`, Docker, the sibling
`kujolang/workcell` and `kujolang/eval` checkouts.

```bash
./scripts/prebuild-runtime.sh
npm test
npm start
```

Open `http://127.0.0.1:4173`. For local Chrome testing, enable
`chrome://flags/#enable-webmcp-testing`; production uses the Chrome 149+ origin
trial or ChatGPT's WebMCP-capable in-app browser.

Environment overrides:

```bash
PORT=4173 \
KUJO_BIN=/path/to/kujo \
WORKCELL_BIN=/path/to/workcell/bin/workcell \
EVAL_MAIN=/path/to/eval/main.kujo \
npm start
```

## WebMCP tools

`get_studio_state`, `create_project`, `list_files`, `read_file`, `write_file`,
`apply_patch`, `inspect_policy`, `run_workcell`, `get_run_status`, `inspect_run`,
`run_eval`, `get_eval_report`, `get_diff`, `verify_run`, `reset_project`, and
`export_project`.

The adapter uses the current `document.modelContext.registerTool` Imperative
API, strict JSON Schemas, explicit `readOnlyHint` and `untrustedContentHint`
annotations, bounded results, and `AbortSignal` propagation. The UI and tools
call the same Studio services.

## Verification

```bash
npm test             # schemas, annotations, isolation, paths, patches, Kujo fixture
npm run smoke        # real Workcell failure → repair → Eval → manifest loop
npm run eval         # Kujo Eval dogfood gate for this repository
npm run shipcheck    # Kujo ShipCheck release-readiness gate
```

See [architecture](docs/ARCHITECTURE.md), [security](docs/SECURITY.md),
[WebMCP implementation](docs/WEBMCP.md), [deployment](docs/DEPLOYMENT.md), and
[hackathon disclosure](docs/HACKATHON.md).

## Challenge links

- Live demo: pending deployment
- Demo video: pending recording
- Submission: see [submission draft](docs/SUBMISSION.md)

MIT licensed. Kujo and Workcell existed before the challenge; the precise
challenge-era contribution is documented in [docs/HACKATHON.md](docs/HACKATHON.md).
