# Production deployment and submission runbook

This is the handoff for a browser-capable deployment agent. It takes Kujo
Workcell Studio from the public release candidate to a judge-accessible,
verified deployment. Follow the gates in order. Do not substitute simulated
execution, a serverless backend, or a different dependency revision.

## Outcome

Deploy this architecture:

```text
judge browser
    |
https://studio.<domain>
    |
Cloudflare DNS/proxy (DNS-only during initial validation)
    |
Caddy :443
    |
Studio :4173 on 127.0.0.1
    |
Kujo Workcell + Kujo Eval
    |
private rootful Docker daemon on a dedicated x86-64 VM
```

The recommended target is a dedicated DigitalOcean Droplet. Cloudflare is DNS
and an optional reverse proxy; it is not the Workcell execution host. Do not
deploy the backend to Netlify Functions, Cloudflare Workers/Pages/Containers,
Vercel functions, or an ordinary managed application container. The verified
profile needs a persistent private rootful Docker daemon and rejects a rootless
engine rather than silently weakening its identity contract.

## Authority and fixed inputs

Use these exact public sources and revisions:

| Component | Source | Revision |
| --- | --- | --- |
| Studio | `https://github.com/kujolang/workcell-studio.git` | `30e6db3966f60a8cea1d54ce7d78a052bc6c4152` / `v0.1.0-rc.1` |
| Workcell | `https://github.com/kujolang/workcell.git` | `7bcdb7f29ddf74843aec6b70eafbf33cc7944c6f` |
| Eval | `https://github.com/kujolang/eval.git` | `955713f487c094b20b7b8c44414ae17395194cc9` |
| Kujo host runtime | GitHub release `v1.0.0`, Linux x64 | SHA-256 below |
| Kujo Workcell image runtime | Built by `scripts/prebuild-runtime.sh` | commit `2b3e07d398016e92008d8399e79c441e012dce38` |

The Kujo v1.0.0 Linux x64 archive checksum is:

```text
77398f60d0f9d29b7ae1351ea234ba7a56ccc1ce6802e2891d7ff0572ac2e52f
```

Do not upgrade any component during deployment. A dependency upgrade requires
the complete release gate and a new release commit.

## Human approval checkpoints

The agent performs all work except the following actions, which require the
owner to authenticate, accept terms, spend money, or make a legal attestation:

1. Sign in to DigitalOcean and complete MFA.
2. Approve the selected paid Droplet before creation.
3. Sign in to the DNS provider and confirm the final hostname.
4. Accept Chrome origin-trial terms and register the final origin if used.
5. Review and publish the demo video.
6. Review the final Devpost entry and press Submit.

Never ask the owner to paste a password, MFA code, private SSH key, payment
details, unrestricted cloud token, or session cookie into chat. Use a connected
signed-in browser for account actions and an SSH public key for server access.
Pause immediately if the requested action would create an unexpected charge,
replace an existing DNS record, broaden a firewall, or destroy a resource.

## Phase 1: collect non-secret deployment inputs

Record these values in the deployment session without committing secrets:

```text
DO_REGION=<near the owner/judges; a US region is appropriate>
HOSTNAME=studio.<owned-domain>
OWNER_SSH_PUBLIC_KEY_PATH=<local .pub file>
OWNER_CURRENT_IP=<used to restrict SSH>
```

Confirm that the hostname is unused. Do not overwrite an existing record.
Confirm the local public key fingerprint with the owner before uploading it.

## Phase 2: provision the DigitalOcean Droplet

In the signed-in DigitalOcean control panel:

1. Open **Create → Droplets**.
2. Select a current Ubuntu LTS x86-64 image.
3. Select at least 2 vCPUs, 4 GiB RAM, and 60 GiB SSD. A 4-vCPU/8-GiB plan is
   optional for additional demo headroom.
4. Choose the recorded region.
5. Enable monitoring. Enable backups if the owner approves the additional
   charge; otherwise create a snapshot after verification.
