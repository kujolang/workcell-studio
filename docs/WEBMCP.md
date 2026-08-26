# WebMCP implementation

The Studio registers 16 Imperative tools with the current
`document.modelContext.registerTool` API. Registration is progressive: normal
human UI remains functional in browsers without WebMCP.

Tools are domain capabilities, not a generic executor. Names are under 30
characters; schemas reject unknown fields and use opaque IDs and bounded input.
Descriptions and outputs stay within current Chrome guidance. Runtime checks
remain authoritative because schema constraints are advisory at the agent
boundary.

Read-only tools: `get_studio_state`, `list_files`, `read_file`,
`inspect_policy`, `get_run_status`, `inspect_run`, `get_eval_report`,
`get_diff`, `verify_run`.

Untrusted-content reads: `read_file`, `inspect_run`, `get_eval_report`,
`get_diff`.

State-changing tools: `create_project`, `write_file`, `apply_patch`,
`run_workcell`, `run_eval`, `reset_project`, `export_project`.

Each execute callback passes its `AbortSignal` to fetch. `run_workcell` also
registers an abort handler that calls the scoped cancellation endpoint after a
run ID exists. Server-sent events make successful tool effects visible in the
human UI.

## Repeatable discovery prompts

| Prompt | Expected tool choice |
| --- | --- |
| “Show me what files are in this project.” | `list_files` |
| “What boundary will run this code?” | `inspect_policy` |
| “Run it and tell me whether it passes.” | `run_workcell`, poll, `run_eval` |
| “Why did the last verification fail?” | `inspect_run`, `get_eval_report` |
| “Fix the blank-ID bug and verify it.” | read, patch, run, Eval, verify |

Use Chrome's Model Context Tool Inspector and a WebMCP-capable ChatGPT browser
to test selection, schema construction, error recovery, and the multi-tool
repair loop. Deterministic registration/annotation tests run in `npm test`.
