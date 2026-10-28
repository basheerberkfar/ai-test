import { labDb, json } from "../database/lab-db.js";
import { evaluateRun } from "./evaluator.js";

const avg = (xs: (number | null | undefined)[]) => {
  const v = xs.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

/** Per-run metrics derived only from recorded executions. */
export function runMetrics(runId: string) {
  const run = labDb.prepare("SELECT * FROM runs WHERE id = ?").get(runId) as any;
  const results = labDb.prepare("SELECT scenario_key, kind, status, expectations_json FROM scenario_results WHERE run_id = ?").all(runId) as any[];
  const summary = json<any>(run.summary_json);
  const usage = json<any>(run.usage_json) ?? {};
  const hp = results.find((r) => r.kind === "happy_path");
  const reg = results.filter((r) => r.kind === "regression");
  const acs: string[] = summary?.acceptanceCriteria ?? [];
  return {
    runId,
    storyId: run.story_id,
    mode: run.mode as string,
    status: run.status,
    createdAt: run.created_at,
    model: run.model,
    sut: json<any>(run.sut_json),
    happyPath: hp?.status ?? null,
    acCoverage: acs.length ? acs.filter((s) => s === "met" || s === "not_met").length / acs.length : null,
    regressionTotal: reg.length,
    regressionExecuted: reg.filter((r) => r.status === "Passed" || r.status === "Failed").length,
    regressionCoverage: reg.length ? reg.filter((r) => r.status === "Passed" || r.status === "Failed").length / reg.length : null,
    durationMs: run.duration_ms,
    costUsd: json<any>(run.cost_json)?.totalUsd ?? usage.costUsd ?? null,
    evaluation: evaluateRun(runId),
    statuses: Object.fromEntries(results.map((r) => [r.scenario_key, r.status])),
  };
}

export function aggregateMetrics(storyId?: string) {
  const runs = (labDb
    .prepare(`SELECT id FROM runs WHERE status IN ('completed') ${storyId ? "AND story_id = ?" : ""} ORDER BY created_at`)
    .all(...(storyId ? [storyId] : [])) as any[]).map((r) => runMetrics(r.id));

  // Repeatability: among runs of the same story under the same SUT configuration, how often does
  // each mandatory scenario get the same verdict, and how often is each enabled bug detected.
  const groups = new Map<string, typeof runs>();
  for (const r of runs) {
    const key = `${r.storyId}|${r.mode}|${JSON.stringify(r.sut)}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const consistency: number[] = [];
  const repeatGroups = [...groups.entries()]
    .filter(([, g]) => g.length >= 2)
    .map(([key, g]) => {
      const keys = Object.keys(g[0].statuses).filter((k) => !k.startsWith("EX-") && g.every((r) => k in r.statuses));
      const perScenario = keys.map((k) => {
        const counts: Record<string, number> = {};
        for (const r of g) counts[r.statuses[k]] = (counts[r.statuses[k]] ?? 0) + 1;
        const agreement = Math.max(...Object.values(counts)) / g.length;
        consistency.push(agreement);
        return { scenario: k, counts, agreement };
      });
      const bugs = (g[0].evaluation?.enabledBugs ?? []).map((b) => ({
        bug: b,
        detectedIn: g.filter((r) => r.evaluation?.detectedBugs.includes(b)).length,
        runs: g.length,
      }));
      return { storyId: g[0].storyId, mode: g[0].mode, sut: g[0].sut, runs: g.length, perScenario, bugs, key };
    });

  return {
    runs: runs.length,
    happyPathSuccessRate: runs.length ? runs.filter((r) => r.happyPath === "Passed").length / runs.length : null,
    acceptanceCriteriaCoverage: avg(runs.map((r) => r.acCoverage)),
    regressionScenarioCoverage: avg(runs.map((r) => r.regressionCoverage)),
    knownBugDetectionRate: avg(runs.map((r) => r.evaluation?.detectionRate)),
    falsePositiveRate: avg(runs.map((r) => r.evaluation?.falsePositiveRate)),
    repeatability: avg(consistency),
    avgDurationMs: avg(runs.map((r) => r.durationMs)),
    avgCostUsd: avg(runs.map((r) => r.costUsd)),
    totalCostUsd: runs.reduce((a, r) => a + (r.costUsd ?? 0), 0),
    perRun: runs,
    repeatGroups,
  };
}