6. Use SSH-key authentication only and select the verified owner public key.
7. Name the Droplet `kujo-workcell-studio`.
8. Show the final recurring price to the owner and wait for approval.
9. Create the Droplet and record its ID and public IPv4 address.
10. If available, assign a reserved/static IP so DNS will survive replacement.

Create a DigitalOcean Cloud Firewall attached only to this Droplet:

| Direction | Protocol/port | Source/destination |
| --- | --- | --- |
| Inbound | TCP 22 | owner current IP only |
| Inbound | TCP 80 | all IPv4/IPv6 |
| Inbound | TCP 443 | all IPv4/IPv6 |
| Outbound | TCP/UDP | all, for installation and image retrieval |
| Outbound | ICMP | all |

Do not expose port 4173, Docker ports 2375/2376, or any other inbound port.
Workcell workload containers still use the sealed Docker network policy
`none`; host outbound access is only for deployment and maintenance.

## Phase 3: establish and harden SSH access

Connect using the owner key and the recorded IP. Verify the host key before
continuing:

```bash
ssh root@<DROPLET_IP>
```

On the VM:

```bash
apt-get update
apt-get -y upgrade
apt-get install -y ca-certificates curl git jq ripgrep tar gzip docker.io caddy
systemctl enable --now docker
systemctl enable --now caddy
docker version
```

Install a maintained Node.js LTS release that provides `/usr/bin/node` and is
version 20 or newer. Use the current official Node.js or distribution
installation instructions; do not pipe an uninspected remote script directly
into a privileged shell. Verify:

```bash
node --version
npm --version
test "$(node -p 'Number(process.versions.node.split(`.`)[0]) >= 20')" = true
```

Create the service identity and storage:

```bash
getent group workcell-studio >/dev/null || groupadd --system workcell-studio
id workcell-studio >/dev/null 2>&1 || useradd \
  --system \
  --gid workcell-studio \
  --home-dir /var/lib/workcell-studio \
  --create-home \
  --shell /usr/sbin/nologin \
  workcell-studio
usermod -aG docker workcell-studio
install -d -o workcell-studio -g workcell-studio -m 0700 \
  /var/lib/workcell-studio \
  /var/lib/workcell-studio/data
```

Confirm the daemon is rootful and is not reachable over TCP:

```bash
docker info --format '{{json .SecurityOptions}}'
ss -lntp | grep -E ':(2375|2376)\b' && exit 1 || true
sudo -u workcell-studio -g workcell-studio docker version
```

If the service user cannot access Docker, start a new login/session after the
group change and diagnose group membership. Never work around this by making
the Docker socket world-writable.

## Phase 4: install the pinned Kujo runtime

Download to a temporary file, verify the checksum, and install only after the
checksum passes:

```bash
curl -fL \
  https://github.com/kujolang/kujo/releases/download/v1.0.0/kujo-v1.0.0-linux-x64.tar.gz \
  -o /tmp/kujo-v1.0.0-linux-x64.tar.gz
printf '%s  %s\n' \
  '77398f60d0f9d29b7ae1351ea234ba7a56ccc1ce6802e2891d7ff0572ac2e52f' \
  '/tmp/kujo-v1.0.0-linux-x64.tar.gz' | sha256sum -c -
tar -xzf /tmp/kujo-v1.0.0-linux-x64.tar.gz -C /usr/local/bin kujo
chmod 0755 /usr/local/bin/kujo
/usr/local/bin/kujo --version
```

The final command must print `kujo 1.0.0`.

## Phase 5: clone and pin the application

Clone over public HTTPS and detach each checkout at the verified commit:

