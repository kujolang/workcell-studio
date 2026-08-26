import crypto from "node:crypto";
import fsp from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LIMITS } from "./limits.js";
import { Studio, StudioError } from "./studio.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const studio = new Studio({
  root,
  dataRoot: path.resolve(process.env.STUDIO_DATA_ROOT || path.join(root, "../.workcell-host-tmp/workcell-studio-data")),
  workcellBin: path.resolve(process.env.WORKCELL_BIN || path.join(root, "../workcell/bin/workcell")),
  kujoBin: process.env.KUJO_BIN || "kujo",
  evalMain: path.resolve(process.env.EVAL_MAIN || path.join(root, "../eval/main.kujo")),
});
await studio.init();

const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml" };
const securityHeaders = { "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer", "Permissions-Policy": "camera=(), microphone=(), geolocation=(), tools=(self)", "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'", "Origin-Agent-Cluster": "?1", "Cross-Origin-Opener-Policy": "same-origin" };
const requestRates = new Map();
let sseConnections = 0;

function rateLimit(req, route) {
  const address = req.socket.remoteAddress || "unknown";
  const windowMs = route === "create" ? 60 * 60 * 1000 : 60 * 1000;
  const limit = route === "create" ? 10 : 240;
  const key = `${address}:${route}`; const current = requestRates.get(key); const time = Date.now();
  if (!current || current.reset <= time) { requestRates.set(key, { count: 1, reset: time + windowMs }); return; }
  current.count += 1;
  if (current.count > limit) throw new StudioError("rate_limited", "Request capacity exceeded. Retry after the current window.", 429);
}

function session(req, res) {
  const match = /(?:^|;\s*)kujo_studio_session=([a-f0-9]{32})/.exec(req.headers.cookie || "");
  const value = match?.[1] || crypto.randomBytes(16).toString("hex");
  if (!match) res.setHeader("Set-Cookie", `kujo_studio_session=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=7200${process.env.NODE_ENV === "production" ? "; Secure" : ""}`);
  return value;
}

async function body(req) {
  let bytes = 0; const chunks = [];
  for await (const chunk of req) { bytes += chunk.length; if (bytes > LIMITS.bodyBytes) throw new StudioError("body_too_large", "Request body is too large.", 413); chunks.push(chunk); }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new StudioError("invalid_json", "Request body must be valid JSON.", 400); }
}

function send(res, status, payload, extra = {}) {
  const data = Buffer.from(JSON.stringify(payload)); res.writeHead(status, { ...securityHeaders, "Content-Type": "application/json; charset=utf-8", "Content-Length": data.length, "Cache-Control": "no-store", ...extra }); res.end(data);
}

function fail(res, error) {
  const known = error instanceof StudioError; send(res, known ? error.status : 500, { ok: false, error: known ? error.code : "internal_error", summary: known ? error.message : "Studio could not complete the operation.", suggested_tools: known ? error.suggestedTools : [] });
  if (!known) console.error(error);
}

async function serveFile(res, target, download = false) {
  const data = await fsp.readFile(target); res.writeHead(200, { ...securityHeaders, "Content-Type": download ? "application/gzip" : mime[path.extname(target)] || "application/octet-stream", "Content-Length": data.length, "Cache-Control": download ? "no-store" : "public, max-age=60", ...(download ? { "Content-Disposition": `attachment; filename="${path.basename(target)}"` } : {}) }); res.end(data);
}

