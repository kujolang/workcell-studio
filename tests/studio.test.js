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
