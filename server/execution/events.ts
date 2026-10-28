import { labDb } from "../database/lab-db.js";
import { now } from "../database/sqlite.js";

export type EventKind =
  | "system"
  | "plan"
  | "reasoning"
  | "action"
  | "observation"
  | "network"
  | "console"
  | "result"
  | "finding"
  | "proposal"
  | "error";

const insert = labDb.prepare(
  "INSERT INTO run_events (run_id, ts, scenario_key, kind, title, detail_json, screenshot) VALUES (?, ?, ?, ?, ?, ?, ?)",
);

export function emit(runId: string, e: { scenarioKey?: string | null; kind: EventKind; title: string; detail?: unknown; screenshot?: string | null }) {
  const r = insert.run(runId, now(), e.scenarioKey ?? null, e.kind, e.title.slice(0, 500), e.detail === undefined ? null : JSON.stringify(e.detail), e.screenshot ?? null);
  return Number(r.lastInsertRowid);
}

export function getEvents(runId: string, ids: number[]) {
  if (!ids.length) return [];
  const rows = labDb
    .prepare(`SELECT * FROM run_events WHERE run_id = ? AND id IN (${ids.map(() => "?").join(",")})`)
    .all(runId, ...ids) as any[];
  return rows.map((r) => ({ ...r, detail: r.detail_json ? JSON.parse(r.detail_json) : null }));
}

export const parseEvidenceIds = (ids: unknown): number[] =>
  Array.isArray(ids) ? ids.map((x) => Number(String(x).replace(/^E/i, ""))).filter((n) => Number.isInteger(n) && n > 0) : [];
