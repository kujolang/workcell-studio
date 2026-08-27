import { toolDefinitions } from "/webmcp/register-tools.js";

const state = { projectId: null, runId: null, evalId: null, activeFile: null, data: null };
window.kujoStudio = state;
const $ = (id) => document.getElementById(id);
const request = async (url, options = {}) => { const response = await fetch(url, { ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } }); const data = await response.json(); if (response.status === 401) { window.location.replace("/"); throw new Error("Judge access expired."); } if (!response.ok) throw new Error(data.summary || data.error); return data; };
const show = (id, visible = true) => $(id).classList.toggle("hidden", !visible);
const inspect = (title, value) => { $("active-file").textContent = title; $("inspector").textContent = JSON.stringify(value, null, 2); show("inspector"); show("editor", false); show("empty-state", false); };
const claim = (id, label, kind = "") => { const node = $(id); node.querySelector("b").textContent = label; node.className = `claim ${kind}`; };

async function refresh() {
  const query = state.projectId ? `?project_id=${state.projectId}` : ""; const data = await request(`/api/state${query}`); state.data = data;
  if (!data.project) { state.projectId = null; show("empty-state"); show("editor", false); show("inspector", false); return; }
  state.projectId = data.project.id; state.runId = data.latest_run?.run_id || data.latest_run?.id || state.runId; state.evalId = data.latest_eval?.id || state.evalId;
  $("project-name").textContent = data.project.name; $("objective").textContent = data.project.objective; $("project-status").textContent = data.project.status.toUpperCase().replaceAll("_", " "); show("empty-state", false);
  const files = await request(`/api/projects/${state.projectId}/files`); $("file-list").innerHTML = files.files.map((file) => `<button data-path="${escapeHtml(file.path)}">${escapeHtml(file.path)} <small>${file.bytes}b</small></button>`).join("");
  for (const button of $("file-list").querySelectorAll("button")) button.addEventListener("click", () => openFile(button.dataset.path));
  $("activity-list").innerHTML = data.activity.length ? data.activity.map((item) => `<div class="activity-item"><small>${new Date(item.timestamp).toLocaleTimeString()} · ${escapeHtml(item.actor_type)}</small><b>${escapeHtml(item.summary)}</b><small>${escapeHtml(item.action)}</small></div>`).join("") : '<p class="muted">No activity yet.</p>';
  const run = data.latest_run;
  if (run) { state.runId = run.run_id; $("run-summary").textContent = run.summary; document.querySelectorAll("#lifecycle li").forEach((li) => li.classList.toggle("active", stageReached(run.status, li.dataset.stage))); claim("execution-claim", run.exit_category === "completed" ? "SUCCEEDED" : run.exit_category ? (run.status === "cancelled" ? "CANCELLED" : "FAILED") : run.status.toUpperCase(), run.exit_category === "completed" ? "pass" : run.exit_category ? "fail" : ""); $("cancel-run").disabled = Boolean(run.exit_category); }
  if (data.latest_eval) { state.evalId = data.latest_eval.id; claim("eval-claim", data.latest_eval.status.toUpperCase(), data.latest_eval.status === "passed" ? "pass" : data.latest_eval.status === "running" ? "" : "fail"); $("cancel-eval").disabled = data.latest_eval.status !== "running"; }
}

function stageReached(status, stage) { const order = ["preparing", "running", "completed"]; const mapped = status === "failed" || status === "cancelled" ? "completed" : status; return order.indexOf(stage) <= order.indexOf(mapped); }
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]); }

async function openFile(file) { const data = await request(`/api/projects/${state.projectId}/file?path=${encodeURIComponent(file)}`); state.activeFile = file; $("active-file").textContent = file; $("file-content").value = data.content; $("line-numbers").textContent = Array.from({ length: data.content.split("\n").length }, (_, i) => i + 1).join("\n"); show("editor"); show("inspector", false); show("empty-state", false); }

