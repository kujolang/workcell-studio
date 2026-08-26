import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { LIMITS } from "../src/server/limits.js";
import { Studio, StudioError, bounded } from "../src/server/studio.js";
import { registerStudioTools, toolDefinitions } from "../webmcp/register-tools.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workcellBin = path.resolve(root, "../workcell/bin/workcell");
const evalMain = path.resolve(root, "../eval/main.kujo");

async function fixture() {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "workcell-studio-test-"));
  const studio = new Studio({ root, dataRoot, workcellBin, kujoBin: "kujo", evalMain });
  await studio.init();
  const created = await studio.createProject("a".repeat(32), { name: "Test", objective: "Verify isolation", template: "invoice-scanner" });
  return { studio, dataRoot, projectId: created.project.id, sessionId: "a".repeat(32) };
}

test("WebMCP tools have focused schemas and deliberate annotations", async () => {
  assert.equal(toolDefinitions.length, 16);
  assert.equal(new Set(toolDefinitions.map((tool) => tool.name)).size, toolDefinitions.length);
  assert.ok(toolDefinitions.every((tool) => tool.name.length <= 30));
  assert.ok(toolDefinitions.every((tool) => tool.description.length <= 500));
  const byName = Object.fromEntries(toolDefinitions.map((tool) => [tool.name, tool]));
  for (const name of ["get_studio_state", "list_files", "read_file", "inspect_policy", "get_run_status", "inspect_run", "get_eval_report", "get_diff", "verify_run"]) assert.equal(byName[name].annotations.readOnlyHint, true, name);
  for (const name of ["create_project", "write_file", "apply_patch", "run_workcell", "run_eval", "reset_project", "export_project"]) assert.equal(byName[name].annotations.readOnlyHint, false, name);
  for (const name of ["get_studio_state", "list_files", "read_file", "inspect_run", "get_eval_report", "get_diff"]) assert.equal(byName[name].annotations.untrustedContentHint, true, name);
  const registered = [];
  assert.deepEqual(await registerStudioTools({ registerTool: async (tool) => registered.push(tool) }), { supported: true, registered: 16 });
});

test("WebMCP Eval cancellation reaches the scoped server endpoint", async (t) => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    return { ok: true, json: async () => ({ ok: true, eval_id: `e_${"2".repeat(16)}`, status: "running" }) };
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  const controller = new AbortController();
  const tool = toolDefinitions.find(({ name }) => name === "run_eval");
  await tool.execute({ project_id: `p_${"3".repeat(16)}`, run_id: `r_${"4".repeat(16)}` }, { signal: controller.signal });
  controller.abort();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls.length, 2);
  assert.match(calls[1].url, /\/evals\/e_2222222222222222\/cancel$/);
  assert.equal(calls[1].options.method, "POST");
});

test("WebMCP tools tolerate DevTools invocations without an execution context", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ ok: true, status: "completed" }) });
  t.after(() => { globalThis.fetch = originalFetch; });
  const tool = toolDefinitions.find(({ name }) => name === "get_run_status");
  const output = await tool.execute({ project_id: `p_${"5".repeat(16)}`, run_id: `r_${"6".repeat(16)}` });
  assert.equal(JSON.parse(output).status, "completed");
});

test("bounded tool output stays inside Chrome guidance", () => {
  assert.ok(bounded("x".repeat(3000)).length <= LIMITS.toolOutputChars);
});

test("project file reads reject traversal, absolute paths, nulls, and symlinks", async (t) => {
  const ctx = await fixture(); t.after(() => fs.rm(ctx.dataRoot, { recursive: true, force: true }));
  for (const bad of ["../../etc/passwd", "/etc/passwd", "C:\\Windows\\system.ini", "a\0b"]) {
    await assert.rejects(() => ctx.studio.readFile(ctx.sessionId, ctx.projectId, bad), StudioError);
  }
  await assert.rejects(() => ctx.studio.readFile(ctx.sessionId, ctx.projectId, ".git/config"), /Git control/);
  const repo = ctx.studio.repoRoot(ctx.sessionId, ctx.projectId);
  await fs.symlink("/etc/passwd", path.join(repo, "escape"));
  await assert.rejects(() => ctx.studio.readFile(ctx.sessionId, ctx.projectId, "escape"), /Symlinks/);
});

