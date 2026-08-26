export const LIMITS = Object.freeze({
  bodyBytes: 96 * 1024,
  fileBytes: 64 * 1024,
  projectBytes: 512 * 1024,
  projectFiles: 64,
  patchBytes: 64 * 1024,
  logBytes: 64 * 1024,
  toolOutputChars: 1500,
  sessionTtlMs: 2 * 60 * 60 * 1000,
  maxConcurrentRuns: 2,
  maxProjectsPerSession: 5,
  maxSseConnections: 32,
});

export const PUBLIC_POLICY = Object.freeze({
  profile: "contained-standard",
  engine: "Kujo Workcell 1.0",
  network: "none",
  cpus: 1,
  memory: "256m",
  pids: 64,
  timeout_ms: 30000,
  max_output_bytes: 65536,
  root_fs: "read-only",
  workspace: "disposable Git worktree",
  artifacts: "declared only",
  secrets: "none",
  cleanup: "automatic",
});
