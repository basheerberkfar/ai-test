/**
 * Print evaluation metrics across all completed runs (read-only).
 *   npm run evaluate                 # all stories
 *   npm run evaluate -- STORY-001
 */
import { aggregateMetrics } from "../server/evaluation/metrics.js";
import { baselineComparison } from "../server/evaluation/baseline.js";

const m = aggregateMetrics(process.argv[2]);
const pct = (v: number | null) => (v == null ? "n/a" : `${Math.round(v * 100)}%`);

console.log(`Completed runs: ${m.runs}`);
console.log(`Happy Path success rate:      ${pct(m.happyPathSuccessRate)}`);
console.log(`Acceptance criteria coverage: ${pct(m.acceptanceCriteriaCoverage)}`);
console.log(`Regression scenario coverage: ${pct(m.regressionScenarioCoverage)}`);
console.log(`Known bug detection rate:     ${pct(m.knownBugDetectionRate)}`);
console.log(`False positive rate:          ${pct(m.falsePositiveRate)}`);
console.log(`Repeatability:                ${pct(m.repeatability)}`);
console.log(`Avg duration:                 ${m.avgDurationMs == null ? "n/a" : Math.round(m.avgDurationMs / 1000) + "s"}`);
console.log(`Avg / total cost:             ${m.avgCostUsd == null ? "n/a" : "$" + m.avgCostUsd.toFixed(2)} / $${m.totalCostUsd.toFixed(2)}`);
console.log("\nPer run:");
for (const r of m.perRun)
  console.log(
    `  ${r.runId}  HP=${r.happyPath ?? "-"}  detected=${r.evaluation?.detectedBugs.join(",") || "-"}  missed=${r.evaluation?.missedBugs.join(",") || "-"}  FP=${pct(r.evaluation?.falsePositiveRate ?? null)}`,
  );

const b = baselineComparison();
const usd = (v: number | null) => (v == null ? "n/a" : `$${v.toFixed(2)}`);
console.log("\nAI vs. traditional E2E (monthly; traditional = assumptions, AI = measured where noted):");
for (const l of b.lines) console.log(`  ${l.item.padEnd(36)} traditional ${usd(l.traditionalUsd).padStart(10)}   AI ${usd(l.aiUsd).padStart(10)}`);
console.log(`  ${"Monthly total (excl. authoring)".padEnd(36)} traditional ${usd(b.monthlyTraditionalUsd).padStart(10)}   AI ${usd(b.monthlyAiUsd).padStart(10)}`);
