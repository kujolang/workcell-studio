import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { LIMITS, PUBLIC_POLICY } from "./limits.js";

const SAFE_ID = /^(p|r|e)_[a-f0-9]{16}$/;
const SAFE_PATH = /^[A-Za-z0-9][A-Za-z0-9._\-/]{0,239}$/;
const SKIP_FILES = new Set([".git"]);
const PROTECTED_FILES = new Set(["workcell.json"]);

export class StudioError extends Error {
  constructor(code, message, status = 400, suggestedTools = []) {
    super(message);
    this.code = code;
    this.status = status;
    this.suggestedTools = suggestedTools;
  }
}

const id = (prefix) => `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
const now = () => new Date().toISOString();
const bounded = (value, max = LIMITS.toolOutputChars) => {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  const suffix = "\n… output truncated by Studio";
  return text.length <= max ? text : `${text.slice(0, max - suffix.length)}${suffix}`;
};

function sanitizeEvidence(value, replacements) {
  if (typeof value === "string") {
    let clean = value;
    for (const [needle, replacement] of replacements) clean = clean.split(needle).join(replacement);
    return clean;
  }
  if (Array.isArray(value)) return value.map((item) => sanitizeEvidence(item, replacements));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizeEvidence(item, replacements)]));
  return value;
}

async function exists(target) {
  try { await fsp.access(target); return true; } catch { return false; }
}

async function readJson(file, fallback = null) {
  try { return JSON.parse(await fsp.readFile(file, "utf8")); } catch { return fallback; }
}

async function writeJson(file, value) {
  await fsp.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  await fsp.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await fsp.rename(temp, file);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: LIMITS.logBytes * 4, ...options });
  if (result.status !== 0) {
    throw new StudioError("operation_failed", bounded(result.stderr || result.stdout || `${command} failed`), 422);
  }
  return result.stdout.trim();
}

export class Studio {
  constructor({ root, dataRoot, workcellBin, kujoBin, evalMain }) {
    this.root = root;
    this.dataRoot = dataRoot;
    this.workcellBin = workcellBin;
    this.kujoBin = kujoBin;
    this.evalMain = evalMain;
    this.workcellTmp = process.env.STUDIO_WORKCELL_TMP || path.dirname(dataRoot);
    this.active = new Map();
    this.listeners = new Set();
  }

  sessionRoot(sessionId) { return path.join(this.dataRoot, "sessions", sessionId); }
  projectRoot(sessionId, projectId) { return path.join(this.sessionRoot(sessionId), "projects", projectId); }
  projectMeta(sessionId, projectId) { return path.join(this.projectRoot(sessionId, projectId), "project.json"); }
  repoRoot(sessionId, projectId) { return path.join(this.projectRoot(sessionId, projectId), "repo"); }
  runRoot(sessionId, projectId, runId) { return path.join(this.projectRoot(sessionId, projectId), "runs", runId); }

  async init() {
    await fsp.mkdir(this.dataRoot, { recursive: true, mode: 0o700 });
    await fsp.mkdir(this.workcellTmp, { recursive: true, mode: 0o700 });
    await this.cleanupExpired();
    this.cleanupTimer = setInterval(() => this.cleanupExpired().catch(() => {}), 15 * 60 * 1000);
    this.cleanupTimer.unref();
  }

  readiness() {
    const kujo = spawnSync(this.kujoBin, ["--version"], { encoding: "utf8", timeout: 5000 });
    const workcell = spawnSync(this.workcellBin, ["--version"], { encoding: "utf8", timeout: 5000, env: { ...process.env, KUJO: this.kujoBin } });
    const evalCli = spawnSync(this.kujoBin, ["run", this.evalMain, "version"], { encoding: "utf8", timeout: 10000 });
    const checks = { kujo: kujo.status === 0, workcell: workcell.status === 0, eval: evalCli.status === 0, docker_image: spawnSync("docker", ["image", "inspect", "kujolang/workcell-kujo:local"], { stdio: "ignore", timeout: 5000 }).status === 0 };
    return { ok: Object.values(checks).every(Boolean), service: "kujo-workcell-studio", checks, versions: { kujo: bounded(kujo.stdout, 80), workcell: bounded(workcell.stdout, 80), eval: bounded(evalCli.stdout, 100) } };
  }

  emit(event) {
    for (const listener of this.listeners) listener(event);
  }

  subscribe(sessionId, listener) {
    const scoped = (event) => {
      if (event.session_id !== sessionId) return;
      const { session_id: _privateSession, ...publicEvent } = event;
      listener(publicEvent);
    };
    this.listeners.add(scoped);
    return () => this.listeners.delete(scoped);
  }

  validateId(value, prefix = null) {
    if (typeof value !== "string" || !SAFE_ID.test(value) || (prefix && !value.startsWith(`${prefix}_`))) {
      throw new StudioError("invalid_id", "Use the opaque ID returned by Studio.", 400, ["get_studio_state"]);
    }
    return value;
  }

  async requireProject(sessionId, projectId) {
    this.validateId(projectId, "p");
    const meta = await readJson(this.projectMeta(sessionId, projectId));
    if (!meta) throw new StudioError("project_not_found", "Project is not available in this browser session.", 404, ["create_project"]);
    return meta;
  }

  async safeFile(sessionId, projectId, relative, { allowMissing = false } = {}) {
    await this.requireProject(sessionId, projectId);
    if (typeof relative === "string" && relative.split("/").includes(".git")) throw new StudioError("protected_file", "Git control files are not exposed through project file capabilities.", 403);
    if (typeof relative !== "string" || !SAFE_PATH.test(relative) || relative.includes("//") || relative.split("/").includes("..") || path.isAbsolute(relative) || relative.includes("\0") || relative.includes("\\")) {
      throw new StudioError("invalid_path", "Path must be a normalized project-relative path.", 400);
    }
    const repo = this.repoRoot(sessionId, projectId);
    const target = path.resolve(repo, relative);
    if (!target.startsWith(`${path.resolve(repo)}${path.sep}`)) throw new StudioError("path_escape", "Path escapes the project workspace.", 403);
    let cursor = target;
    while (cursor !== repo && cursor.startsWith(repo)) {
      if (await exists(cursor)) {
        const stat = await fsp.lstat(cursor);
        if (stat.isSymbolicLink()) throw new StudioError("symlink_rejected", "Symlinks are not allowed in project file operations.", 403);
      }
      cursor = path.dirname(cursor);
    }
    if (!allowMissing && !(await exists(target))) throw new StudioError("file_not_found", "Project file does not exist.", 404, ["list_files"]);
    return target;
  }

  async listTemplates() {
    const entries = await fsp.readdir(path.join(this.root, "templates"), { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  }

  async createProject(sessionId, { name, objective, template = "invoice-scanner" }) {
    const templates = await this.listTemplates();
    if (!templates.includes(template)) throw new StudioError("invalid_template", `Choose one of: ${templates.join(", ")}.`, 400);
    const projectsRoot = path.join(this.sessionRoot(sessionId), "projects");
    const existingProjects = (await exists(projectsRoot)) ? await fsp.readdir(projectsRoot) : [];
    if (existingProjects.length >= LIMITS.maxProjectsPerSession) throw new StudioError("project_capacity", "This session reached its project limit.", 429);
    const cleanName = String(name || "Untitled Workcell").trim().slice(0, 80);
    const cleanObjective = String(objective || "Build and verify the starter project.").trim().slice(0, 500);
    const projectId = id("p");
    const projectRoot = this.projectRoot(sessionId, projectId);
    const repo = path.join(projectRoot, "repo");
    await fsp.mkdir(projectRoot, { recursive: true, mode: 0o700 });
    await fsp.cp(path.join(this.root, "templates", template), repo, { recursive: true, errorOnExist: true });
    run("git", ["init", "-b", "main"], { cwd: repo });
    run("git", ["config", "user.name", "Kujo Workcell Studio"], { cwd: repo });
    run("git", ["config", "user.email", "studio@local.invalid"], { cwd: repo });
    run("git", ["add", "."], { cwd: repo });
    run("git", ["commit", "-m", "Create project from verified template"], { cwd: repo });
    const initialCommit = run("git", ["rev-parse", "HEAD"], { cwd: repo });
    const meta = { id: projectId, name: cleanName, objective: cleanObjective, template, created_at: now(), updated_at: now(), status: "needs_verification", initial_commit: initialCommit, latest_run_id: null, latest_eval_id: null };
    await writeJson(this.projectMeta(sessionId, projectId), meta);
    await this.activity(sessionId, projectId, "human_or_agent", "create_project", `Created ${cleanName}`);
    this.emit({ type: "project", project_id: projectId, session_id: sessionId });
    return { ok: true, project: meta, suggested_tools: ["list_files", "inspect_policy"] };
  }

  async activity(sessionId, projectId, actor, action, summary, runId = null) {
    const file = path.join(this.projectRoot(sessionId, projectId), "activity.json");
    const items = await readJson(file, []);
    items.push({ id: crypto.randomUUID(), timestamp: now(), actor_type: actor, action, summary: String(summary).slice(0, 180), run_id: runId });
    await writeJson(file, items.slice(-100));
  }

  async listFiles(sessionId, projectId) {
    await this.requireProject(sessionId, projectId);
    const repo = this.repoRoot(sessionId, projectId);
    const items = [];
    const walk = async (dir, depth = 0) => {
      if (depth > 8) return;
      for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
        if (SKIP_FILES.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        const rel = path.relative(repo, full).split(path.sep).join("/");
        const stat = await fsp.lstat(full);
        if (stat.isSymbolicLink()) { items.push({ path: rel, type: "rejected_symlink", bytes: 0 }); continue; }
        if (entry.isDirectory()) await walk(full, depth + 1);
        else items.push({ path: rel, type: "file", bytes: stat.size });
      }
    };
    await walk(repo);
    return { ok: true, files: items.slice(0, LIMITS.projectFiles), count: items.length, truncated: items.length > LIMITS.projectFiles };
  }

  async readFile(sessionId, projectId, relative) {
    const target = await this.safeFile(sessionId, projectId, relative);
    const stat = await fsp.stat(target);
    if (!stat.isFile() || stat.size > LIMITS.fileBytes) throw new StudioError("file_too_large", `Readable files are limited to ${LIMITS.fileBytes} bytes.`, 413);
    const content = await fsp.readFile(target, "utf8");
    return { ok: true, path: relative, bytes: stat.size, content: bounded(content, 1200), truncated: content.length > 1200, content_is_untrusted: true };
  }

  async projectUsage(repo) {
    let files = 0; let bytes = 0;
    const walk = async (dir) => {
      for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
        if (SKIP_FILES.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        const stat = await fsp.lstat(full);
        if (stat.isSymbolicLink()) throw new StudioError("symlink_rejected", "Project contains a symlink.", 403);
        if (entry.isDirectory()) await walk(full); else { files += 1; bytes += stat.size; }
      }
    };
    await walk(repo);
    if (files > LIMITS.projectFiles || bytes > LIMITS.projectBytes) throw new StudioError("project_limit", "Project size limit exceeded.", 413);
    return { files, bytes };
  }

  async commitMutation(sessionId, projectId, message) {
    const repo = this.repoRoot(sessionId, projectId);
    await this.projectUsage(repo);
    run("git", ["add", "-A"], { cwd: repo });
    const status = run("git", ["status", "--porcelain"], { cwd: repo });
    if (status) run("git", ["commit", "-m", message.slice(0, 100)], { cwd: repo });
    const meta = await this.requireProject(sessionId, projectId);
    meta.updated_at = now(); meta.status = "needs_verification";
    await writeJson(this.projectMeta(sessionId, projectId), meta);
    this.emit({ type: "workspace", project_id: projectId, session_id: sessionId });
  }

  async writeFile(sessionId, projectId, relative, content, actor = "agent") {
    if (typeof content !== "string" || Buffer.byteLength(content) > LIMITS.fileBytes) throw new StudioError("file_too_large", `Writes are limited to ${LIMITS.fileBytes} bytes.`, 413);
    const target = await this.safeFile(sessionId, projectId, relative, { allowMissing: true });
    if (PROTECTED_FILES.has(relative) || relative.split("/").includes(".git")) throw new StudioError("protected_file", "Studio execution policy files are read-only through project mutation tools.", 403, ["inspect_policy"]);
    await fsp.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    try {
      await fsp.writeFile(target, content, { encoding: "utf8", mode: 0o600 });
      await this.commitMutation(sessionId, projectId, `Update ${relative}`);
    } catch (error) {
      const repo = this.repoRoot(sessionId, projectId);
      spawnSync("git", ["reset", "--hard", "HEAD"], { cwd: repo, stdio: "ignore" });
      spawnSync("git", ["clean", "-fd"], { cwd: repo, stdio: "ignore" });
      throw error;
    }
    await this.activity(sessionId, projectId, actor, "write_file", `Updated ${relative}`);
    return { ok: true, path: relative, bytes: Buffer.byteLength(content), status: "needs_verification", suggested_tools: ["get_diff", "run_workcell"] };
  }

  async applyPatch(sessionId, projectId, patchText, actor = "agent") {
    if (typeof patchText !== "string" || Buffer.byteLength(patchText) > LIMITS.patchBytes) throw new StudioError("patch_too_large", `Patches are limited to ${LIMITS.patchBytes} bytes.`, 413);
    if (/^diff --git a\/(?:\/|\.\.)/m.test(patchText) || /^(?:---|\+\+\+)\s+(?:\/|[ab]\/\.\.)/m.test(patchText)) throw new StudioError("invalid_patch", "Patch paths must stay project-relative.", 400);
    const patchPaths = [...patchText.matchAll(/^(?:diff --git a\/|--- a\/|\+\+\+ b\/)([^\t\n]+)/gm)].map((match) => match[1]);
    if (patchPaths.some((candidate) => PROTECTED_FILES.has(candidate) || candidate.split("/").includes(".git"))) throw new StudioError("protected_file", "Patches cannot modify Studio policy or Git control files.", 403, ["inspect_policy"]);
    const repo = this.repoRoot(sessionId, projectId);
    await this.requireProject(sessionId, projectId);
    const proc = spawnSync("git", ["apply", "--check", "--whitespace=error-all", "-"], { cwd: repo, input: patchText, encoding: "utf8", maxBuffer: LIMITS.patchBytes * 2 });
    if (proc.status !== 0) throw new StudioError("patch_rejected", bounded(proc.stderr || "Patch did not apply cleanly."), 422, ["read_file", "get_diff"]);
    const applied = spawnSync("git", ["apply", "--whitespace=error-all", "-"], { cwd: repo, input: patchText, encoding: "utf8", maxBuffer: LIMITS.patchBytes * 2 });
    if (applied.status !== 0) throw new StudioError("patch_failed", bounded(applied.stderr), 422);
    try {
      await this.commitMutation(sessionId, projectId, "Apply agent patch");
    } catch (error) {
      spawnSync("git", ["reset", "--hard", "HEAD"], { cwd: repo, stdio: "ignore" });
      spawnSync("git", ["clean", "-fd"], { cwd: repo, stdio: "ignore" });
      throw error;
    }
    await this.activity(sessionId, projectId, actor, "apply_patch", "Applied a targeted patch");
    return { ok: true, status: "needs_verification", suggested_tools: ["get_diff", "run_workcell"] };
  }

  async inspectPolicy(sessionId, projectId) {
    const meta = await this.requireProject(sessionId, projectId);
    const repo = this.repoRoot(sessionId, projectId);
    const definition = JSON.parse(await fsp.readFile(path.join(repo, "workcell.json"), "utf8"));
    const validation = spawnSync(this.workcellBin, ["validate", "--file", "workcell.json"], { cwd: repo, encoding: "utf8", maxBuffer: LIMITS.logBytes });
    const guard = spawnSync(this.kujoBin, ["run", path.join(this.root, "src/domain/policy_guard.kujo"), "--", "workcell.json"], { cwd: repo, encoding: "utf8", maxBuffer: LIMITS.logBytes });
    let guardResult = null; try { guardResult = JSON.parse(guard.stdout.trim()); } catch {}
    return { ok: validation.status === 0 && guard.status === 0, project_id: meta.id, policy: PUBLIC_POLICY, definition_valid: validation.status === 0, public_profile_valid: guard.status === 0, policy_guard: guardResult, validation_summary: bounded(validation.stdout || validation.stderr, 300) };
  }

  async startRun(sessionId, projectId) {
    const meta = await this.requireProject(sessionId, projectId);
    if (this.active.size >= LIMITS.maxConcurrentRuns) throw new StudioError("capacity", "Studio is at its concurrent run limit. Retry shortly.", 429, ["get_run_status"]);
    const repo = this.repoRoot(sessionId, projectId);
    await this.projectUsage(repo);
    const policy = await this.inspectPolicy(sessionId, projectId);
    if (!policy.ok) throw new StudioError("policy_rejected", "Project Workcell definition does not satisfy the fixed public profile.", 422, ["inspect_policy"]);
    if (run("git", ["status", "--porcelain"], { cwd: repo })) throw new StudioError("workspace_dirty", "Studio could not seal the workspace before execution.", 409);
    const runId = id("r");
    const output = this.runRoot(sessionId, projectId, runId);
    await fsp.mkdir(output, { recursive: true, mode: 0o700 });
    const state = { id: runId, project_id: projectId, status: "preparing", started_at: now(), completed_at: null, exit_category: null, workload_exit_code: null, duration_ms: null, summary: "Workcell is preparing a disposable workspace." };
    await writeJson(path.join(output, "studio-run.json"), state);
    meta.latest_run_id = runId; meta.status = "executing"; meta.updated_at = now();
    await writeJson(this.projectMeta(sessionId, projectId), meta);
    await this.activity(sessionId, projectId, "human_or_agent", "run_workcell", "Workcell run started", runId);
    const started = Date.now();
    const child = spawn(this.workcellBin, ["run", "--file", path.join(repo, "workcell.json"), "--repo", repo, "--output", output, "--no-pull"], { cwd: repo, env: { ...process.env, KUJO: this.kujoBin, TMPDIR: this.workcellTmp }, stdio: ["ignore", "pipe", "pipe"] });
    this.active.set(runId, { child, sessionId, projectId });
    let stdout = ""; let stderr = "";
    child.stdout.on("data", (chunk) => { stdout = bounded(stdout + chunk.toString(), LIMITS.logBytes); });
    child.stderr.on("data", (chunk) => { stderr = bounded(stderr + chunk.toString(), LIMITS.logBytes); });
    child.on("close", async (code, signal) => {
      this.active.delete(runId);
      const entries = await fsp.readdir(output, { withFileTypes: true });
      const evidenceEntry = entries.find((entry) => entry.isDirectory() && entry.name.startsWith("wc-"));
      if (evidenceEntry) state.workcell_run_dir = evidenceEntry.name;
      const evidenceRoot = evidenceEntry ? path.join(output, evidenceEntry.name) : output;
      const receipt = await readJson(path.join(evidenceRoot, "receipt.json"), {});
      state.status = signal ? "cancelled" : code === 0 ? "completed" : "failed";
      state.completed_at = now(); state.duration_ms = Date.now() - started;
      state.exit_category = signal ? "cancelled" : this.exitCategory(code);
      state.workload_exit_code = receipt?.exit_code ?? null;
      state.summary = signal ? "Run cancelled; Workcell cleanup was requested." : code === 0 ? "Execution succeeded; evidence collected." : `Workcell ended with ${state.exit_category}.`;
      state.stdout = bounded(stdout, 1200); state.stderr = bounded(stderr, 1200);
      await writeJson(path.join(output, "studio-run.json"), state);
      const current = await this.requireProject(sessionId, projectId);
      current.status = code === 0 ? "needs_verification" : "failed"; current.updated_at = now();
      await writeJson(this.projectMeta(sessionId, projectId), current);
      await this.activity(sessionId, projectId, "workcell", "run_complete", state.summary, runId);
      this.emit({ type: "run", project_id: projectId, run_id: runId, session_id: sessionId });
    });
    this.emit({ type: "run", project_id: projectId, run_id: runId, session_id: sessionId });
    return { ok: true, run_id: runId, status: "preparing", summary: state.summary, next_actions: ["get_run_status"] };
  }

  exitCategory(code) { return ({ 0: "completed", 2: "definition_failure", 3: "workspace_failure", 4: "backend_failure", 5: "startup_failure", 6: "timeout", 7: "workload_failure", 8: "verification_failure", 9: "cleanup_failure", 10: "internal_failure" })[code] || "unknown_failure"; }

  async getRun(sessionId, projectId, runId, details = false) {
    await this.requireProject(sessionId, projectId); this.validateId(runId, "r");
    const root = this.runRoot(sessionId, projectId, runId);
    const state = await readJson(path.join(root, "studio-run.json"));
    if (!state) throw new StudioError("run_not_found", "Run is not available in this project.", 404);
    if (!details) return { ok: true, run_id: runId, status: state.status, exit_category: state.exit_category, summary: state.summary, duration_ms: state.duration_ms, next_actions: state.completed_at ? ["run_eval", "inspect_run"] : ["get_run_status"] };
    const evidenceRoot = state.workcell_run_dir ? path.join(root, state.workcell_run_dir) : root;
    const receipt = await readJson(path.join(evidenceRoot, "receipt.json"), null);
    const changes = await readJson(path.join(evidenceRoot, "changes.json"), null);
    return { ok: true, run: { ...state, stdout: bounded(state.stdout || "", 600), stderr: bounded(state.stderr || "", 600) }, evidence: { receipt: receipt ? { schema: receipt.schema || receipt.contract || "workcell-receipt/v1", status: receipt.status || null, cleanup: receipt.cleanup || null, verification: receipt.verification || null } : null, changes }, content_is_untrusted: true };
  }

  async cancelRun(sessionId, projectId, runId) {
    await this.getRun(sessionId, projectId, runId);
    const active = this.active.get(runId);
    if (!active || active.sessionId !== sessionId || active.projectId !== projectId) return { ok: true, run_id: runId, status: "not_running" };
    active.child.kill("SIGTERM");
    return { ok: true, run_id: runId, status: "cancelling" };
  }

  async runEval(sessionId, projectId, runId) {
    const runState = await this.getRun(sessionId, projectId, runId);
    if (!runState.exit_category) throw new StudioError("run_in_progress", "Wait for Workcell to complete before evaluation.", 409, ["get_run_status"]);
    const evalId = id("e");
    const runRoot = this.runRoot(sessionId, projectId, runId);
    const state = await readJson(path.join(runRoot, "studio-run.json"), {});
    const evidenceRoot = state.workcell_run_dir ? path.join(runRoot, state.workcell_run_dir) : runRoot;
    const output = path.join(runRoot, "eval", evalId);
    await fsp.mkdir(output, { recursive: true, mode: 0o700 });
    const meta = await this.requireProject(sessionId, projectId);
    let tests = [];
    if (meta.template === "invoice-scanner") tests = [
      { name: "report artifact exists", check: "file_exists", params: { path: path.join(evidenceRoot, "artifacts", "report.json") } },
      { name: "duplicate count is two", check: "json_value_equals", params: { path: path.join(evidenceRoot, "artifacts", "report.json"), json_path: "duplicate_count", expected: 2 } },
      { name: "duplicate evidence names invoice", check: "file_contains", params: { path: path.join(evidenceRoot, "artifacts", "report.json"), expected: "INV-104" } }
    ];
    if (meta.template === "log-summarizer") tests = [
      { name: "summary artifact exists", check: "file_exists", params: { path: path.join(evidenceRoot, "artifacts", "summary.json") } },
      { name: "one error counted", check: "json_value_equals", params: { path: path.join(evidenceRoot, "artifacts", "summary.json"), json_path: "errors", expected: 1 } }
    ];
    if (meta.template === "static-status-page") tests = [
      { name: "status page exists", check: "file_exists", params: { path: path.join(evidenceRoot, "artifacts", "dist/index.html") } },
      { name: "status page has operational state", check: "file_contains", params: { path: path.join(evidenceRoot, "artifacts", "dist/index.html"), expected: "operational" } }
    ];
    const suite = { name: "workcell-studio-artifact-eval", description: `Deterministically verifies artifacts exported by the ${meta.template} Workcell.`, version: "1.0.0", output_dir: output, artifact_checksums: true, tests };
    const suitePath = path.join(output, "suite.json");
    await writeJson(suitePath, suite);
    const result = spawnSync(this.kujoBin, ["run", this.evalMain, "run", suitePath, "--output-dir", output, "--artifact-checksums", "--json"], { cwd: this.root, encoding: "utf8", maxBuffer: LIMITS.logBytes * 4, timeout: 30000 });
    const summary = await readJson(path.join(output, "summary.json"), {});
    const normalized = { id: evalId, project_id: projectId, run_id: runId, status: result.status === 0 ? "passed" : "failed", passed: summary.passed ?? summary.passed_tests ?? 0, failed: summary.failed ?? summary.failed_tests ?? (result.status === 0 ? 0 : 1), skipped: summary.skipped ?? 0, duration_ms: summary.duration_ms ?? null, summary: result.status === 0 ? "Deterministic Eval checks passed." : "One or more deterministic Eval checks failed.", report_reference: path.relative(this.projectRoot(sessionId, projectId), path.join(output, "summary.json")), manifest_reference: path.relative(this.projectRoot(sessionId, projectId), path.join(output, "artifact-manifest.json")) };
    await writeJson(path.join(output, "studio-eval.json"), normalized);
    meta.latest_eval_id = evalId; meta.status = normalized.status === "passed" ? "verified" : "failed"; meta.updated_at = now(); await writeJson(this.projectMeta(sessionId, projectId), meta);
    await this.activity(sessionId, projectId, "eval", "run_eval", normalized.summary, runId); this.emit({ type: "eval", project_id: projectId, run_id: runId, session_id: sessionId });
    return { ok: result.status === 0, eval_id: evalId, run_id: runId, status: normalized.status, passed: normalized.passed, failed: normalized.failed, summary: normalized.summary, next_actions: result.status === 0 ? ["verify_run"] : ["get_eval_report", "read_file", "apply_patch"] };
  }

  async getEval(sessionId, projectId, runId, evalId) {
    await this.requireProject(sessionId, projectId); this.validateId(runId, "r"); this.validateId(evalId, "e");
    const output = path.join(this.runRoot(sessionId, projectId, runId), "eval", evalId);
    const report = await readJson(path.join(output, "studio-eval.json"));
    if (!report) throw new StudioError("eval_not_found", "Eval report is not available in this run.", 404);
    const failures = await readJson(path.join(output, "last_failures.json"), []);
    const safeFailures = sanitizeEvidence(Array.isArray(failures) ? failures.slice(0, 8) : failures, [[this.projectRoot(sessionId, projectId), "[project]"], [this.dataRoot, "[studio-data]"]]);
    return { ok: true, report, failures: safeFailures, content_is_untrusted: true };
  }

  async verifyRun(sessionId, projectId, runId, evalId = null) {
    const state = await this.getRun(sessionId, projectId, runId);
    const runRoot = this.runRoot(sessionId, projectId, runId);
    const stored = await readJson(path.join(runRoot, "studio-run.json"), {});
    const root = stored.workcell_run_dir ? path.join(runRoot, stored.workcell_run_dir) : runRoot;
    const result = spawnSync(this.workcellBin, ["verify", "--run", root, "--json"], { encoding: "utf8", maxBuffer: LIMITS.logBytes, timeout: 15000, env: { ...process.env, KUJO: this.kujoBin, TMPDIR: this.workcellTmp } });
    let details = null; try { details = JSON.parse(result.stdout); } catch {}
    let evalVerified = null;
    if (evalId) {
      this.validateId(evalId, "e");
      const evalOutput = path.join(runRoot, "eval", evalId);
      const evalResult = spawnSync(this.kujoBin, ["run", this.evalMain, "verify-manifest", "--output-dir", evalOutput, "--json"], { encoding: "utf8", timeout: 15000, maxBuffer: LIMITS.logBytes });
      evalVerified = evalResult.status === 0;
    }
    const safeDetails = sanitizeEvidence(details, [[this.projectRoot(sessionId, projectId), "[project]"], [this.dataRoot, "[studio-data]"]]);
    return { ok: result.status === 0 && evalVerified !== false, run_id: runId, execution_succeeded: state.exit_category === "completed", evidence_verified: result.status === 0, eval_manifest_verified: evalVerified, summary: result.status === 0 ? "Workcell evidence manifest is intact." : bounded(result.stderr || result.stdout, 400), verification: safeDetails };
  }

  async getDiff(sessionId, projectId) {
    const meta = await this.requireProject(sessionId, projectId); const repo = this.repoRoot(sessionId, projectId);
    const diff = run("git", ["diff", "--no-ext-diff", "--unified=3", meta.initial_commit, "HEAD", "--", ".", ":(exclude)workcell.json"], { cwd: repo });
    const names = run("git", ["diff", "--name-only", meta.initial_commit, "HEAD"], { cwd: repo }).split("\n").filter(Boolean);
    return { ok: true, changed_files: names.slice(0, 32), diff: bounded(diff, 1200), truncated: diff.length > 1200, content_is_untrusted: true };
  }

  async resetProject(sessionId, projectId, confirmed = false) {
    if (confirmed !== true) throw new StudioError("confirmation_required", "Reset confirmation is required because this permanently discards project changes; retry with confirm=true.", 409);
    const meta = await this.requireProject(sessionId, projectId); const repo = this.repoRoot(sessionId, projectId);
    run("git", ["reset", "--hard", meta.initial_commit], { cwd: repo });
    run("git", ["clean", "-fd"], { cwd: repo });
    meta.status = "needs_verification"; meta.latest_run_id = null; meta.latest_eval_id = null; meta.updated_at = now(); await writeJson(this.projectMeta(sessionId, projectId), meta);
    await this.activity(sessionId, projectId, "human_or_agent", "reset_project", "Reset project to its verified template"); this.emit({ type: "workspace", project_id: projectId, session_id: sessionId });
    return { ok: true, project_id: projectId, status: meta.status };
  }

  async exportProject(sessionId, projectId) {
    const meta = await this.requireProject(sessionId, projectId); const repo = this.repoRoot(sessionId, projectId);
    const exportDir = path.join(this.projectRoot(sessionId, projectId), "exports"); await fsp.mkdir(exportDir, { recursive: true, mode: 0o700 });
    const name = `${projectId}.tar.gz`; const target = path.join(exportDir, name);
    run("git", ["archive", "--format=tar.gz", "-o", target, "HEAD"], { cwd: repo });
    await this.activity(sessionId, projectId, "human_or_agent", "export_project", "Exported sealed project source");
    return { ok: true, project_id: meta.id, download_url: `/api/projects/${projectId}/exports/${name}` };
  }

  async state(sessionId, projectId = null) {
    if (!projectId) {
      const projectsRoot = path.join(this.sessionRoot(sessionId), "projects");
      const ids = (await exists(projectsRoot)) ? await fsp.readdir(projectsRoot) : [];
      if (!ids.length) return { ok: true, project: null, templates: await this.listTemplates(), status: "empty" };
      projectId = ids.sort().at(-1);
    }
    const project = await this.requireProject(sessionId, projectId); const files = await this.listFiles(sessionId, projectId); const activity = await readJson(path.join(this.projectRoot(sessionId, projectId), "activity.json"), []);
    let latestRun = null; let latestEval = null;
    if (project.latest_run_id) latestRun = await this.getRun(sessionId, projectId, project.latest_run_id).catch(() => null);
    if (project.latest_run_id && project.latest_eval_id) latestEval = await this.getEval(sessionId, projectId, project.latest_run_id, project.latest_eval_id).then((x) => x.report).catch(() => null);
    return { ok: true, project: { id: project.id, name: project.name, objective: project.objective, status: project.status, template: project.template, updated_at: project.updated_at }, workspace: { files: files.count, dirty: project.status === "needs_verification" }, policy: { network: "none", profile: "contained-standard" }, latest_run: latestRun, latest_eval: latestEval, activity: activity.slice(-12).reverse() };
  }

  async cleanupExpired() {
    const sessions = path.join(this.dataRoot, "sessions"); if (!(await exists(sessions))) return;
    const cutoff = Date.now() - LIMITS.sessionTtlMs;
    for (const entry of await fsp.readdir(sessions, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue; const full = path.join(sessions, entry.name); const stat = await fsp.stat(full);
      if (stat.mtimeMs < cutoff) await fsp.rm(full, { recursive: true, force: true });
    }
  }
}

export { bounded };
