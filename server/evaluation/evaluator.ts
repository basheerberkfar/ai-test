import fs from "node:fs";
import { paths } from "../config.js";
import { labDb, json } from "../database/lab-db.js";

/**
 * Evaluator — compares AI findings with the private hidden bug list AFTER a run has finished.
 * This module is the only reader of evaluation/hidden-bugs.json and is never imported by agents.
 */

export type HiddenBug = {
  id: string;
  category: string;
  title: string;
  description: string;
  reproduction: string[];
  fixedBehavior: string;
  matchKeywords: string[][];
};

export const loadHiddenBugs = (): HiddenBug[] => JSON.parse(fs.readFileSync(paths.hiddenBugs, "utf8")).bugs;

/** Heuristic suggestion: every keyword group must have at least one hit. Humans can override. */
export function suggestBug(text: string, bugs: HiddenBug[]) {
  const t = text.toLowerCase();
  const scored = bugs
    .map((b) => ({ b, hits: b.matchKeywords.filter((g) => g.some((k) => t.includes(k.toLowerCase()))).length }))
    .filter((x) => x.hits === x.b.matchKeywords.length);
  return scored[0]?.b ?? null;
}

export function autoLabelRun(runId: string) {
  const bugs = loadHiddenBugs();
  const findings = labDb.prepare("SELECT * FROM findings WHERE run_id = ? AND eval_label IS NULL").all(runId) as any[];
  const upd = labDb.prepare("UPDATE findings SET eval_bug_id = ?, eval_label = ? WHERE id = ?");
  for (const f of findings) {
    const bug = suggestBug(`${f.title} ${f.expected} ${f.actual}`, bugs);
    if (bug) upd.run(bug.id, "auto_match", f.id);
  }
}

export function labelFinding(findingId: number, label: "true_positive" | "false_positive" | "duplicate" | null, bugId: string | null) {
  labDb.prepare("UPDATE findings SET eval_label = ?, eval_bug_id = ? WHERE id = ?").run(label, bugId, findingId);
}

/** Per-run evaluation against the bugs that were enabled when the run started. */
export function evaluateRun(runId: string) {
  const run = labDb.prepare("SELECT sut_json FROM runs WHERE id = ?").get(runId) as any;
  if (!run) return null;
  const sut = json<{ bugs: Record<string, boolean> }>(run.sut_json)!;
  const enabled = Object.entries(sut.bugs).filter(([, on]) => on).map(([id]) => id);
  const findings = labDb.prepare("SELECT * FROM findings WHERE run_id = ? AND classification != 'rejected'").all(runId) as any[];
  const isTP = (f: any) => (f.eval_label === "true_positive" || f.eval_label === "auto_match") && enabled.includes(f.eval_bug_id);
  const detected = [...new Set(findings.filter(isTP).map((f) => f.eval_bug_id))];
  const falsePositives = findings.filter((f) => f.eval_label === "false_positive" || (!isTP(f) && f.eval_label !== "duplicate" && f.eval_label !== null));
  const unlabeled = findings.filter((f) => f.eval_label === null);
  const reported = findings.filter((f) => f.eval_label !== "duplicate").length;
  return {
    enabledBugs: enabled,
    detectedBugs: detected,
    missedBugs: enabled.filter((b) => !detected.includes(b)),
    detectionRate: enabled.length ? detected.length / enabled.length : null,
    reportedFindings: reported,
    falsePositives: falsePositives.length,
    unlabeledFindings: unlabeled.length,
    // Unlabeled findings are counted as potential false positives until a human reviews them.
    falsePositiveRate: reported ? (falsePositives.length + unlabeled.length) / reported : 0,
  };
}
