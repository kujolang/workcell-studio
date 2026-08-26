# Submission draft

## Description

Kujo Workcell Studio is a collaborative software workbench where a person and
their browser agent inspect, change, execute, repair, and verify the same live
project. WebMCP exposes focused project capabilities directly to the agent;
Kujo Workcell runs generated code in a disposable, resource-bounded,
network-disabled environment and records evidence; Kujo Eval independently
checks the exported outcome.

## Why WebMCP

Software work is a multi-step, stateful workflow. DOM actuation makes the agent
infer filenames, editor state, policies, run IDs, and evidence from visual
controls. Sixteen concise WebMCP tools give it the exact application semantics
while keeping each action visible to the person in Studio. Human edits and
agent edits converge on the same capability services and state.

## What is newly possible

A person can change an objective or inspect a boundary while their browser
agent reads and patches the same workspace, launches a bounded execution,
learns from deterministic failure, repairs the code, reruns it, and verifies
the evidence. Success is not accepted because an agent says so; the system
shows where execution happened, whether acceptance checks passed, and whether
the recorded evidence remains intact.

## WebMCP implementation

The browser uses the current Imperative API,
`document.modelContext.registerTool`, with strict JSON Schemas, explicit
read-only and untrusted-content annotations, compact outputs, shared UI/API
services, and AbortSignal propagation. Long Workcell operations return a run
ID and are polled; cancellation reaches the scoped Workcell and Eval processes.

## Submission checklist

- [ ] Replace pending live URL in README.
- [ ] Verify deployed URL in ChatGPT in-app browser and Chrome WebMCP.
- [ ] Run canonical scenario with a real WebMCP-capable agent.
- [ ] Record and publish public audio video under three minutes.
- [ ] Add video URL to README and Devpost.
- [ ] Confirm repository is public and GitHub detects MIT license.
- [ ] Re-check official rules immediately before submission.

These unchecked items require the submitter's deployment, browser/account, or
recording access. `./scripts/release-gate.sh` covers the repository-owned gates.
