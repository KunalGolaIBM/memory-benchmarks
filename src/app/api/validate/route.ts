/**
 * POST /api/validate
 *
 * Pre-flight checks before starting a comparison run.
 * Returns a structured list of check results — the frontend shows each one.
 *
 * Body: {
 *   db2: { host, port, database, username, password },
 *   llm:  { base_url, answerer_model },
 *   qdrant?: { host, port },
 *   mem0_db2_port?: number,
 *   mem0_qdrant_port?: number,
 *   checks?: string[]   // subset: "db2"|"qdrant"|"llm"|"benchmark" (default: all)
 * }
 */

import { NextRequest, NextResponse } from "next/server";
import { execSync, execFileSync } from "child_process";
import path from "path";
import fs from "fs";
import net from "net";

export const dynamic = "force-dynamic";

const REPO_ROOT = process.cwd();

interface CheckResult {
  id: string;
  label: string;
  status: "ok" | "fail" | "skip" | "warn";
  detail?: string;
  suggestion?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function tcpReachable(host: string, port: number, timeoutMs = 4000): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    sock.setTimeout(timeoutMs);
    sock.once("connect", () => { sock.destroy(); resolve(true); });
    sock.once("timeout", () => { sock.destroy(); resolve(false); });
    sock.once("error", () => resolve(false));
    sock.connect(port, host);
  });
}

async function httpGet(url: string, timeoutMs = 5000): Promise<{ ok: boolean; body?: string; status?: number }> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    const body = await res.text().catch(() => "");
    return { ok: res.ok, body, status: res.status };
  } catch {
    return { ok: false };
  }
}

function pythonPath(): string {
  for (const p of [
    "/usr/bin/python3.11", "/usr/local/bin/python3.11",
    "/home/gola/.local/bin/python3.11",
    "/usr/bin/python3", "/usr/local/bin/python3",
    "/opt/homebrew/bin/python3.11", "/opt/homebrew/bin/python3",
    "python3.11", "python3",
  ]) {
    try {
      execFileSync(p, ["--version"], { stdio: "ignore" });
      return p;
    } catch { /* skip */ }
  }
  return "python3";
}

// ── Check functions ───────────────────────────────────────────────────────────