const server = http.createServer(async (req, res) => {
  const sid = session(req, res); const url = new URL(req.url, "http://studio.local"); const parts = url.pathname.split("/").filter(Boolean);
  try {
    rateLimit(req, url.pathname === "/api/projects" && req.method === "POST" ? "create" : "request");
    if (url.pathname === "/api/health") return send(res, 200, { ok: true, service: "kujo-workcell-studio" });
    if (url.pathname === "/api/ready") { const readiness = studio.readiness(); return send(res, readiness.ok ? 200 : 503, readiness); }
    if (url.pathname === "/api/events" && req.method === "GET") {
      if (sseConnections >= LIMITS.maxSseConnections) throw new StudioError("capacity", "Live update capacity is full.", 429);
      sseConnections += 1;
      res.writeHead(200, { ...securityHeaders, "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" }); res.write("event: ready\ndata: {}\n\n");
      const off = studio.subscribe(sid, (event) => res.write(`event: studio\ndata: ${JSON.stringify(event)}\n\n`)); req.on("close", () => { sseConnections -= 1; off(); }); return;
    }
    if (url.pathname === "/api/state" && req.method === "GET") return send(res, 200, await studio.state(sid, url.searchParams.get("project_id")));
    if (url.pathname === "/api/projects" && req.method === "POST") return send(res, 201, await studio.createProject(sid, await body(req)));
    if (parts[0] === "api" && parts[1] === "projects" && parts[2]) {
      const pid = parts[2];
      if (parts[3] === "files" && req.method === "GET" && !parts[4]) return send(res, 200, await studio.listFiles(sid, pid));
      if (parts[3] === "file") {
        if (req.method === "GET") return send(res, 200, await studio.readFile(sid, pid, url.searchParams.get("path")));
        if (req.method === "PUT") { const input = await body(req); return send(res, 200, await studio.writeFile(sid, pid, input.path, input.content, input.actor || "agent")); }
      }
      if (parts[3] === "patch" && req.method === "POST") { const input = await body(req); return send(res, 200, await studio.applyPatch(sid, pid, input.patch, input.actor || "agent")); }
      if (parts[3] === "policy" && req.method === "GET") return send(res, 200, await studio.inspectPolicy(sid, pid));
      if (parts[3] === "diff" && req.method === "GET") return send(res, 200, await studio.getDiff(sid, pid));
      if (parts[3] === "reset" && req.method === "POST") { const input = await body(req); return send(res, 200, await studio.resetProject(sid, pid, input.confirm)); }
      if (parts[3] === "runs" && req.method === "POST" && !parts[4]) return send(res, 202, await studio.startRun(sid, pid));
      if (parts[3] === "runs" && parts[4]) {
        const rid = parts[4];
        if (req.method === "GET" && !parts[5]) return send(res, 200, await studio.getRun(sid, pid, rid, url.searchParams.get("details") === "1"));
        if (parts[5] === "cancel" && req.method === "POST") return send(res, 202, await studio.cancelRun(sid, pid, rid));
        if (parts[5] === "evals" && req.method === "POST" && !parts[6]) return send(res, 200, await studio.runEval(sid, pid, rid));
        if (parts[5] === "evals" && parts[6] && req.method === "GET") return send(res, 200, await studio.getEval(sid, pid, rid, parts[6]));
        if (parts[5] === "verify" && req.method === "POST") { const input = await body(req); return send(res, 200, await studio.verifyRun(sid, pid, rid, input.eval_id || null)); }
      }
      if (parts[3] === "exports" && req.method === "POST") return send(res, 200, await studio.exportProject(sid, pid));
      if (parts[3] === "exports" && parts[4] && req.method === "GET") { const expected = `${pid}.tar.gz`; if (parts[4] !== expected) throw new StudioError("export_not_found", "Export is unavailable.", 404); return serveFile(res, path.join(studio.projectRoot(sid, pid), "exports", expected), true); }
    }
    if (req.method !== "GET") throw new StudioError("route_not_found", "Studio capability does not exist.", 404);
    const relative = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\//, "");
    const base = relative.startsWith("webmcp/") ? root : path.join(root, "frontend"); const target = path.resolve(base, relative);
    if (target !== base && !target.startsWith(`${base}${path.sep}`)) throw new StudioError("route_not_found", "Not found.", 404);
    return await serveFile(res, target);
  } catch (error) { if (url.pathname.startsWith("/api/")) fail(res, error); else { res.writeHead(error?.code === "ENOENT" ? 404 : 500, securityHeaders); res.end("Not found"); } }
});

const port = Number(process.env.PORT || 4173); const host = process.env.HOST || "127.0.0.1";
server.listen(port, host, () => console.log(`Kujo Workcell Studio listening on http://${host}:${port}`));

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { for (const active of studio.active.values()) active.child.kill("SIGTERM"); server.close(() => process.exit(0)); });
