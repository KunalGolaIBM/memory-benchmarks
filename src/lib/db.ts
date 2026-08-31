import Database from "better-sqlite3";
import path from "path";

const DB_PATH = path.join(process.cwd(), "evals.db");

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!_db) {
    _db = new Database(DB_PATH);
    _db.pragma("journal_mode = WAL");
    _db.pragma("foreign_keys = ON");
    migrate(_db);
  }
  return _db;
}

function migrate(db: Database.Database) {
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

    -- Comparison runs: groups three eval_runs (A=db2, B=qdrant, C=nomem) together
    CREATE TABLE IF NOT EXISTS comparison_runs (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      benchmark TEXT NOT NULL DEFAULT 'locomo',
      mode TEXT NOT NULL DEFAULT 'smoke',
      conversations TEXT NOT NULL DEFAULT '0',
      max_questions INTEGER,
      -- sub-run IDs (null until launched)
      run_a_id TEXT REFERENCES eval_runs(id),
      run_b_id TEXT REFERENCES eval_runs(id),
      run_c_id TEXT REFERENCES eval_runs(id),
      -- overall status: pending | running | completed | failed | stopped
      status TEXT NOT NULL DEFAULT 'pending',
      -- Db2 connection (password deliberately excluded)
      db2_host TEXT,
      db2_port INTEGER,
      db2_database TEXT,
      db2_username TEXT,
      -- LLM config snapshot
      llm_config TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now')),
      started_at TEXT,
      finished_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_cmp_status ON comparison_runs(status);
  `);
}