```bash
git clone https://github.com/kujolang/workcell-studio.git /opt/workcell-studio
git clone https://github.com/kujolang/workcell.git /opt/workcell
git clone https://github.com/kujolang/eval.git /opt/eval

git -C /opt/workcell-studio checkout --detach 30e6db3966f60a8cea1d54ce7d78a052bc6c4152
git -C /opt/workcell checkout --detach 7bcdb7f29ddf74843aec6b70eafbf33cc7944c6f
git -C /opt/eval checkout --detach 955713f487c094b20b7b8c44414ae17395194cc9

test "$(git -C /opt/workcell-studio rev-parse HEAD)" = \
  30e6db3966f60a8cea1d54ce7d78a052bc6c4152
test "$(git -C /opt/workcell rev-parse HEAD)" = \
  7bcdb7f29ddf74843aec6b70eafbf33cc7944c6f
test "$(git -C /opt/eval rev-parse HEAD)" = \
  955713f487c094b20b7b8c44414ae17395194cc9

cd /opt/workcell-studio
npm ci
```

Keep `/opt/workcell-studio`, `/opt/workcell`, and `/opt/eval` root-owned. The
systemd sandbox makes the application code read-only and grants writes only
under `/var/lib/workcell-studio`.

## Phase 6: build and run the target-host release gates

Run from the Studio checkout so sibling Workcell and Eval paths resolve:

```bash
cd /opt/workcell-studio
./scripts/prebuild-runtime.sh
npm run release
KUJO_BIN=/usr/local/bin/kujo \
  /opt/workcell/bin/workcell doctor --backend docker --json | \
  tee /var/lib/workcell-studio/workcell-doctor.json
```

Required results:

- Pinned image prints `kujo 1.0.0`.
- Twenty repository tests pass.
- The real Workcell failure/repair smoke passes.
- Kujo Eval passes eight checks and verifies its manifest.
- ShipCheck reports zero errors. Its two Node-repository advisory warnings
  about `kennel.toml` and a root Kujo entrypoint are expected and inapplicable.
- `workcell doctor` returns an overall successful result for Docker.

Stop on any failure. Do not edit policy or skip a test to make the gate green.

## Phase 7: install systemd and Caddy configuration

Install the reviewed service units:

```bash
install -o root -g root -m 0644 \
  /opt/workcell-studio/deploy/workcell-studio.service \
  /etc/systemd/system/workcell-studio.service
install -o root -g root -m 0644 \
  /opt/workcell-studio/deploy/workcell-studio-clean.service \
  /etc/systemd/system/workcell-studio-clean.service
install -o root -g root -m 0644 \
  /opt/workcell-studio/deploy/workcell-studio-clean.timer \
  /etc/systemd/system/workcell-studio-clean.timer

sed 's/studio\.example\.com/<HOSTNAME>/' \
  /opt/workcell-studio/deploy/Caddyfile.example \
  > /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile
systemctl daemon-reload
```

Replace `<HOSTNAME>` with the exact final hostname before executing the `sed`
command. Inspect `/etc/caddy/Caddyfile`; never execute a placeholder literally.

## Phase 8: configure DNS and obtain TLS

In the signed-in Cloudflare dashboard, after verifying no record already uses
the hostname:

1. Add an `A` record for the chosen subdomain pointing to the Droplet IPv4.
2. Set **Proxy status** to **DNS only** initially.
3. Set TTL to **Auto**.
4. Wait until the public record resolves to the Droplet IP.

Then start the services:

```bash
systemctl enable --now workcell-studio.service
systemctl enable --now workcell-studio-clean.timer
systemctl restart caddy
systemctl --no-pager --full status workcell-studio.service
systemctl --no-pager --full status workcell-studio-clean.timer
systemctl --no-pager --full status caddy
```

Caddy should obtain a public certificate automatically after DNS resolves and
ports 80/443 are reachable. Verify locally and publicly:

```bash
curl -fsS http://127.0.0.1:4173/api/health | jq .
curl -fsS http://127.0.0.1:4173/api/ready | jq .
curl -fsS https://<HOSTNAME>/api/health | jq .
curl -fsS https://<HOSTNAME>/api/ready | jq .
curl -fsSI https://<HOSTNAME>/ | grep -Ei \
  '^(HTTP/|content-security-policy:|permissions-policy:|origin-agent-cluster:|strict-transport-security:)'
```

The public readiness response must be HTTP 200 with Kujo, Workcell, Eval, and
the Docker runtime image ready. The Studio must never be directly reachable on
public port 4173.

