# Architecture

```text
Human UI ─────────────┐
                     ├─ Studio capability API ─ Kujo policy guard
Browser agent/WebMCP ┘             │
                                   ├─ session/project boundary
                                   ├─ bounded file + patch capabilities
                                   └─ async run controller
                                            │
                                      Kujo Workcell
                                            │
                     disposable Git worktree / Docker / network none
                                            │
                          receipt / logs / changes / manifest / artifacts
                                            │
                                         Kujo Eval
                                            │
                                    report + Eval manifest
```

The browser adapter is deliberately thin. Both the visible controls and the
WebMCP tools call identical HTTP services, so an agent action visibly updates
the same project the human is reviewing. Server-sent events refresh project,
workspace, run, and Eval state.

Project metadata and activity use small structured JSON files. Each browser
session has a random HttpOnly cookie and a private data root. Project, run, and
Eval IDs are opaque. Workspaces are Git repositories because Workcell requires
a clean source and uses Git to produce change evidence.

Workcell runs and Eval jobs start asynchronously and return IDs. The Node
boundary owns HTTP, streaming, process lifetime, timeout, and cancellation.
Kujo owns the public-profile
policy guard and project workloads. Workcell owns definition validation,
disposable workspace creation, container policy, execution, collection,
verification, export, receipts, manifests, and cleanup. Eval owns deterministic
artifact assertions. This separation avoids claiming that one green state
proves all three properties.

## Evidence mapping

| Product claim | Source of truth |
| --- | --- |
| Execution succeeded | Workcell CLI category and `receipt.json` |
| Expected behavior passed | Kujo Eval `summary.json` |
| Workcell evidence intact | `workcell verify` over `manifest.json` |
| Eval evidence intact | Eval `verify-manifest` |
| Source changed | Git diff from template commit to current commit |

The capability layer is transport-neutral enough for a future MCP adapter, but
no MCP routing is included in challenge scope.