test("opaque project IDs are scoped to the browser session", async (t) => {
  const ctx = await fixture(); t.after(() => fs.rm(ctx.dataRoot, { recursive: true, force: true }));
  await assert.rejects(() => ctx.studio.listFiles("b".repeat(32), ctx.projectId), /not available/);
  await assert.rejects(() => ctx.studio.listFiles(ctx.sessionId, "p_not-an-id"), /opaque ID/);
});

test("concurrent project creation is serialized per session", async (t) => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "workcell-studio-create-lock-")); t.after(() => fs.rm(dataRoot, { recursive: true, force: true }));
  const studio = new Studio({ root, dataRoot, workcellBin, kujoBin: "kujo", evalMain });
  await studio.init();
  const sessionId = "c".repeat(32);
  const first = studio.createProject(sessionId, { name: "First", objective: "First", template: "invoice-scanner" });
  await assert.rejects(() => studio.createProject(sessionId, { name: "Second", objective: "Second", template: "invoice-scanner" }), /already being created/);
  assert.equal((await first).ok, true);
});

test("live events do not cross browser-session boundaries", async (t) => {
  const ctx = await fixture(); t.after(() => fs.rm(ctx.dataRoot, { recursive: true, force: true }));
  const received = [];
  const off = ctx.studio.subscribe("b".repeat(32), (event) => received.push(event));
  ctx.studio.emit({ type: "workspace", project_id: ctx.projectId, session_id: ctx.sessionId });
  off();
  assert.deepEqual(received, []);
});

test("writes are bounded and become reviewable commits", async (t) => {
  const ctx = await fixture(); t.after(() => fs.rm(ctx.dataRoot, { recursive: true, force: true }));
  await assert.rejects(() => ctx.studio.writeFile(ctx.sessionId, ctx.projectId, "huge.txt", "x".repeat(LIMITS.fileBytes + 1)), /limited/);
  const result = await ctx.studio.writeFile(ctx.sessionId, ctx.projectId, "notes.txt", "bounded\n", "human");
  assert.equal(result.ok, true);
  const diff = await ctx.studio.getDiff(ctx.sessionId, ctx.projectId);
  assert.ok(diff.changed_files.includes("notes.txt"));
});

test("patches reject escapes and apply targeted changes", async (t) => {
  const ctx = await fixture(); t.after(() => fs.rm(ctx.dataRoot, { recursive: true, force: true }));
  await assert.rejects(() => ctx.studio.applyPatch(ctx.sessionId, ctx.projectId, "--- /etc/passwd\n+++ /etc/passwd\n@@ -1 +1 @@\n-x\n+y\n"), StudioError);
  await assert.rejects(() => ctx.studio.writeFile(ctx.sessionId, ctx.projectId, "workcell.json", "{}"), /read-only/);
  await assert.rejects(() => ctx.studio.applyPatch(ctx.sessionId, ctx.projectId, "diff --git a/workcell.json b/workcell.json\n--- a/workcell.json\n+++ b/workcell.json\n@@ -1 +1 @@\n-{\n+{}\n"), /cannot modify/);
  const patch = "diff --git a/README.md b/README.md\nindex fcb781e..963df02 100644\n--- a/README.md\n+++ b/README.md\n@@ -1,3 +1,3 @@\n-# Invoice Duplicate Detector\n+# Verified Invoice Duplicate Detector\n \n Build a Kujo CLI that reads `fixtures/invoices.csv` and writes `report.json`.\n";
  const result = await ctx.studio.applyPatch(ctx.sessionId, ctx.projectId, patch);
  assert.equal(result.ok, true);
});

test("patch validation rejects quoted-path attempts to rename protected policy", async (t) => {
  const ctx = await fixture(); t.after(() => fs.rm(ctx.dataRoot, { recursive: true, force: true }));
  const patch = 'diff --git "a/workcell.json" "b/policy.json"\nsimilarity index 100%\nrename from workcell.json\nrename to policy.json\n';
  await assert.rejects(() => ctx.studio.applyPatch(ctx.sessionId, ctx.projectId, patch), /cannot modify/);
  assert.equal(await fs.readFile(path.join(ctx.studio.repoRoot(ctx.sessionId, ctx.projectId), "workcell.json"), "utf8").then(Boolean), true);
});

