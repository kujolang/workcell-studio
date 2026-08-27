import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { AccessGate, cookieValue } from "../src/server/access.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const accessCode = "judge_test_code_1234567890";

async function freePort() {
  const socket = net.createServer();
  await new Promise((resolve, reject) => socket.listen(0, "127.0.0.1", resolve).once("error", reject));
  const { port } = socket.address();
  await new Promise((resolve) => socket.close(resolve));
  return port;
}

async function startServer(t, extraEnv = {}) {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "workcell-studio-access-"));
  const port = await freePort();
  const child = spawn(process.execPath, ["src/server/main.js"], {
    cwd: root,
    env: { ...process.env, NODE_ENV: "production", STUDIO_ACCESS_CODE: accessCode, STUDIO_DATA_ROOT: dataRoot, HOST: "127.0.0.1", PORT: String(port), ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = ""; child.stdout.on("data", (data) => { output += data; }); child.stderr.on("data", (data) => { output += data; });
  t.after(async () => { child.kill("SIGTERM"); await new Promise((resolve) => child.once("exit", resolve)); await fs.rm(dataRoot, { recursive: true, force: true }); });
  const origin = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Studio exited before startup: ${output}`);
    try { if ((await fetch(`${origin}/api/health`)).ok) return { origin, child, output: () => output }; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Studio did not start: ${output}`);
}

test("production access configuration fails closed and rejects weak codes", () => {
  assert.throws(() => new AccessGate({ production: true }), /required/);
  assert.throws(() => new AccessGate({ production: true, code: "too-short" }), /20-128/);
  assert.throws(() => new AccessGate({ production: true, code: `${"a".repeat(20)}\n` }), /20-128/);
});

test("production service loads a private credential file with a restrictive umask", async () => {
  const unit = await fs.readFile(path.join(root, "deploy/workcell-studio.service"), "utf8");
  assert.match(unit, /^EnvironmentFile=\/etc\/workcell-studio\/access\.env$/m);
  assert.match(unit, /^UMask=0077$/m);
});

test("access sessions require the correct code, expire, and can be revoked", () => {
  let time = 1000;
  const gate = new AccessGate({ code: accessCode, production: true, now: () => time, randomBytes: () => Buffer.alloc(32, 7) });
  assert.equal(gate.verifyCode("wrong_code_that_is_long_enough"), false);
  assert.equal(gate.verifyCode(accessCode), true);
  assert.equal(gate.authenticate("__Host-kujo_studio_access=0".repeat(64)), false);
  const token = gate.issue(); const header = `unrelated=x; ${gate.cookieName}=${token}`;
  assert.equal(gate.authenticate(header), true);
  assert.equal(cookieValue(header, gate.cookieName), token);
  gate.revoke(header);
  assert.equal(gate.authenticate(header), false);
  const expiring = gate.issue(); time += 2 * 60 * 60 * 1000;
  assert.equal(gate.authenticate(`${gate.cookieName}=${expiring}`), false);
});

test("judge gate blocks UI, API, and WebMCP until login, then revokes access", async (t) => {
  const server = await startServer(t);
  const accessPage = await fetch(`${server.origin}/`);
  assert.equal(accessPage.status, 200);
  assert.match(await accessPage.text(), /id="access-form"/);

  for (const target of ["/api/state", "/app.js", "/webmcp/register-tools.js"]) {
    const response = await fetch(`${server.origin}${target}`);
    assert.equal(response.status, 401, target);
    assert.equal(response.headers.get("set-cookie"), null, target);
  }

  const wrong = await fetch(`${server.origin}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: "wrong_code_that_is_long_enough" }) });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.headers.get("set-cookie"), null);

  const login = await fetch(`${server.origin}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: accessCode }) });
  assert.equal(login.status, 200);
  const setCookie = login.headers.get("set-cookie");
  assert.match(setCookie, /^__Host-kujo_studio_access=[a-f0-9]{64};/);
  assert.match(setCookie, /HttpOnly/); assert.match(setCookie, /SameSite=Strict/); assert.match(setCookie, /Secure/);
  const accessCookie = setCookie.split(";", 1)[0];

  const state = await fetch(`${server.origin}/api/state`, { headers: { Cookie: accessCookie } });
  assert.equal(state.status, 200);
  assert.match(state.headers.get("set-cookie"), /^__Host-kujo_studio_session=[a-f0-9]{32};/);
  assert.equal((await fetch(`${server.origin}/app.js`, { headers: { Cookie: accessCookie } })).status, 200);
  assert.equal((await fetch(`${server.origin}/webmcp/register-tools.js`, { headers: { Cookie: accessCookie } })).status, 200);

  const logout = await fetch(`${server.origin}/api/auth/logout`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: accessCookie }, body: "{}" });
  assert.equal(logout.status, 200);
  const cleared = logout.headers.get("set-cookie");
  assert.match(cleared, /__Host-kujo_studio_access=.*Max-Age=0/);
  assert.match(cleared, /__Host-kujo_studio_session=.*Max-Age=0/);
  assert.equal((await fetch(`${server.origin}/api/state`, { headers: { Cookie: accessCookie } })).status, 401);
});

test("judge login is rate-limited independently of ordinary requests", async (t) => {
  const server = await startServer(t);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch(`${server.origin}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: "wrong_code_that_is_long_enough" }) });
    assert.equal(response.status, 401);
  }
  const limited = await fetch(`${server.origin}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: accessCode }) });
  assert.equal(limited.status, 429);
});
