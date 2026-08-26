# Security model and threat review

## Trust path

```text
untrusted browser agent → WebMCP input → Studio API → session project
→ fixed Kujo policy guard → Workcell definition v1 → Docker daemon → host
```

The browser, generated code, repository text, logs, compiler output, patches,
and Eval reports are untrusted. The Docker daemon and host kernel are trusted
operator infrastructure; Workcell does not claim to contain their compromise.

## Mitigations

- No arbitrary shell/host command capability exists in WebMCP or the API.
- Opaque IDs are resolved under the current HttpOnly session only.
- Paths reject absolutes, traversal, backslashes, NULs, oversized values, and
  symlinks at every existing component. Targets are canonicalized beneath the
  server-owned repository.
- Project files, total bytes, patch bytes, body bytes, logs, tool output,
  concurrent runs, process time, CPU, memory, PIDs, and artifact exports are
  bounded. Rate-limit state is capped, and HTTP header/body receive deadlines
  limit slow clients.
- Cross-site state-changing requests are rejected using Fetch Metadata in
  addition to strict same-site session cookies.
- Per-session creation locks, per-project mutation locks, and atomic job
  reservations prevent quota races and overlapping edits, resets, exports,
  executions, or Eval starts from racing the sealed revision.
- The browser cannot select images, runtime arguments, mounts, networks,
  devices, host directories, secrets, resource limits, or cleanup behavior.
- A Kujo policy guard rejects definitions broader than the fixed public profile;
  Workcell independently validates the complete definition and unknown fields.
- Public execution uses network `none`, no secrets, read-only root filesystem,
  dropped capabilities/no-new-privileges through Workcell, one disposable
  workspace mount, and declared artifact export.
- WebMCP read tools that return project/log/diff/report content carry
  `untrustedContentHint`; state-changing tools are not read-only.
- Security headers enforce origin isolation, deny framing, constrain content,
  and advertise `tools=(self)`.
- Cancellation sends SIGTERM to the scoped Workcell or Eval coordinator and
  escalates to SIGKILL after two seconds. Workcell's documented lifecycle
  performs label-scoped container termination and cleanup.
- Session data expires automatically after two hours and is swept every 15
  minutes. Production should also run Workcell ownership-scoped clean.

## Prompt-injection boundary

Kujo does not make prompt injection impossible. It reduces the authority a
successfully manipulated agent can reach: demo workspaces have no secrets, no
host filesystem, no daemon socket, and no network. Untrusted output remains
explicitly labeled for the consuming agent.

## Residual risks

- A container or kernel/daemon vulnerability can escape the documented
  Workcell boundary. The submission uses a dedicated disposable VM matching the
  rootful `workspace.run_as: host` definitions. Higher-risk tenancy needs a
  separately tested rootless profile or a stronger gVisor/Kata/microVM boundary.
- Exact-value redaction cannot detect transformed secrets, so the public profile
  mounts none.
- `git apply` and Git metadata operate on server-owned project repositories;
  keep Git patched and retain the strict size/path checks. Studio validates the
  complete changed-path set after apply, including quoted rename forms, before
  committing.
- Eval is an asynchronous managed child with a 30-second timeout, bounded logs,
  scoped cancellation, and forced termination fallback. Export is a bounded
  synchronous `git archive` over the 512 KiB/64-file sealed project revision;
  broad-scale deployments may move archive creation to a worker queue.
- Cleanup at startup is not a distributed retention service. A production VM
  needs a supervised periodic job and disk quota.

Report security issues privately to the repository maintainers. Do not include
secrets or live multi-tenant data in reports.
