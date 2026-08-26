# Research record

Research date: 2026-08-25. Local repository heads were compared with their
GitHub `main` branch heads and matched at research time.

## WebMCP and challenge

The official challenge requires a working live WebMCP app, public source with
an open-source license and functional instructions, a public audio demo video
under three minutes, and a description of WebMCP leverage and human/agent
collaboration. The deadline shown on the official pages is September 3, 2026 at
1:00 PM PDT. Judging covers WebMCP leverage, execution, potential impact, and
creativity/ambition.

Chrome documentation updated August 20, 2026 uses
`document.modelContext.registerTool`. The `execute` callback receives
`AbortSignal` as its second argument. Current guidance recommends focused,
non-overlapping tools, strict runtime validation, visible UI updates, explicit
`readOnlyHint` and `untrustedContentHint`, tool names under 30 characters,
descriptions under 500, parameter descriptions under 150, and individual tool
results around 1.5K characters. WebMCP requires origin isolation and the
`tools` Permissions Policy, defaulting to `self`.

Primary sources:

- https://openai.com/webmcp-challenge/
- https://webmcp.devpost.com/
- https://developer.chrome.com/docs/ai/webmcp
- https://developer.chrome.com/docs/ai/webmcp/imperative-api
- https://developer.chrome.com/docs/ai/webmcp/best-practices
- https://developer.chrome.com/docs/ai/webmcp/secure-tools
- https://github.com/webmachinelearning/webmcp

## Kujo repository findings

| Repository | Current release/head researched | Actual role and commands | Decision |
| --- | --- | --- | --- |
| `kujo` | 1.0.1 docs; local runtime 1.0.0; `fc0f8bb` | Language runtime with filesystem, process, HTTP, SQLite, capability flags. `kujo run`, `kujo test`, `kujo check`. | Required. Runs Studio policy guard, templates, Eval, and Workcell. |
| `workcell` | 1.0.0; `7bcdb7f` | Docker/Podman harness. `validate`, `inspect`, `run`, `verify`, `clean`, `doctor`. Disposable clean Git workspace, resources, network policy, declared exports, receipts/manifests. | Required execution engine. No replacement sandbox. |
| `eval` | product docs 1.0.0, CLI contract 2.0.0; `955713f` | Deterministic JSON suites: `run`, `report`, `compare`, `lint`, `verify-manifest`. It is not a sandbox. | Required. Run only against Workcell-exported artifacts. |
| `spec` | 1.0.0; `d510334` | Reviewable task contracts and exports; does not execute. `validate`, `render`, `export-eval`, `ci`. | Useful for repository acceptance contract, not needed in the live loop. |
| `runledger` | 1.0.0; `12bbf2b` | Local receipts for whole agent attempts. Manual usage/cost/verdict; not evaluation. | Deferred. Workcell receipts already cover execution; add mission-level ledger only after MVP. |
| `shipcheck` | 1.0.0; `4c958ab` | 16 repository readiness checks. `scan` is advisory; `gate` blocks only error findings. Does not run tests. | Used as final release-readiness gate. |
| `watchdog` | 1.0.1; `bd66ab4` | Model API proxy/telemetry and cost estimation. | Not integrated: browser-agent WebMCP calls do not traverse a Studio model proxy. |
| `mcp` | 1.0.0; `6fa7b66` | Local MCP server framework and guarded repo-specific scaffold generator. | Not integrated: WebMCP is the challenge surface. Studio capability services remain adapter-friendly. |
| `agents-sdk` | 1.0.0; `d3904d3` | Kujo agent runner, tools, approvals, stores, budgets, deterministic offline fixtures, limited MCP 2026 helpers. | Not integrated: Studio does not run its own model agent. |
| `ai-sdk` | 1.0.0; `849dbbb` | Provider-normalized model/embedding calls, fixture mode, retries, redaction, policy. | Not integrated: Studio makes no model API calls. |

## Workcell constraints that shaped the product

Workcell 1.x requires a clean source Git repository, so Studio records each
accepted human or agent mutation as an internal commit before running. Workcell
creates a detached disposable workspace and does not merge its changes back.
The public profile uses only documented definition v1 fields. Workcell is a
bounded container workflow, not protection from a compromised host kernel or
daemon and not a hosted multi-tenant scheduler.

The selected deployment is a dedicated Linux VM with a private, preferably
rootless Docker daemon. Serverless platforms cannot honestly host this runtime.
