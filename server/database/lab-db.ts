import { openDb } from "./sqlite.js";

/** Database of the AI testing workspace: runs, execution events, results and findings. */
export const labDb = openDb("workspace.db");

labDb.exec(`
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  story_id TEXT NOT NULL,
  status TEXT NOT NULL,              -- queued | running | completed | failed | cancelled
  phase TEXT,                        -- planning | executing | verifying | reporting | done
  current_scenario TEXT,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  environment_id TEXT NOT NULL,
  options_json TEXT NOT NULL,
  sut_json TEXT NOT NULL,            -- snapshot of config/sut.json at run start (evaluator only)
  plan_json TEXT,
  usage_json TEXT,
  summary_json TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  duration_ms INTEGER
);
CREATE TABLE IF NOT EXISTS run_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  ts TEXT NOT NULL,
  scenario_key TEXT,
  kind TEXT NOT NULL,                -- system | plan | reasoning | action | observation | network | console | screenshot | result | finding | proposal | error
  title TEXT NOT NULL,
  detail_json TEXT,
  screenshot TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_run ON run_events(run_id, id);
CREATE TABLE IF NOT EXISTS scenario_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  scenario_key TEXT NOT NULL,
  kind TEXT NOT NULL,                -- happy_path | regression | exploratory
  title TEXT NOT NULL,
  status TEXT NOT NULL,              -- Passed | Failed | Blocked | Inconclusive
  agent_status TEXT,                 -- status the agent claimed before verification
  summary TEXT,
  expectations_json TEXT,
  verification_notes TEXT,
  steps_used INTEGER,
  started_at TEXT,
  finished_at TEXT
);
CREATE TABLE IF NOT EXISTS findings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  scenario_key TEXT NOT NULL,
  title TEXT NOT NULL,
  severity TEXT NOT NULL,
  expected TEXT,
  actual TEXT,
  steps_json TEXT,
  evidence_json TEXT,
  agent_reproduced INTEGER,
  classification TEXT NOT NULL,      -- verified_defect | suspected | rejected
  verifier_rationale TEXT,
  eval_bug_id TEXT,                  -- evaluator mapping to hidden bug list
  eval_label TEXT,                   -- auto_match | true_positive | false_positive | duplicate | null
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS model_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  ts TEXT NOT NULL,
  scenario_key TEXT,
  role TEXT NOT NULL,                -- planner | executor | explorer | verifier
  tier TEXT NOT NULL,                -- economy | advanced
  model_requested TEXT NOT NULL,
  model_served TEXT,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cache_read_tokens INTEGER NOT NULL,
  cache_write_tokens INTEGER NOT NULL,
  cost_usd REAL,                     -- null when the model has no configured price
  latency_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_calls_run ON model_calls(run_id, scenario_key);
`);

/** Additive migrations for databases created by earlier versions. */
function ensureColumn(table: string, column: string, type: string) {
  const cols = labDb.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) labDb.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}
ensureColumn("runs", "mode", "TEXT NOT NULL DEFAULT 'regression'");
ensureColumn("runs", "metadata_json", "TEXT"); // models, browser version, commit, environment
ensureColumn("runs", "cost_json", "TEXT"); // cost breakdown (model / browser / tools)
ensureColumn("runs", "trigger", "TEXT"); // manual | ci:pull_request | ci:schedule | benchmark …
ensureColumn("scenario_results", "cost_usd", "REAL");
ensureColumn("scenario_results", "model", "TEXT");
ensureColumn("scenario_results", "browser_ms", "INTEGER");
ensureColumn("scenario_results", "actions", "INTEGER");
ensureColumn("scenario_results", "attempts", "INTEGER");
ensureColumn("scenario_results", "critical", "INTEGER");

export const json = <T = any>(v: string | null | undefined): T | null => (v ? JSON.parse(v) : null);
