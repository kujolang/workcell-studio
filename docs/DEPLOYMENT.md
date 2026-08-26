# Deployment

Use a dedicated Linux VM. A serverless function is not an honest deployment for
Workcell because it requires a persistent Docker/Podman engine, Git workspaces,
bounded child processes, evidence storage, cancellation, and cleanup.

## Recommended public-demo host

- Current LTS Linux VM with a private, preferably rootless Docker daemon.
- Dedicated unprivileged service account; no cloud credentials in its
  environment; no public daemon socket.
- Reverse proxy with HTTPS, request/body limits, rate limits, and connection
  timeouts. Preserve `Origin-Agent-Cluster: ?1` and `Permissions-Policy:
  tools=(self)`.
- Prebuild `kujolang/workcell-kujo:local`; do not build or pull during judging.
- Pin Workcell 1.0.0 and its required Kujo 1.0.0 commit. Run `workcell doctor`
  on the target host and retain the receipt.
- Persistent evidence volume with filesystem quota; periodic session expiry and
  `workcell clean` inventory; alerts for cleanup failures and disk pressure.
- Process supervisor with health (`/api/health`) and readiness (`/api/ready`)
  checks. Graceful shutdown must deliver SIGTERM to active Workcell runs.

## Startup gate

```bash
./scripts/prebuild-runtime.sh
npm test
npm run smoke
KUJO_BIN=/path/to/kujo ../workcell/bin/workcell doctor --backend docker --json
npm start
curl -fsS http://127.0.0.1:4173/api/ready
```

The local implementation is deployment-ready, but this repository does not
claim a live URL until a target VM, DNS/TLS, origin-trial token if needed, and
target-host Workcell evidence have been provisioned and verified.
