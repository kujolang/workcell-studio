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
  bounded.
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
- Cancellation sends SIGTERM to the Workcell coordinator, whose documented
  lifecycle performs label-scoped container termination and cleanup.
- Session data expires automatically after two hours and is swept every 15
  minutes. Production should also run Workcell ownership-scoped clean.

## Prompt-injection boundary

Kujo does not make prompt injection impossible. It reduces the authority a
successfully manipulated agent can reach: demo workspaces have no secrets, no
host filesystem, no daemon socket, and no network. Untrusted output remains
explicitly labeled for the consuming agent.

## Residual risks

- A container or kernel/daemon vulnerability can escape the documented
  Workcell boundary. Public deployment should use a dedicated VM and rootless
  engine; higher-risk tenancy needs a stronger gVisor/Kata/microVM boundary.
- Exact-value redaction cannot detect transformed secrets, so the public profile
  mounts none.
- `git apply` and Git metadata operate on server-owned project repositories;
  keep Git patched and retain the strict size/path checks.
- Node's synchronous Eval invocation is short and bounded by 30 seconds, but an
  aborted HTTP request cannot interrupt `spawnSync`. Workcell cancellation is
  fully propagated; Eval/export cancellation should move to managed child
  processes before broad public scale.
- Cleanup at startup is not a distributed retention service. A production VM
  needs a supervised periodic job and disk quota.

Report security issues privately to the repository maintainers. Do not include
secrets or live multi-tenant data in reports.