test("mutations are rejected while a project job is reserved", async (t) => {
  const ctx = await fixture(); t.after(() => fs.rm(ctx.dataRoot, { recursive: true, force: true }));
  ctx.studio.reserveJob(`r_${"9".repeat(16)}`, "run", ctx.sessionId, ctx.projectId);
  await assert.rejects(() => ctx.studio.writeFile(ctx.sessionId, ctx.projectId, "notes.txt", "race\n"), /active mutation, execution, or Eval/);
});

test("destructive reset requires explicit confirmation", async (t) => {
  const ctx = await fixture(); t.after(() => fs.rm(ctx.dataRoot, { recursive: true, force: true }));
  await assert.rejects(() => ctx.studio.resetProject(ctx.sessionId, ctx.projectId), /confirmation/);
  assert.equal((await ctx.studio.resetProject(ctx.sessionId, ctx.projectId, true)).ok, true);
});

test("public policy is validated by Kujo and Workcell", async (t) => {
  const ctx = await fixture(); t.after(() => fs.rm(ctx.dataRoot, { recursive: true, force: true }));
  const policy = await ctx.studio.inspectPolicy(ctx.sessionId, ctx.projectId);
  assert.equal(policy.ok, true);
  assert.equal(policy.policy.network, "none");
  assert.equal(policy.public_profile_valid, true);
});

test("project export contains sealed source without Git control data", async (t) => {
  const ctx = await fixture(); t.after(() => fs.rm(ctx.dataRoot, { recursive: true, force: true }));
  const exported = await ctx.studio.exportProject(ctx.sessionId, ctx.projectId);
  const archive = path.join(ctx.studio.projectRoot(ctx.sessionId, ctx.projectId), "exports", `${ctx.projectId}.tar.gz`);
  const { stdout } = await import("node:child_process").then(({ spawnSync }) => spawnSync("tar", ["-tzf", archive], { encoding: "utf8" }));
  assert.equal(exported.ok, true);
  assert.match(stdout, /main\.kujo/);
  assert.doesNotMatch(stdout, /(^|\/)\.git(\/|$)/m);
});

test("asynchronous Eval can be polled and cancelled", async (t) => {
  const ctx = await fixture(); t.after(() => fs.rm(ctx.dataRoot, { recursive: true, force: true }));
  const fakeKujo = path.join(ctx.dataRoot, "slow-kujo");
  await fs.writeFile(fakeKujo, "#!/usr/bin/env node\nsetTimeout(() => {}, 10000);\n", { mode: 0o700 });
  ctx.studio.kujoBin = fakeKujo;
  const runId = `r_${"1".repeat(16)}`;
  const runRoot = ctx.studio.runRoot(ctx.sessionId, ctx.projectId, runId);
  await fs.mkdir(runRoot, { recursive: true });
  await fs.writeFile(path.join(runRoot, "studio-run.json"), JSON.stringify({ id: runId, project_id: ctx.projectId, status: "completed", exit_category: "completed", completed_at: new Date().toISOString() }));
  const started = await ctx.studio.runEval(ctx.sessionId, ctx.projectId, runId);
  assert.equal(started.status, "running");
  assert.equal((await ctx.studio.getEval(ctx.sessionId, ctx.projectId, runId, started.eval_id)).report.status, "running");
  assert.equal((await ctx.studio.cancelEval(ctx.sessionId, ctx.projectId, runId, started.eval_id)).status, "cancelling");
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const report = await ctx.studio.getEval(ctx.sessionId, ctx.projectId, runId, started.eval_id);
    if (report.report.status === "cancelled") {
      assert.equal(report.report.summary.includes("cancelled"), true);
      for (let finalizing = 0; finalizing < 50 && ctx.studio.active.has(started.eval_id); finalizing += 1) await new Promise((resolve) => setTimeout(resolve, 20));
      assert.equal(ctx.studio.active.has(started.eval_id), false);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail("Eval did not reach cancelled state");
});
