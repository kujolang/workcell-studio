# Deployment

For the complete operator and browser-agent procedure, follow
[`DEPLOYMENT_RUNBOOK.md`](DEPLOYMENT_RUNBOOK.md). It pins the verified source
revisions, identifies human approval checkpoints, and covers provisioning,
DNS, TLS, origin-trial configuration, acceptance testing, rollback, and final
submission handoff.

Use a dedicated x86-64 Linux VM. A serverless function is not an honest deployment for
Workcell because it requires a persistent Docker/Podman engine, Git workspaces,
bounded child processes, evidence storage, cancellation, and cleanup.

## Recommended public-demo host

- Current LTS Linux VM dedicated to this disposable demo, with a private
  rootful Docker daemon. The sealed definitions use `workspace.run_as: host`;
  Workcell rejects a rootless daemon instead of silently changing identity.
- Dedicated unprivileged service account; no cloud credentials in its
  environment; no public daemon socket.
- Reverse proxy with HTTPS, request/body limits, rate limits, and connection
  timeouts. Preserve `Origin-Agent-Cluster: ?1` and `Permissions-Policy:
  tools=(self)`. The service unit trusts forwarded client IPs only from its
  loopback proxy so application quotas do not collapse all users into one key.
- Prebuild `kujolang/workcell-kujo:local`; do not build or pull during judging.
- Pin Workcell 1.0.0 and its required Kujo 1.0.0 commit. Run `workcell doctor`
  on the target host and retain the receipt.
- Persistent evidence volume with filesystem quota; periodic session expiry and
  `workcell clean` inventory; alerts for cleanup failures and disk pressure.
- Process supervisor with health (`/api/health`) and readiness (`/api/ready`)
  checks. Graceful shutdown must deliver SIGTERM to active Workcell runs.
- No cloud credentials, unrelated workloads, or other tenant data on the VM.
  Rootful daemon compromise remains inside the dedicated VM trust boundary.

## Startup gate

```bash
./scripts/prebuild-runtime.sh
./scripts/release-gate.sh
KUJO_BIN=/path/to/kujo ../workcell/bin/workcell doctor --backend docker --json
npm start
curl -fsS http://127.0.0.1:4173/api/ready
```

Install the reviewed service, cleanup service/timer, and Caddy template from
`deploy/`; replace `studio.example.com`, then enable both
`workcell-studio.service` and `workcell-studio-clean.timer`. The service user
needs Docker-group access on this dedicated VM. Confirm the socket is not
reachable over TCP and retain the target-host `doctor`, release-gate, health,
and readiness outputs as deployment evidence.

The local implementation is deployment-ready, but this repository does not
claim a live URL until a target VM, DNS/TLS, origin-trial token if needed, and
target-host Workcell evidence have been provisioned and verified. A rootless
deployment is a separate profile change: set every sealed definition and the
policy guard to `workspace.run_as: rootless`, then rerun the full gate on that
exact host.
