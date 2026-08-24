#!/usr/bin/env node
/**
 * Import a terminal-produced benchmark result JSON into evals.db
 * so it appears in the dashboard UI.
 *
 * Usage:
 *   node scripts/import-result.mjs <path-to-result.json>
 *
 * Example:
 *   node scripts/import-result.mjs results/locomo/locomo_results_20260824_151427.json
 */

import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

// --- Args ---
const resultFilePath = process.argv[2];
if (!resultFilePath) {
  console.error("Usage: node scripts/import-result.mjs <path-to-result.json>");
  process.exit(1);
}

const absResultFile = path.isAbsolute(resultFilePath)
  ? resultFilePath
  : path.join(REPO_ROOT, resultFilePath);

if (!fs.existsSync(absResultFile)) {
  console.error(`File not found: ${absResultFile}`);
  process.exit(1);
}

// --- Load result JSON ---
const raw = JSON.parse(fs.readFileSync(absResultFile, "utf-8"));
const meta = raw.metadata ?? {};

// Detect template_id from benchmark name
const benchmarkName = (meta.benchmark ?? "").toLowerCase();
let template_id = "locomo";
if (benchmarkName.includes("longmemeval")) template_id = "longmemeval";
else if (benchmarkName.includes("beam")) template_id = "beam";

const project_name = meta.project_name ?? path.basename(absResultFile, ".json");

// Parse timestamp "20260824_151427" -> ISO string
function parseTimestamp(ts) {
  if (!ts) return new Date().toISOString();
  const m = String(ts).match(/^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})$/);
  if (!m) return new Date().toISOString();
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.000Z`;
}

const finished_at = parseTimestamp(meta.timestamp);
// Estimate started_at as finished_at (we don't have exact start time)
const started_at = finished_at;

// --- Open DB and ensure tables exist ---
const DB_PATH = path.join(REPO_ROOT, "evals.db");
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// Seed templates so the foreign key is satisfied
db.exec(`
  CREATE TABLE IF NOT EXISTS eval_templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    eval_type TEXT NOT NULL,
    script_path TEXT NOT NULL,
    description TEXT,
    default_config TEXT DEFAULT '{}',
    default_eval_config TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS eval_runs (
    id TEXT PRIMARY KEY,
    template_id TEXT NOT NULL REFERENCES eval_templates(id),
    project_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    config TEXT DEFAULT '{}',
    env_overrides TEXT DEFAULT '{}',
    pid INTEGER,
    log_file TEXT,
    result_file TEXT,
    started_at TEXT,
    finished_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_runs_status ON eval_runs(status);
  CREATE INDEX IF NOT EXISTS idx_runs_template ON eval_runs(template_id);
`);

const TEMPLATES = [
  { id: "locomo", name: "LOCOMO-10", eval_type: "benchmark", script_path: "benchmarks/locomo/run.py", description: "LOCOMO-10 benchmark", default_config: "{}", default_eval_config: "{}" },
  { id: "longmemeval", name: "LongMemEval", eval_type: "benchmark", script_path: "benchmarks/longmemeval/run.py", description: "LongMemEval benchmark", default_config: "{}", default_eval_config: "{}" },
  { id: "beam", name: "BEAM", eval_type: "benchmark", script_path: "benchmarks/beam/run.py", description: "BEAM benchmark", default_config: "{}", default_eval_config: "{}" },
];
const upsert = db.prepare(`INSERT OR IGNORE INTO eval_templates (id, name, eval_type, script_path, description, default_config, default_eval_config) VALUES (@id, @name, @eval_type, @script_path, @description, @default_config, @default_eval_config)`);
for (const t of TEMPLATES) upsert.run(t);

// --- Insert the run ---
const id = crypto.randomUUID();
const config = JSON.stringify({
  answerer_model: meta.answerer_model,
  judge_model: meta.judge_model,
  provider: meta.provider,
  top_k: meta.top_k,
  top_k_cutoffs: meta.top_k_cutoffs,
});

db.prepare(`
  INSERT INTO eval_runs (id, template_id, project_name, status, config, env_overrides, result_file, started_at, finished_at)
  VALUES (?, ?, ?, 'succeeded', ?, '{}', ?, ?, ?)
`).run(id, template_id, project_name, config, absResultFile, started_at, finished_at);

console.log(`✓ Imported run`);
console.log(`  Run ID       : ${id}`);
console.log(`  Project name : ${project_name}`);
console.log(`  Template     : ${template_id}`);
console.log(`  Result file  : ${absResultFile}`);
console.log(`\nOpen the dashboard and it will appear at:`);
console.log(`  http://localhost:3000/runs/${id}`);