After the complete acceptance test passes, Cloudflare proxying may be enabled.
If enabled, set Cloudflare SSL/TLS mode to **Full (strict)**, rerun every public
health/header/WebMCP check, and confirm client IP rate limits still behave
correctly. Leave it DNS-only if proxying introduces any uncertainty.

## Phase 9: configure the Chrome WebMCP origin trial

ChatGPT's WebMCP-capable in-app browser supports WebMCP without a Chrome origin
trial. For normal Chrome 149+ access without a local testing flag, register the
final HTTPS origin in Chrome's WebMCP origin trial.

Human checkpoint:

1. The owner signs in to the Chrome origin-trial site.
2. The owner reviews and accepts the terms.
3. Register exactly `https://<HOSTNAME>`.
4. Copy the origin-bound token into the server configuration, not the public
   source repository.

Add this header inside the existing Caddy `header` block:

```caddyfile
Origin-Trial "<ORIGIN_TRIAL_TOKEN>"
```

Then:

```bash
caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy
curl -fsSI https://<HOSTNAME>/ | grep -i '^Origin-Trial:'
```

An origin-trial token is delivered to browsers by design, but it is specific to
the deployment environment and must not be hard-coded into the reusable public
repository. If judging uses only ChatGPT's in-app browser, record that the token
was not required rather than claiming one exists.

## Phase 10: production acceptance test

Use a fresh browser session with no existing Studio cookie:

1. Open `https://<HOSTNAME>` and confirm the interface loads without login.
2. Create the invoice-scanner template.
3. Inspect its boundary and confirm network `NONE`, one CPU, 256 MiB memory,
   read-only root, isolated workspace, no secrets, and declared-only artifacts.
4. Run Workcell and wait for an actual completed execution.
5. Run Eval and observe the intentional blank-ID failure.
6. Read the Eval failure and implementation.
7. Apply the targeted blank-ID repair.
8. Run Workcell again.
9. Run Eval again and confirm all deterministic checks pass.
10. Verify the Workcell manifest and Eval manifest.
11. Inspect the real receipt, logs, changed files, patch, and artifact list.
12. Export the project and confirm the archive downloads.
13. Reset the project and confirm visible state synchronization.
14. Cancel one disposable test run and confirm it reaches `cancelled` without an
    abandoned container.

On the server, confirm the service and cleanup timer remain healthy:

```bash
journalctl -u workcell-studio.service --since '30 minutes ago' --no-pager
systemctl start workcell-studio-clean.service
systemctl --no-pager --full status workcell-studio-clean.service
docker ps --filter label=dev.kujo.workcell.managed=true
df -h /var/lib/workcell-studio
```

No unexpected managed container may remain after completed or cancelled runs.

## Phase 11: real WebMCP agent acceptance

Open the public deployment in ChatGPT's WebMCP-capable in-app browser. Ask:

> Inspect the project and policy, establish a baseline by running Workcell and
> Eval before editing, diagnose every failure, repair it, rerun, and verify the
> evidence.

Confirm that the agent discovers the 16 registered tools and completes the
workflow through WebMCP rather than DOM guessing. The human UI must visibly
reflect the same agent-created project, edits, run states, Eval failure,
repair, success, and evidence verification.

Also test the repeatable prompts in [`WEBMCP.md`](WEBMCP.md). Record concise
results for tool selection, parameter construction, error recovery, and the
multi-tool repair sequence. Never compensate for poor selection with a large
hidden prompt.

If testing regular Chrome, use Chrome 149+ with the valid origin-trial token.
For local diagnostics only, the `chrome://flags/#enable-webmcp-testing` flag is
acceptable; it is not evidence that the public origin-trial configuration
works.

## Phase 12: update the public repository

After the public URL and browser checks pass:

