import { readAiConfig } from "../config.js";
import { labDb } from "../database/lab-db.js";

export type GateItem = { runId: string; storyId: string; scenario: string; reason: string };
export type GateResult = {
  verdict: "pass" | "fail" | "incomplete" | "error";
  exitCode: 0 | 1 | 2 | 3;
  blocking: GateItem[]; // verified failures that fail the required check
  incomplete: GateItem[]; // not executed / not verifiable — never counted as success
  nonBlocking: GateItem[]; // verified failures outside the blocking policy (reported, not gating)
  advisory: GateItem[]; // suspected or exploratory findings
};

/**
 * Required-check policy (config/ai-testing.json → ci):
 *  - Blocking: a CRITICAL mandatory scenario (Happy Path or critical regression scenario) verified as
 *    Failed, or a verified defect of blocking severity found while executing a mandatory scenario.
 *  - Incomplete: mandatory scenarios Blocked/Inconclusive, or runs that failed/were cancelled.
 *  - Exploratory findings are advisory unless `exploratoryFindingsBlocking` is set AND they are verified.
 *  - Suspected findings are always advisory.
 */
export function evaluateGate(runIds: string[]): GateResult {
  const policy = readAiConfig().ci;
  const res: GateResult = { verdict: "pass", exitCode: 0, blocking: [], incomplete: [], nonBlocking: [], advisory: [] };
  for (const runId of runIds) {
    const run = labDb.prepare("SELECT id, story_id, status, error FROM runs WHERE id = ?").get(runId) as any;
    if (!run) continue;
    const item = (scenario: string, reason: string): GateItem => ({ runId, storyId: run.story_id, scenario, reason });
    if (run.status !== "completed") res.incomplete.push(item("(run)", `Run ${run.status}${run.error ? `: ${run.error}` : ""}`));

    const results = labDb.prepare("SELECT scenario_key, kind, status, critical, summary FROM scenario_results WHERE run_id = ?").all(runId) as any[];
    for (const r of results) {
      if (r.kind === "exploratory") {
        if (r.status === "Blocked" || r.status === "Inconclusive") res.advisory.push(item(r.scenario_key, `Exploratory charter ${r.status.toLowerCase()}`));
        continue;
      }
      if (r.status === "Failed") (r.critical && policy.failOnVerifiedFailures ? res.blocking : res.nonBlocking).push(item(r.scenario_key, `Verified failure${r.critical ? " (critical)" : ""}: ${r.summary}`));
      else if (r.status === "Blocked" || r.status === "Inconclusive") res.incomplete.push(item(r.scenario_key, `${r.status}${r.critical ? " (critical)" : ""}`));
    }

    const findings = labDb.prepare("SELECT scenario_key, title, severity, classification, eval_label FROM findings WHERE run_id = ?").all(runId) as any[];
    for (const f of findings) {
      if (f.eval_label === "duplicate" || f.classification === "rejected") continue;
      const exploratory = f.scenario_key.startsWith("EX-");
      const label = `${f.classification === "verified_defect" ? "Verified defect" : "Suspected"} (${f.severity}): ${f.title}`;
      if (f.classification !== "verified_defect" || (exploratory && !policy.exploratoryFindingsBlocking)) res.advisory.push(item(f.scenario_key, label));
      else if (policy.blockingFindingSeverities.includes(f.severity)) res.blocking.push(item(f.scenario_key, label));
      else res.nonBlocking.push(item(f.scenario_key, label));
    }
  }
  if (res.blocking.length) Object.assign(res, { verdict: "fail", exitCode: 1 });
  else if (res.incomplete.length) Object.assign(res, { verdict: "incomplete", exitCode: policy.failOnIncomplete ? 2 : 0 });
  return res;
}
