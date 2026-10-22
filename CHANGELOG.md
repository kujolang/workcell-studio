# Changelog

## 0.1.0-rc.4 - 2026-10-22

- Align CI, host runtime, and container runtime with Kujo 1.6.0.
- Pin Workcell 1.3.0 and tested Eval/ShipCheck revisions for release verification.
- Require patched Node versions and exercise CI on Node 26.12.1.
- Preserve the prerelease boundary and require real failure/repair/Eval evidence.

## 0.1.0-rc.3 - 2026-08-26

- Add a fail-closed, rate-limited judge access gate for production UI, API,
  event, export, and WebMCP surfaces.
- Use expiring and revocable `__Host-` cookies and constant-time code checks.
- Add deployment-secret, private Devpost handoff, and access-boundary tests.

## 0.1.0 - 2026-08-25

- Initial WebMCP Challenge release of Kujo Workcell Studio.
