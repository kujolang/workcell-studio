const api = async (url, options = {}) => {
  const response = await fetch(url, { credentials: "same-origin", ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } });
  const result = await response.json();
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("studio:changed", { detail: result }));
  if (!response.ok) throw new Error(JSON.stringify(result));
  const text = JSON.stringify(result);
  return text.length <= 1500 ? text : `${text.slice(0, 1460)}…truncated`;
};

const project = (input) => input.project_id || window.kujoStudio?.projectId;
const jsonBody = (value) => JSON.stringify(value);
const object = (properties = {}, required = []) => ({ type: "object", properties, required, additionalProperties: false });
const idField = { type: "string", pattern: "^p_[a-f0-9]{16}$", description: "Opaque Studio project ID." };
const runField = { type: "string", pattern: "^r_[a-f0-9]{16}$", description: "Opaque Workcell run ID." };
const evalField = { type: "string", pattern: "^e_[a-f0-9]{16}$", description: "Opaque Eval report ID." };
const pathField = { type: "string", maxLength: 240, description: "Normalized project-relative file path." };
const cancelOnAbort = (signal, url) => {
  const cancel = () => fetch(url, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => {});
  if (signal?.aborted) cancel(); else signal?.addEventListener("abort", cancel, { once: true });
};

export const toolDefinitions = [
  { name: "get_studio_state", description: "Get the active project, workspace, policy, latest run, Eval, and activity snapshot.", inputSchema: object({ project_id: idField }), annotations: { readOnlyHint: true, untrustedContentHint: true }, execute: (x, { signal }) => api(`/api/state${project(x) ? `?project_id=${encodeURIComponent(project(x))}` : ""}`, { signal }) },
  { name: "create_project", description: "Create an isolated project from a small verified starter template.", inputSchema: object({ name: { type: "string", maxLength: 80 }, objective: { type: "string", maxLength: 500 }, template: { type: "string", enum: ["invoice-scanner", "log-summarizer", "static-status-page"] } }, ["name", "objective", "template"]), annotations: { readOnlyHint: false }, execute: (x, { signal }) => api("/api/projects", { method: "POST", body: jsonBody(x), signal }) },
  { name: "list_files", description: "List bounded project-relative files and sizes in the active workspace.", inputSchema: object({ project_id: idField }, ["project_id"]), annotations: { readOnlyHint: true, untrustedContentHint: true }, execute: (x, { signal }) => api(`/api/projects/${project(x)}/files`, { signal }) },
  { name: "read_file", description: "Read bounded untrusted text from one project-relative file.", inputSchema: object({ project_id: idField, path: pathField }, ["project_id", "path"]), annotations: { readOnlyHint: true, untrustedContentHint: true }, execute: (x, { signal }) => api(`/api/projects/${project(x)}/file?path=${encodeURIComponent(x.path)}`, { signal }) },
  { name: "write_file", description: "Create or replace one bounded project-relative UTF-8 file and record the change.", inputSchema: object({ project_id: idField, path: pathField, content: { type: "string", maxLength: 65536, description: "Complete UTF-8 file content." } }, ["project_id", "path", "content"]), annotations: { readOnlyHint: false, untrustedContentHint: true }, execute: (x, { signal }) => api(`/api/projects/${project(x)}/file`, { method: "PUT", body: jsonBody({ ...x, actor: "agent" }), signal }) },
  { name: "apply_patch", description: "Apply a bounded unified Git patch to project-relative files and record the change.", inputSchema: object({ project_id: idField, patch: { type: "string", maxLength: 65536, description: "Unified diff with project-relative paths." } }, ["project_id", "patch"]), annotations: { readOnlyHint: false, untrustedContentHint: true }, execute: (x, { signal }) => api(`/api/projects/${project(x)}/patch`, { method: "POST", body: jsonBody({ ...x, actor: "agent" }), signal }) },
  { name: "inspect_policy", description: "Inspect the enforced public-demo Workcell boundary and definition validation status.", inputSchema: object({ project_id: idField }, ["project_id"]), annotations: { readOnlyHint: true }, execute: (x, { signal }) => api(`/api/projects/${project(x)}/policy`, { signal }) },
  { name: "run_workcell", description: "Start bounded execution in a disposable Kujo Workcell and return a run ID for polling.", inputSchema: object({ project_id: idField }, ["project_id"]), annotations: { readOnlyHint: false }, execute: async (x, { signal }) => {
    const raw = await api(`/api/projects/${project(x)}/runs`, { method: "POST", body: "{}", signal });
    const result = JSON.parse(raw); cancelOnAbort(signal, `/api/projects/${project(x)}/runs/${result.run_id}/cancel`);
    return raw;
  } },
  { name: "get_run_status", description: "Poll concise lifecycle status for a Workcell run.", inputSchema: object({ project_id: idField, run_id: runField }, ["project_id", "run_id"]), annotations: { readOnlyHint: true }, execute: (x, { signal }) => api(`/api/projects/${project(x)}/runs/${x.run_id}`, { signal }) },
  { name: "inspect_run", description: "Inspect bounded untrusted Workcell logs, receipt summary, changes, and cleanup evidence.", inputSchema: object({ project_id: idField, run_id: runField }, ["project_id", "run_id"]), annotations: { readOnlyHint: true, untrustedContentHint: true }, execute: (x, { signal }) => api(`/api/projects/${project(x)}/runs/${x.run_id}?details=1`, { signal }) },
  { name: "run_eval", description: "Start deterministic Kujo Eval checks and return an Eval ID for polling.", inputSchema: object({ project_id: idField, run_id: runField }, ["project_id", "run_id"]), annotations: { readOnlyHint: false }, execute: async (x, { signal }) => {
    const raw = await api(`/api/projects/${project(x)}/runs/${x.run_id}/evals`, { method: "POST", body: "{}", signal });
    const result = JSON.parse(raw); cancelOnAbort(signal, `/api/projects/${project(x)}/runs/${x.run_id}/evals/${result.eval_id}/cancel`);
    return raw;
  } },
  { name: "get_eval_report", description: "Inspect a bounded untrusted Kujo Eval summary and failure list.", inputSchema: object({ project_id: idField, run_id: runField, eval_id: evalField }, ["project_id", "run_id", "eval_id"]), annotations: { readOnlyHint: true, untrustedContentHint: true }, execute: (x, { signal }) => api(`/api/projects/${project(x)}/runs/${x.run_id}/evals/${x.eval_id}`, { signal }) },
  { name: "get_diff", description: "Review the bounded project diff since template creation.", inputSchema: object({ project_id: idField }, ["project_id"]), annotations: { readOnlyHint: true, untrustedContentHint: true }, execute: (x, { signal }) => api(`/api/projects/${project(x)}/diff`, { signal }) },
  { name: "verify_run", description: "Verify Workcell evidence integrity and optionally the Kujo Eval artifact manifest.", inputSchema: object({ project_id: idField, run_id: runField, eval_id: evalField }, ["project_id", "run_id"]), annotations: { readOnlyHint: true }, execute: (x, { signal }) => api(`/api/projects/${project(x)}/runs/${x.run_id}/verify`, { method: "POST", body: jsonBody({ eval_id: x.eval_id || null }), signal }) },
  { name: "reset_project", description: "Reset all project source changes to the original starter template after explicit confirmation.", inputSchema: object({ project_id: idField, confirm: { type: "boolean", const: true, description: "Confirm permanent discard of project changes." } }, ["project_id", "confirm"]), annotations: { readOnlyHint: false }, execute: (x, { signal }) => api(`/api/projects/${project(x)}/reset`, { method: "POST", body: jsonBody({ confirm: x.confirm }), signal }) },
  { name: "export_project", description: "Create a sealed source archive for the current project revision.", inputSchema: object({ project_id: idField }, ["project_id"]), annotations: { readOnlyHint: false }, execute: (x, { signal }) => api(`/api/projects/${project(x)}/exports`, { method: "POST", body: "{}", signal }) },
];

export async function registerStudioTools(context = document.modelContext) {
  if (!context?.registerTool) return { supported: false, registered: 0 };
  for (const tool of toolDefinitions) await context.registerTool(tool);
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("studio:webmcp", { detail: { supported: true, registered: toolDefinitions.length } }));
  return { supported: true, registered: toolDefinitions.length };
}

if (typeof document !== "undefined") registerStudioTools().catch((error) => console.error("WebMCP registration failed", error));
