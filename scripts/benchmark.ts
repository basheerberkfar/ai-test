/**
 * Repeatable benchmark: runs the same story N times under a fixed demo-app configuration and
 * prints the evaluation metrics. Requires the server to be running (`npm run dev`).
 *
 *   npm run benchmark -- --story STORY-001 --runs 3 --mode regression --bugs all --layout classic
 *   npm run benchmark -- --runs 3 --mode exploratory --exploratory 3
 *   npm run benchmark -- --runs 2 --bugs BUG-01,BUG-05      # only these bugs active
 */
import fs from "node:fs";
import path from "node:path";
import { paths } from "../server/config.js";

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .join(" ")
    .split("--")
    .filter(Boolean)
    .map((s) => s.trim().split(/\s+/) as [string, string]),
);
const API = process.env.LAB_API ?? "http://localhost:4000/api/lab";
const story = args.story ?? "STORY-001";
const runs = Number(args.runs ?? 3);
const mode = args.mode ?? "regression";
const exploratory = args.exploratory === undefined ? undefined : Number(args.exploratory);

async function call<T>(p: string, init?: RequestInit): Promise<T> {
  const res = await fetch(API + p, { ...init, headers: { "Content-Type": "application/json" } });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? res.statusText);
  return body;
}

const evaluation = await call<any>("/evaluation");
const bugIds: string[] = evaluation.bugs.map((b: any) => b.id);
const sutBody: any = {};
if (args.bugs) {
  const on = args.bugs === "all" ? bugIds : args.bugs === "none" ? [] : args.bugs.split(",");
  sutBody.bugs = Object.fromEntries(bugIds.map((id) => [id, on.includes(id)]));
}
if (args.layout) sutBody.uiVariant = args.layout;
if (Object.keys(sutBody).length) await call("/sut", { method: "PUT", body: JSON.stringify(sutBody) });
const sut = (await call<any>("/evaluation")).sut;
console.log(`Benchmark: ${story} × ${runs}, mode=${mode}, exploratory=${exploratory ?? "mode default"}, layout=${sut.uiVariant}, active bugs=${Object.entries(sut.bugs).filter(([, v]) => v).map(([k]) => k).join(",") || "none"}`);

const ids: string[] = [];
for (let i = 0; i < runs; i++) {
  // Every run starts from the seeded baseline (resetData) so runs are independent.
  const { id } = await call<{ id: string }>(`/stories/${story}/runs`, { method: "POST", body: JSON.stringify({ mode, resetData: true, exploratory, trigger: "benchmark", label: `benchmark ${i + 1}/${runs}` }) });
  ids.push(id);
  process.stdout.write(`  run ${i + 1}/${runs}: ${id} `);
  for (;;) {
    await new Promise((r) => setTimeout(r, 5000));
    const run = await call<any>(`/runs/${id}`);
    if (!["queued", "running"].includes(run.status)) {
      console.log(`→ ${run.status}, happy path ${run.summary?.happyPath ?? "n/a"}, ${Math.round((run.durationMs ?? 0) / 1000)}s, $${(run.cost?.totalUsd ?? 0).toFixed(3)}`);
      break;
    }
    process.stdout.write(".");
  }
}

const perRun = await Promise.all(ids.map((id) => call<any>(`/runs/${id}/metrics`)));
const pct = (v: number | null | undefined) => (v == null ? "n/a" : `${Math.round(v * 100)}%`);
const avg = (xs: (number | null | undefined)[]) => {
  const v = xs.filter((x): x is number => typeof x === "number");
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
const scenarioKeys = [...new Set(perRun.flatMap((r) => Object.keys(r.statuses)).filter((k) => !k.startsWith("EX-")))];
const repeat = scenarioKeys.map((k) => {
  const counts: Record<string, number> = {};
  for (const r of perRun) counts[r.statuses[k] ?? "missing"] = (counts[r.statuses[k] ?? "missing"] ?? 0) + 1;
  return { scenario: k, counts, agreement: Math.max(...Object.values(counts)) / perRun.length };
});
const summary = {
  story,
  mode,
  sut,
  runs: ids,
  happyPathSuccessRate: perRun.filter((r) => r.happyPath === "Passed").length / perRun.length,
  acceptanceCriteriaCoverage: avg(perRun.map((r) => r.acCoverage)),
  regressionScenarioCoverage: avg(perRun.map((r) => r.regressionCoverage)),
  knownBugDetectionRate: avg(perRun.map((r) => r.evaluation?.detectionRate)),
  falsePositiveRate: avg(perRun.map((r) => r.evaluation?.falsePositiveRate)),
  repeatability: avg(repeat.map((r) => r.agreement)),
  perScenarioRepeatability: repeat,
  bugDetection: Object.fromEntries((perRun[0]?.evaluation?.enabledBugs ?? []).map((b: string) => [b, `${perRun.filter((r) => r.evaluation?.detectedBugs.includes(b)).length}/${perRun.length}`])),
  avgDurationMs: avg(perRun.map((r) => r.durationMs)),
  totalCostUsd: perRun.reduce((a, r) => a + (r.costUsd ?? 0), 0),
};

console.log("\nResults");
console.log(`  Happy Path success rate:      ${pct(summary.happyPathSuccessRate)}`);
console.log(`  Acceptance criteria coverage: ${pct(summary.acceptanceCriteriaCoverage)}`);
console.log(`  Regression scenario coverage: ${pct(summary.regressionScenarioCoverage)}`);
console.log(`  Known bug detection rate:     ${pct(summary.knownBugDetectionRate)}  ${JSON.stringify(summary.bugDetection)}`);
console.log(`  False positive rate:          ${pct(summary.falsePositiveRate)} (unlabeled findings count as FP until reviewed)`);
console.log(`  Repeatability:                ${pct(summary.repeatability)}`);
console.log(`  Avg duration:                 ${Math.round((summary.avgDurationMs ?? 0) / 1000)}s`);
console.log(`  Total estimated cost:         $${summary.totalCostUsd.toFixed(2)}`);

const file = path.join(paths.reports, `benchmark-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
fs.writeFileSync(file, JSON.stringify(summary, null, 2));
console.log(`\nSaved ${path.relative(process.cwd(), file)}`);
