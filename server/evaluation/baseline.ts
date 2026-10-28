import { MODES, readAiConfig, type ExecutionMode } from "../config.js";
import { labDb, json } from "../database/lab-db.js";
import { listScenarios } from "../regression/store.js";
import { listStories } from "../stories/store.js";

type Line = { item: string; traditionalUsd: number | null; aiUsd: number | null; basis: string };

/**
 * Monthly cost/effort comparison: AI-driven runs (measured where possible) vs. a hand-written
 * Playwright suite covering the same scenarios (team assumptions from config → baseline).
 * Every line states whether it is measured or assumed.
 */
export function baselineComparison() {
  const cfg = readAiConfig();
  const b = cfg.baseline;
  const rate = b.engineerHourlyUsd;
  const runner = cfg.pricing.infrastructure.ciRunnerPerMinuteUsd;
  const scenarios = listStories().length + listScenarios({ status: "approved" }).length; // happy paths + approved regression

  // Measured: average cost and duration per completed run, per mode (last 30 days).
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const perMode = Object.fromEntries(
    MODES.map((m) => {
      const rows = labDb.prepare("SELECT cost_json, usage_json, duration_ms FROM runs WHERE status = 'completed' AND mode = ? AND created_at >= ?").all(m, since) as any[];
      const costs = rows.map((r) => json<any>(r.cost_json)?.totalUsd ?? json<any>(r.usage_json)?.costUsd).filter((x): x is number => typeof x === "number");
      const mins = rows.map((r) => (r.duration_ms ?? 0) / 60_000);
      return [m, { runs: rows.length, avgCostUsd: costs.length ? costs.reduce((a, c) => a + c, 0) / costs.length : null, avgMinutes: mins.length ? mins.reduce((a, c) => a + c, 0) / mins.length : null }];
    }),
  ) as Record<ExecutionMode, { runs: number; avgCostUsd: number | null; avgMinutes: number | null }>;

  // Measured: human interventions in regression memory over the last 30 days.
  const humanActions = listScenarios()
    .flatMap((s) => s.history)
    .filter((h) => h.at >= since && !h.actor.startsWith("ai-agent") && h.action !== "proposed").length;
  // Only runs without a verdict are AI-specific overhead; triaging real failures costs the same with any approach.
  const nonPassingRuns = (labDb.prepare("SELECT summary_json FROM runs WHERE status = 'completed' AND created_at >= ?").all(since) as any[]).filter(
    (r) => json<any>(r.summary_json)?.gate === "incomplete",
  ).length;
  const completedRuns = Object.values(perMode).reduce((a, m) => a + m.runs, 0);
  const nonPassingShare = completedRuns ? nonPassingRuns / completedRuns : null;

  const monthlyRuns = MODES.reduce((a, m) => a + b.runsPerMonth[m], 0);
  const aiExec = MODES.every((m) => b.runsPerMonth[m] === 0 || perMode[m].avgCostUsd !== null)
    ? MODES.reduce((a, m) => a + b.runsPerMonth[m] * (perMode[m].avgCostUsd ?? 0), 0)
    : null;
  const aiRunner = MODES.every((m) => b.runsPerMonth[m] === 0 || perMode[m].avgMinutes !== null)
    ? MODES.reduce((a, m) => a + b.runsPerMonth[m] * (perMode[m].avgMinutes ?? 0) * runner, 0)
    : null;

  const lines: Line[] = [
    {
      item: "One-time authoring",
      traditionalUsd: scenarios * b.authoringHoursPerScenario * rate,
      aiUsd: 0,
      basis: `assumed: ${b.authoringHoursPerScenario} h/scenario × ${scenarios} scenarios. AI: stories and scenarios are written anyway (not counted).`,
    },
    {
      item: "Execution (model + infrastructure)",
      traditionalUsd: monthlyRuns * scenarios * b.ciMinutesPerScenarioRun * runner,
      aiUsd: aiExec,
      basis: `AI measured: avg cost per mode × runs/month (${MODES.map((m) => `${m} ${b.runsPerMonth[m]}×${perMode[m].avgCostUsd == null ? "n/a" : "$" + perMode[m].avgCostUsd.toFixed(2)}`).join(", ")}). Traditional assumed ${b.ciMinutesPerScenarioRun} CI min/scenario.`,
    },
    {
      item: "CI runner time",
      traditionalUsd: null,
      aiUsd: aiRunner,
      basis: "AI measured: avg run duration × runs/month × runner price (traditional runner time is included in the line above).",
    },
    {
      item: "Routine maintenance",
      traditionalUsd: scenarios * b.maintenanceHoursPerScenarioPerMonth * rate,
      aiUsd: humanActions * b.aiReviewHoursPerProposal * rate,
      basis: `traditional assumed ${b.maintenanceHoursPerScenarioPerMonth} h/scenario/month; AI measured ${humanActions} human review/edit actions in regression memory (30 days) × ${b.aiReviewHoursPerProposal} h.`,
    },
    {
      item: "UI-change breakage",
      traditionalUsd: b.uiChangesPerMonth * scenarios * b.uiChangeBreakageHoursPerScenario * rate,
      aiUsd: 0,
      basis: `assumed ${b.uiChangesPerMonth} UI changes/month × ${b.uiChangeBreakageHoursPerScenario} h/scenario. AI: no selectors to repair — verify with the layout-change experiment; failures surface in triage below.`,
    },
    {
      item: "Triage of incomplete runs (AI-specific)",
      traditionalUsd: null,
      aiUsd: nonPassingShare === null ? null : nonPassingShare * monthlyRuns * b.aiReviewHoursPerIncompleteRun * rate,
      basis: `AI measured: ${nonPassingRuns}/${completedRuns} runs incomplete (Blocked/Inconclusive, 30 days) × ${b.aiReviewHoursPerIncompleteRun} h each. Real failures are excluded (same triage cost either way); traditional flaky-test triage not modeled.`,
    },
  ];
  const sum = (k: "traditionalUsd" | "aiUsd", from = 1) => (lines.slice(from).some((l) => l[k] === null && k === "aiUsd") ? null : lines.slice(from).reduce((a, l) => a + (l[k] ?? 0), 0));
  return {
    scenarios,
    runsPerMonth: b.runsPerMonth,
    measured: { perMode, humanActions, nonPassingRuns, completedRuns },
    lines,
    monthlyTraditionalUsd: sum("traditionalUsd"),
    monthlyAiUsd: sum("aiUsd"),
    oneTimeTraditionalUsd: lines[0].traditionalUsd,
    note: "Traditional figures are assumptions from config/ai-testing.json → baseline; AI figures are measured from recorded runs where marked. Monthly totals exclude one-time authoring. AI totals are n/a until each scheduled mode has at least one completed run.",
  };
}