function checkPython(): CheckResult {
  const py = pythonPath();
  try {
    const ver = execFileSync(py, ["--version"], { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    return { id: "python", label: "Python available", status: "ok", detail: `${py} → ${ver}` };
  } catch {
    return {
      id: "python", label: "Python available", status: "fail",
      detail: "No python3 found on PATH or known locations",
      suggestion: "Install Python 3.11: sudo apt install python3.11",
    };
  }
}

function checkDeps(): CheckResult {
  const py = pythonPath();
  const required = ["mem0", "fastapi", "uvicorn", "aiohttp"];
  const missing: string[] = [];
  for (const pkg of required) {
    try {
      execFileSync(py, ["-c", `import ${pkg.replace("-", "_").replace(".", "_")}`], { stdio: "ignore" });
    } catch {
      missing.push(pkg);
    }
  }
  if (missing.length === 0) {
    return { id: "deps", label: "Python dependencies", status: "ok", detail: `Required packages present` };
  }
  return {
    id: "deps", label: "Python dependencies", status: "fail",
    detail: `Missing: ${missing.join(", ")}`,
    suggestion: `pip install ${missing.join(" ")}`,
  };
}

function checkBenchmarkFiles(): CheckResult {
  const required = [
    "benchmarks/locomo/run.py",
    "benchmarks/common/mem0_client.py",
    "docker/mem0/main.py",
  ];
  const missing = required.filter((f) => !fs.existsSync(path.join(REPO_ROOT, f)));
  if (missing.length === 0) {
    return { id: "bench_files", label: "Benchmark files", status: "ok" };
  }
  return {
    id: "bench_files", label: "Benchmark files", status: "fail",
    detail: `Missing: ${missing.join(", ")}`,
    suggestion: "Ensure the memory-benchmarks repo is complete",
  };
}

async function checkDb2(
  host: string, port: number, database: string, username: string, password: string,
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  // TCP reachability
  const reachable = await tcpReachable(host, port);
  if (!reachable) {
    results.push({
      id: "db2_tcp", label: `Db2 TCP ${host}:${port}`, status: "fail",
      detail: `Cannot reach ${host}:${port}`,
      suggestion: "Check that the Db2 instance is running and the port is open",
    });
    return results;
  }
  results.push({ id: "db2_tcp", label: `Db2 TCP ${host}:${port}`, status: "ok" });

  // Authentication + connection
  const py = pythonPath();
  const connStr = `DATABASE=${database};HOSTNAME=${host};PORT=${port};PROTOCOL=TCPIP;UID=${username};PWD=${password};Authentication=SERVER;`;
  try {
    execFileSync(py, [
      "-c",
      `import ibm_db_dbi; c=ibm_db_dbi.connect(${JSON.stringify(connStr)},'',''); c.close(); print('ok')`,
    ], { stdio: ["ignore", "pipe", "pipe"], timeout: 15000, env: { ...process.env } });
    results.push({ id: "db2_auth", label: "Db2 authentication", status: "ok", detail: `Connected to ${database} as ${username}` });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const authFail = msg.toLowerCase().includes("auth") || msg.toLowerCase().includes("password");
    results.push({
      id: "db2_auth", label: "Db2 authentication", status: "fail",
      detail: authFail ? `Authentication failed for user ${username}` : msg.slice(0, 200),
      suggestion: authFail
        ? "Verify the password and retry"
        : "Check Db2 driver installation: pip install ibm_db",
    });
  }

  return results;
}

async function checkQdrant(host: string, port: number): Promise<CheckResult[]> {
  const reachable = await tcpReachable(host, port);
  if (!reachable) {
    return [{
      id: "qdrant_tcp", label: `Qdrant TCP ${host}:${port}`, status: "fail",
      detail: `Cannot reach ${host}:${port}`,
      suggestion: "Start Qdrant: docker run -d --name qdrant -p 6333:6333 qdrant/qdrant",
    }];
  }
  const health = await httpGet(`http://${host}:${port}/healthz`);
  if (!health.ok) {
    const health2 = await httpGet(`http://${host}:${port}/health`);
    if (!health2.ok) {
      return [{
        id: "qdrant_health", label: "Qdrant health", status: "warn",
        detail: "TCP reachable but /healthz returned non-200",
        suggestion: "Qdrant may still be starting up — retry in a few seconds",
      }];
    }
  }
  return [{ id: "qdrant_tcp", label: `Qdrant ${host}:${port}`, status: "ok" }];
}

async function checkOllama(baseUrl: string, models: string[]): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const ollamaBase = baseUrl.replace(/\/v1\/?$/, "");

  const health = await httpGet(`${ollamaBase}/api/tags`, 6000);
  if (!health.ok) {
    results.push({
      id: "ollama_health", label: "Ollama service", status: "fail",
      detail: `Cannot reach ${ollamaBase}/api/tags`,
      suggestion: "Start Ollama: OLLAMA_HOST=0.0.0.0 ollama serve",
    });
    return results;
  }
  results.push({ id: "ollama_health", label: "Ollama service", status: "ok" });

  // Check models
  let available: string[] = [];
  try {
    const data = JSON.parse(health.body ?? "{}");
    available = (data.models ?? []).map((m: { name: string }) => m.name);
  } catch { /* ignore */ }

  for (const m of models) {
    const found = available.some((a) => a === m || a.startsWith(m + ":") || a.startsWith(m + "-"));
    results.push({
      id: `ollama_model_${m.replace(/[^a-z0-9]/g, "_")}`,
      label: `Ollama model: ${m}`,
      status: found ? "ok" : "fail",
      detail: found ? "Available" : `Not found in local Ollama models`,
      suggestion: found ? undefined : `ollama pull ${m}`,
    });
  }

  return results;
}

async function checkMem0(port: number, label: string): Promise<CheckResult> {
  const url = `http://localhost:${port}/health`;
  const resp = await httpGet(url, 4000);
  if (resp.ok) {
    let detail = `Listening on :${port}`;
    try { detail = JSON.stringify(JSON.parse(resp.body ?? "{}")).slice(0, 120); } catch { /* */ }
    return { id: `mem0_${label}`, label: `mem0 server (${label})`, status: "ok", detail };
  }
  return {
    id: `mem0_${label}`, label: `mem0 server (${label})`, status: "warn",
    detail: `Not responding at :${port} — it will be started when the run begins`,
    suggestion: `Ensure the mem0 server is started before the benchmark, or use the platform start script`,
  };
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const db2 = body.db2 as { host: string; port: number; database: string; username: string; password: string } | undefined;
  const llm = body.llm as { base_url: string; answerer_model: string } | undefined;
  const qdrant = body.qdrant as { host: string; port: number } | undefined;
  const checksRequested = (body.checks as string[] | undefined) ?? ["infra", "db2", "qdrant", "llm", "benchmark"];
  const mem0Db2Port = (body.mem0_db2_port as number) ?? 8888;
  const mem0QdrantPort = (body.mem0_qdrant_port as number) ?? 8889;

  const all: CheckResult[] = [];

  // ── Infrastructure ─────────────────────────────────────────────────────────
  if (checksRequested.includes("infra")) {
    all.push(checkPython());
    all.push(checkDeps());
    all.push(checkBenchmarkFiles());
  }

  // ── Db2 ────────────────────────────────────────────────────────────────────
  if (checksRequested.includes("db2") && db2) {
    const db2Results = await checkDb2(db2.host, db2.port, db2.database, db2.username, db2.password);
    all.push(...db2Results);
  }

  // ── Qdrant ─────────────────────────────────────────────────────────────────
  if (checksRequested.includes("qdrant")) {
    const qhost = qdrant?.host ?? "localhost";
    const qport = qdrant?.port ?? 6333;
    const qResults = await checkQdrant(qhost, qport);
    all.push(...qResults);
  }

  // ── LLM (Ollama) ───────────────────────────────────────────────────────────
  if (checksRequested.includes("llm") && llm) {
    const models = ["llama3.2", "nomic-embed-text"];
    const llmResults = await checkOllama(llm.base_url || "http://localhost:11434", models);
    all.push(...llmResults);
  }

  // ── mem0 servers ───────────────────────────────────────────────────────────
  if (checksRequested.includes("mem0")) {
    all.push(await checkMem0(mem0Db2Port, "db2"));
    all.push(await checkMem0(mem0QdrantPort, "qdrant"));
  }

  // ── Benchmark files ────────────────────────────────────────────────────────
  if (checksRequested.includes("benchmark")) {
    const outDir = path.join(REPO_ROOT, "results", "locomo");
    fs.mkdirSync(outDir, { recursive: true });
    const writable = (() => {
      try { fs.accessSync(outDir, fs.constants.W_OK); return true; }
      catch { return false; }
    })();
    all.push({
      id: "output_dir", label: "Output directory writable",
      status: writable ? "ok" : "fail",
      detail: outDir,
      suggestion: writable ? undefined : `chmod -R u+w ${outDir}`,
    });
  }

  const failed = all.filter((c) => c.status === "fail");
  const passed = all.filter((c) => c.status === "ok").length;

  return NextResponse.json({
    ok: failed.length === 0,
    checks: all,
    summary: { total: all.length, passed, failed: failed.length, warnings: all.filter((c) => c.status === "warn").length },
  });
}
