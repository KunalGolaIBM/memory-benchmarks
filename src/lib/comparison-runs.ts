/**
 * Comparison Runs
 * ===============
 * A "comparison run" groups three eval_run rows together:
 *   Run A — mem0 + Db2    + llama3.2  (primary IBM Db2 scenario)
 *   Run B — mem0 + Qdrant + llama3.2  (Qdrant baseline for DB comparison)
 *   Run C — no memory     + llama3.2  (bare-LLM baseline for memory comparison)
 *
 * All three share identical LLM config, benchmark, conversations, and
 * evaluation parameters — the only intentional differences are the
 * memory backend.
 *
 * Passwords are NEVER stored — the caller must pass DB2_PASSWORD as an
 * env override at launch time (it goes into the process environment, not the DB).
 */

import crypto from "crypto";
import path from "path";
import { getDb } from "./db";
import { createRun } from "./runs";
import { getTemplate } from "./templates";
import { startRun } from "./executor";

const REPO_ROOT = process.cwd();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ComparisonRun {
  id: string;
  label: string;
  benchmark: string;
  mode: string;
  conversations: string;
  max_questions: number | null;
  run_a_id: string | null;
  run_b_id: string | null;
  run_c_id: string | null;
  status: "pending" | "running" | "completed" | "failed" | "stopped";
  db2_host: string | null;
  db2_port: number | null;
  db2_database: string | null;
  db2_username: string | null;
  llm_config: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface LlmConfig {
  answerer_model: string;
  judge_model: string;
  provider: string;
  base_url: string;
  api_key: string;
  judge_base_url?: string;
  judge_api_key?: string;
  top_k: number;
  top_k_cutoffs: string;
}

export interface Db2Config {
  host: string;
  port: number;
  database: string;
  username: string;
  /** Never stored. Passed only as process env at runtime. */
  password: string;
}

export interface QdrantConfig {
  host: string;
  port: number;
}

export interface LaunchParams {
  label: string;
  benchmark: "locomo";
  mode: "smoke" | "single" | "full";
  conversations: string;
  max_questions?: number;
  llm: LlmConfig;
  db2: Db2Config;
  qdrant?: QdrantConfig;
  mem0_db2_port?: number;
  mem0_qdrant_port?: number;
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export function createComparisonRun(
  params: Omit<LaunchParams, "db2"> & { db2_without_password: Omit<Db2Config, "password"> },
): ComparisonRun {
  const db = getDb();
  const id = crypto.randomUUID();
  const { label, benchmark, mode, conversations, max_questions, llm, db2_without_password } = params;

  db.prepare(`
    INSERT INTO comparison_runs
      (id, label, benchmark, mode, conversations, max_questions,
       db2_host, db2_port, db2_database, db2_username, llm_config)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, label, benchmark, mode, conversations, max_questions ?? null,
    db2_without_password.host,
    db2_without_password.port,
    db2_without_password.database,
    db2_without_password.username,
    JSON.stringify(llm),
  );

  return getComparisonRun(id)!;
}

export function getComparisonRun(id: string): ComparisonRun | undefined {
  return getDb()
    .prepare("SELECT * FROM comparison_runs WHERE id = ?")
    .get(id) as ComparisonRun | undefined;
}

export function listComparisonRuns(): ComparisonRun[] {
  return getDb()
    .prepare("SELECT * FROM comparison_runs ORDER BY created_at DESC")
    .all() as ComparisonRun[];
}

export function updateComparisonRun(
  id: string,
  updates: Partial<
    Pick<ComparisonRun, "run_a_id" | "run_b_id" | "run_c_id" | "status" | "started_at" | "finished_at">
  >,
) {
  const db = getDb();
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [key, value] of Object.entries(updates)) {
    sets.push(`${key} = ?`);
    params.push(value);
  }
  if (sets.length === 0) return;
  params.push(id);
  db.prepare(`UPDATE comparison_runs SET ${sets.join(", ")} WHERE id = ?`).run(...params);
}

export function deleteComparisonRun(id: string) {
  getDb().prepare("DELETE FROM comparison_runs WHERE id = ?").run(id);
}

// ---------------------------------------------------------------------------
// Launch
// ---------------------------------------------------------------------------

/**
 * Create and immediately start all three sub-runs for a comparison.
 *
 * Sub-runs are launched sequentially (A → B → C) to avoid overwhelming
 * a single Ollama instance. Each run uses --resume so a restart picks
 * up where it left off.
 *
 * The DB2_PASSWORD is passed as a process environment variable — it is
 * NEVER written to the database or any log file.
 */
export async function launchComparison(
  params: LaunchParams,
): Promise<ComparisonRun> {
  const template = getTemplate("locomo");
  if (!template) throw new Error("locomo template not found");

  const {
    label, benchmark, mode, conversations, max_questions,
    llm, db2, qdrant,
    mem0_db2_port = 8888,
    mem0_qdrant_port = 8889,
  } = params;

  // 1. Create the comparison record (no password stored)
  const cmp = createComparisonRun({
    label, benchmark, mode, conversations, max_questions,
    llm,
    db2_without_password: {
      host: db2.host,
      port: db2.port,
      database: db2.database,
      username: db2.username,
    },
  });

  updateComparisonRun(cmp.id, {
    status: "running",
    started_at: new Date().toISOString(),
  });

  const outputDir = `results/${benchmark}`;
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 16);

  // Common config for all three runs
  const commonConfig: Record<string, unknown> = {
    provider: llm.provider,
    base_url: llm.base_url,
    api_key: llm.api_key,
    answerer_model: llm.answerer_model,
    judge_model: llm.judge_model,
    judge_provider: llm.provider,
    judge_base_url: llm.judge_base_url ?? llm.base_url,
    judge_api_key: llm.judge_api_key ?? llm.api_key,
    top_k: llm.top_k,
    top_k_cutoffs: llm.top_k_cutoffs,
    conversations,
    output_dir: outputDir,
    resume: true,
    debug: true,
    max_workers: 2,
    ...(max_questions ? { max_questions } : {}),
  };

  // Env override carries password — never written to DB
  const db2Env: Record<string, string> = {
    MEM0_DB2_PASSWORD: db2.password,
  };

  // ── Run A: mem0 + Db2 ──────────────────────────────────────────────────────
  const runA = createRun({
    template_id: "locomo",
    project_name: `${cmp.id.slice(0, 8)}-A-db2-${ts}`,
    config: {
      ...commonConfig,
      backend: "oss",
      mem0_host: `http://localhost:${mem0_db2_port}`,
    },
    env_overrides: db2Env,
  });
  updateComparisonRun(cmp.id, { run_a_id: runA.id });
  startRun(runA.id, template, runA.project_name, {
    config: JSON.parse(runA.config),
    env_overrides: JSON.parse(runA.env_overrides),
  });

  // ── Run B: mem0 + Qdrant ───────────────────────────────────────────────────
  const qdrantHost = qdrant?.host ?? "localhost";
  const qdrantPort = qdrant?.port ?? 6333;
  const runB = createRun({
    template_id: "locomo",
    project_name: `${cmp.id.slice(0, 8)}-B-qdrant-${ts}`,
    config: {
      ...commonConfig,
      backend: "oss",
      mem0_host: `http://localhost:${mem0_qdrant_port}`,
    },
    env_overrides: {
      QDRANT_HOST: qdrantHost,
      QDRANT_PORT: String(qdrantPort),
    },
  });
  updateComparisonRun(cmp.id, { run_b_id: runB.id });
  startRun(runB.id, template, runB.project_name, {
    config: JSON.parse(runB.config),
    env_overrides: JSON.parse(runB.env_overrides),
  });

  // ── Run C: no memory ──────────────────────────────────────────────────────
  const runC = createRun({
    template_id: "locomo",
    project_name: `${cmp.id.slice(0, 8)}-C-nomem-${ts}`,
    config: {
      ...commonConfig,
      no_memory: true,
    },
    env_overrides: {},
  });
  updateComparisonRun(cmp.id, { run_c_id: runC.id });
  startRun(runC.id, template, runC.project_name, {
    config: JSON.parse(runC.config),
    env_overrides: JSON.parse(runC.env_overrides),
  });

  return getComparisonRun(cmp.id)!;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Derive overall comparison status from sub-run statuses.
 * Called by the API to keep comparison_runs.status in sync.
 */
export function syncComparisonStatus(cmpId: string): void {
  const db = getDb();
  const cmp = getComparisonRun(cmpId);
  if (!cmp) return;

  const runIds = [cmp.run_a_id, cmp.run_b_id, cmp.run_c_id].filter(Boolean) as string[];
  if (runIds.length === 0) return;

  const placeholders = runIds.map(() => "?").join(",");
  const runs = db
    .prepare(`SELECT status FROM eval_runs WHERE id IN (${placeholders})`)
    .all(...runIds) as { status: string }[];

  const statuses = new Set(runs.map((r) => r.status));
  let overall: ComparisonRun["status"];

  if (statuses.has("running") || statuses.has("pending")) {
    overall = "running";
  } else if ([...statuses].every((s) => s === "succeeded")) {
    overall = "completed";
  } else if (statuses.has("failed")) {
    overall = "failed";
  } else if (statuses.has("stopped")) {
    overall = "stopped";
  } else {
    overall = "running";
  }

  const updates: Parameters<typeof updateComparisonRun>[1] = { status: overall };
  if (overall === "completed" || overall === "failed" || overall === "stopped") {
    if (!cmp.finished_at) {
      updates.finished_at = new Date().toISOString();
    }
  }
  updateComparisonRun(cmpId, updates);
}

/**
 * Build a mem0 YAML config string for Db2.
 * The password placeholder is substituted at runtime by the mem0 server
 * reading the MEM0_DB2_PASSWORD environment variable.
 */
export function buildDb2Mem0Config(params: {
  host: string;
  port: number;
  database: string;
  username: string;
  ollama_host?: string;
}): string {
  const ollama = params.ollama_host ?? "http://localhost:11434";
  return `version: "v1.1"
llm:
  provider: ollama
  config:
    model: llama3.2
    ollama_base_url: ${ollama}
    temperature: 0.1
    max_tokens: 2000
embedder:
  provider: ollama
  config:
    model: nomic-embed-text
    ollama_base_url: ${ollama}
    embedding_dims: 768
vector_store:
  provider: db2
  config:
    connection_params:
      database: ${params.database}
      host: ${params.host}
      port: ${params.port}
      username: ${params.username}
      password: \${MEM0_DB2_PASSWORD}
    collection_name: mem0_memories
    embedding_model_dims: 768
    distance_strategy: COSINE
`;
}

export function buildQdrantMem0Config(params: {
  qdrant_host?: string;
  qdrant_port?: number;
  ollama_host?: string;
}): string {
  const ollama = params.ollama_host ?? "http://localhost:11434";
  const qhost = params.qdrant_host ?? "localhost";
  const qport = params.qdrant_port ?? 6333;
  return `version: "v1.1"
llm:
  provider: ollama
  config:
    model: llama3.2
    ollama_base_url: ${ollama}
    temperature: 0.1
    max_tokens: 2000
embedder:
  provider: ollama
  config:
    model: nomic-embed-text
    ollama_base_url: ${ollama}
    embedding_dims: 768
vector_store:
  provider: qdrant
  config:
    host: ${qhost}
    port: ${qport}
    collection_name: mem0_memories_qdrant
    embedding_model_dims: 768
`;
}

// Re-export for convenience
export { REPO_ROOT };