$("create-form").addEventListener("submit", async (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const data = await request("/api/projects", { method: "POST", body: JSON.stringify(Object.fromEntries(form)) }); state.projectId = data.project.id; await refresh(); });
$("save-button").addEventListener("click", async () => { if (!state.activeFile) return; await request(`/api/projects/${state.projectId}/file`, { method: "PUT", body: JSON.stringify({ path: state.activeFile, content: $("file-content").value, actor: "human" }) }); await refresh(); });
$("file-content").addEventListener("input", () => { $("line-numbers").textContent = Array.from({ length: $("file-content").value.split("\n").length }, (_, i) => i + 1).join("\n"); });
$("inspect-policy").addEventListener("click", async () => inspect("EXECUTION POLICY", await request(`/api/projects/${state.projectId}/policy`)));
$("diff-button").addEventListener("click", async () => inspect("PROJECT DIFF", await request(`/api/projects/${state.projectId}/diff`)));
$("export-button").addEventListener("click", async () => { if (!state.projectId) return; const data = await request(`/api/projects/${state.projectId}/exports`, { method: "POST", body: "{}" }); window.location.assign(data.download_url); });
$("reset-button").addEventListener("click", async () => { if (!state.projectId || !window.confirm("Discard every project source change and return to the starter template?")) return; await request(`/api/projects/${state.projectId}/reset`, { method: "POST", body: JSON.stringify({ confirm: true }) }); state.runId = null; state.evalId = null; state.activeFile = null; await refresh(); });
$("run-button").addEventListener("click", async () => { const data = await request(`/api/projects/${state.projectId}/runs`, { method: "POST", body: "{}" }); state.runId = data.run_id; await refresh(); });
$("cancel-run").addEventListener("click", async () => { if (!state.runId) return; await request(`/api/projects/${state.projectId}/runs/${state.runId}/cancel`, { method: "POST", body: "{}" }); await refresh(); });
$("inspect-run").addEventListener("click", async () => { if (state.runId) inspect("WORKCELL EVIDENCE", await request(`/api/projects/${state.projectId}/runs/${state.runId}?details=1`)); });
$("eval-button").addEventListener("click", async () => { if (!state.runId) return; const data = await request(`/api/projects/${state.projectId}/runs/${state.runId}/evals`, { method: "POST", body: "{}" }); state.evalId = data.eval_id; inspect("KUJO EVAL REPORT", data); await refresh(); });
$("cancel-eval").addEventListener("click", async () => { if (!state.evalId || !state.runId) return; await request(`/api/projects/${state.projectId}/runs/${state.runId}/evals/${state.evalId}/cancel`, { method: "POST", body: "{}" }); await refresh(); });
$("eval-report").addEventListener("click", async () => { if (state.evalId && state.runId) inspect("KUJO EVAL REPORT", await request(`/api/projects/${state.projectId}/runs/${state.runId}/evals/${state.evalId}`)); });
$("verify-button").addEventListener("click", async () => { if (!state.runId) return; const data = await request(`/api/projects/${state.projectId}/runs/${state.runId}/verify`, { method: "POST", body: JSON.stringify({ eval_id: state.evalId }) }); claim("evidence-claim", data.ok ? "VERIFIED" : "INVALID", data.ok ? "pass" : "fail"); inspect("INTEGRITY VERIFICATION", data); });
$("logout-button").addEventListener("click", async () => { await request("/api/auth/logout", { method: "POST", body: "{}" }); window.location.replace("/"); });

window.addEventListener("studio:webmcp", (event) => { $("webmcp-badge").textContent = `WebMCP · ${event.detail.registered} tools`; $("webmcp-badge").className = "badge ok"; });
if (!document.modelContext) { $("webmcp-badge").textContent = `WebMCP progressive · ${toolDefinitions.length} tools`; }
window.addEventListener("studio:changed", refresh);
new EventSource("/api/events").addEventListener("studio", refresh);
setInterval(() => { if ((state.runId && state.data?.latest_run && !state.data.latest_run.exit_category) || state.data?.latest_eval?.status === "running") refresh(); }, 1000);
refresh().catch((error) => inspect("STUDIO ERROR", { error: error.message }));
