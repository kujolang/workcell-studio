import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("container Kujo commit matches Workcell's required runtime", async () => {
  const dockerfile = await fs.readFile(path.join(root, "docker/kujo-runtime/Dockerfile"), "utf8");
  const required = (await fs.readFile(path.join(root, "../workcell/RUNTIME_VERSION"), "utf8")).trim();
  assert.match(dockerfile, new RegExp(`ARG KUJO_COMMIT=${required}`));
});

test("production cleanup targets the same Workcell temporary root as Studio", async () => {
  const service = await fs.readFile(path.join(root, "deploy/workcell-studio-clean.service"), "utf8");
  assert.match(service, /^Environment=TMPDIR=\/var\/lib\/workcell-studio$/m);
  assert.match(service, /^ExecStart=\/opt\/workcell\/bin\/workcell clean --backend docker --json$/m);
});

test("human UI exposes every collaboration and recovery control", async () => {
  const html = await fs.readFile(path.join(root, "frontend/index.html"), "utf8");
  for (const control of ["run-button", "cancel-run", "eval-button", "cancel-eval", "eval-report", "diff-button", "export-button", "reset-button"]) assert.match(html, new RegExp(`id=\\"${control}\\"`));
  assert.doesNotMatch(html, /data-stage="collecting"|data-stage="verifying"/);
});

test("canonical Kujo fixture exposes the intended first-run failure", async (t) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "invoice-template-")); t.after(() => fs.rm(temp, { recursive: true, force: true }));
  await fs.cp(path.join(root, "templates/invoice-scanner"), temp, { recursive: true });
  const result = spawnSync("kujo", ["run", "main.kujo", "--", "fixtures/invoices.csv", "report.json"], { cwd: temp, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(await fs.readFile(path.join(temp, "report.json"), "utf8"));
  assert.equal(report.duplicate_count, 4);
  assert.equal(report.duplicates.filter((row) => row.invoice_id === "").length, 2);
});

test("repairing the blank-ID condition yields the accepted result", async (t) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "invoice-repair-")); t.after(() => fs.rm(temp, { recursive: true, force: true }));
  await fs.cp(path.join(root, "templates/invoice-scanner"), temp, { recursive: true });
  const main = path.join(temp, "main.kujo"); const source = await fs.readFile(main, "utf8");
  await fs.writeFile(main, source.replace('if counts[invoice["invoice_id"]] > 1 {', 'if invoice["invoice_id"] != "" && counts[invoice["invoice_id"]] > 1 {'));
  const result = spawnSync("kujo", ["run", "main.kujo", "--", "fixtures/invoices.csv", "report.json"], { cwd: temp, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(await fs.readFile(path.join(temp, "report.json"), "utf8"));
  assert.equal(report.duplicate_count, 2);
});
