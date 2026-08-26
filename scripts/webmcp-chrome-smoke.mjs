const endpoint = process.argv[2] || await fetch("http://127.0.0.1:9333/json/list")
  .then((response) => response.json())
  .then((pages) => pages.find((page) => page.url.startsWith("http://127.0.0.1:4173"))?.webSocketDebuggerUrl);
if (!endpoint) throw new Error("No Studio page is available on the Chrome DevTools endpoint at 127.0.0.1:9333");
const socket = new WebSocket(endpoint);
let sequence = 0;
const commandWaiters = new Map();
const invocationWaiters = new Map();
const earlyInvocations = new Map();
let tools;

const command = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence;
  commandWaiters.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params }));
});

const waitInvocation = (invocationId, toolName) => new Promise((resolve, reject) => {
  const early = earlyInvocations.get(invocationId);
  if (early) {
    earlyInvocations.delete(invocationId);
    return early.status === "Completed" ? resolve(early.output) : reject(new Error(`${toolName}: ${early.errorText || early.exception?.description || early.status}`));
  }
  invocationWaiters.set(invocationId, { resolve, reject, toolName });
});

socket.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.id && commandWaiters.has(message.id)) {
    const waiter = commandWaiters.get(message.id);
    commandWaiters.delete(message.id);
    return message.error ? waiter.reject(new Error(message.error.message)) : waiter.resolve(message.result);
  }
  if (message.method === "WebMCP.toolsAdded") tools = message.params.tools;
  if (message.method === "WebMCP.toolResponded") {
    const result = message.params;
    const waiter = invocationWaiters.get(result.invocationId);
    if (!waiter) return earlyInvocations.set(result.invocationId, result);
    invocationWaiters.delete(result.invocationId);
    return result.status === "Completed" ? waiter.resolve(result.output) : waiter.reject(new Error(`${waiter.toolName}: ${result.errorText || result.exception?.description || result.status}`));
  }
};

await new Promise((resolve, reject) => {
  socket.onopen = resolve;
  socket.onerror = reject;
});
await command("WebMCP.enable");
for (let attempt = 0; attempt < 50 && !tools; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 20));
if (!tools?.length) throw new Error("WebMCP tools were not discovered");
const frameId = tools[0].frameId;

const invoke = async (toolName, input) => {
  const started = await command("WebMCP.invokeTool", { frameId, toolName, input });
  const output = await waitInvocation(started.invocationId, toolName);
  return typeof output === "string" ? JSON.parse(output) : output;
};

const pollRun = async (projectId, runId) => {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const state = await invoke("get_run_status", { project_id: projectId, run_id: runId });
    if (state.exit_category) return state;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Workcell polling timed out");
};

const pollEval = async (projectId, runId, evalId) => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const state = await invoke("get_eval_report", { project_id: projectId, run_id: runId, eval_id: evalId });
    if (state.report.status !== "running") return state;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Eval polling timed out");
};

const created = await invoke("create_project", { name: "Chrome WebMCP Smoke", objective: "Exercise the real WebMCP failure and repair loop.", template: "invoice-scanner" });
const projectId = created.project.id;
const files = await invoke("list_files", { project_id: projectId });
await invoke("read_file", { project_id: projectId, path: "main.kujo" });
const policy = await invoke("inspect_policy", { project_id: projectId });

const firstStart = await invoke("run_workcell", { project_id: projectId });
const firstRun = await pollRun(projectId, firstStart.run_id);
const firstEvalStart = await invoke("run_eval", { project_id: projectId, run_id: firstStart.run_id });
const firstEval = await pollEval(projectId, firstStart.run_id, firstEvalStart.eval_id);
if (firstEval.report.status !== "failed") throw new Error("Canonical first Eval did not fail");

const patch = 'diff --git a/main.kujo b/main.kujo\n--- a/main.kujo\n+++ b/main.kujo\n@@ -35,7 +35,7 @@\n mut duplicates := []\n for invoice in invoices {\n     # Include invoice rows whose identifiers occur more than once.\n-    if counts[invoice["invoice_id"]] > 1 {\n+    if invoice["invoice_id"] != "" && counts[invoice["invoice_id"]] > 1 {\n         duplicates = push(duplicates, invoice)\n     }\n }\n';
await invoke("apply_patch", { project_id: projectId, patch });
const secondStart = await invoke("run_workcell", { project_id: projectId });
const secondRun = await pollRun(projectId, secondStart.run_id);
const secondEvalStart = await invoke("run_eval", { project_id: projectId, run_id: secondStart.run_id });
const secondEval = await pollEval(projectId, secondStart.run_id, secondEvalStart.eval_id);
const verified = await invoke("verify_run", { project_id: projectId, run_id: secondStart.run_id, eval_id: secondEvalStart.eval_id });

console.log(JSON.stringify({
  tools: tools.length,
  files: files.count,
  policy: policy.ok,
  first_execution: firstRun.exit_category,
  first_eval: firstEval.report.status,
  second_execution: secondRun.exit_category,
  second_eval: secondEval.report.status,
  evidence_verified: verified.evidence_verified,
  eval_manifest_verified: verified.eval_manifest_verified
}, null, 2));
socket.close();