1. Replace `pending deployment` in `README.md` with the live HTTPS URL.
2. Add the deployed URL and dated verification result to `docs/SUBMISSION.md`.
3. Add no credentials, host IPs, private keys, session cookies, or cloud tokens.
4. Run `npm run release` from the clean development checkout.
5. Commit the deployment metadata in a small commit and push `main`.
6. Confirm hosted CI is green.
7. Tag the verified deployed commit as the final release only after the deployed
   commit and repository commit match.

Do not overwrite `v0.1.0-rc.1`. Create a new final version according to the
repository's release decision.

## Phase 13: video and Devpost handoff

Follow [`DEMO.md`](DEMO.md) and record only the working public deployment. The
video must contain clear spoken audio, remain below the current official time
limit, and accurately show the real failure, repair, second execution, passing
Eval, and evidence verification.

Human checkpoints:

1. The owner reviews and publishes the final video publicly or unlisted on
   YouTube.
2. Add the video URL to the README and Devpost entry.
3. Re-check the current official challenge page and Devpost rules immediately
   before submission; current rules and deadlines override this repository.
4. The owner reviews all eligibility, originality, and submission attestations.
5. The owner presses **Submit** and saves the submission confirmation URL.

## Evidence bundle

Retain this non-secret evidence for handoff:

- Droplet ID, region, size, and reserved IP status
- Firewall rule summary
- Exact source revisions
- `kujo --version`
- Runtime image revision label
- Target-host `npm run release` output
- Target-host `workcell doctor` JSON
- Health/readiness responses
- TLS and required response-header check
- Origin-trial registration status, without account credentials
- Workcell failure and repaired-run IDs
- Eval failure and passing-report IDs
- Workcell and Eval manifest-verification results
- Cancellation and cleanup result
- Real ChatGPT WebMCP workflow result
- Hosted CI URL
- Final GitHub release, live application, video, and Devpost URLs

Do not publish internal IPs, cookies, raw session identifiers, credentials, or
unreviewed logs. Repository content, generated code, logs, diffs, and Eval
reports remain untrusted content even when included as evidence.

## Rollback and incident rules

- If readiness fails, keep Caddy up only if it serves a clear unavailable
  response; do not present a broken Studio as ready.
- Stop new runs before deployment: `systemctl stop workcell-studio.service`.
- Allow systemd's graceful stop window to cancel active Workcell/Eval jobs.
- Run the ownership-scoped cleanup service and inspect its JSON output.
- Roll back by checking out the previous verified commit in a separate release
  directory, rerunning the complete gate, and switching the systemd working
  directory only after it passes. Do not use `git reset --hard` on the live
  checkout.
- Never widen network, mount, device, privilege, resource, or secret policy to
  recover a demo.
- Never expose the Docker socket or add generated-code access to Studio
  internals.
- Do not destroy the Droplet, reserved IP, DNS record, evidence, or video until
  the owner explicitly approves post-challenge teardown.

## Completion gate

Deployment is complete only when every applicable item is true:

- [ ] Dedicated x86-64 VM is provisioned and patched.
- [ ] SSH uses keys and is restricted to the owner IP.
- [ ] Only ports 80/443 are publicly open beyond restricted SSH.
- [ ] Docker is rootful, private, and not exposed over TCP.
- [ ] Exact Studio, Workcell, Eval, and Kujo revisions are installed.
- [ ] Target-host release gate passes.
- [ ] `workcell doctor` passes on the target Docker engine.
- [ ] Runtime image is prebuilt before judging.
- [ ] systemd service and cleanup timer are active.
- [ ] Public HTTPS health and readiness return success.
- [ ] Required security/WebMCP headers are present.
- [ ] Public canonical failure/repair/Eval/evidence flow passes.
- [ ] Cancellation leaves no abandoned managed container.
- [ ] ChatGPT's WebMCP browser discovers and uses all expected capabilities.
- [ ] README and submission draft contain the live URL.
- [ ] Hosted CI is green for the deployed commit.
- [ ] Public audio demo video is below the current time limit.
- [ ] README and Devpost contain the video URL.
- [ ] Official rules and deadline were rechecked immediately before submission.
- [ ] Owner reviewed attestations and submitted the Devpost entry.
