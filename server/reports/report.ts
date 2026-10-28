import fs from "node:fs";
import path from "node:path";
import { paths } from "../config.js";
import { labDb, json } from "../database/lab-db.js";
import { getStory } from "../stories/store.js";
import { listScenarios } from "../regression/store.js";
import { costByScenario } from "../agents/cost.js";
import { evaluateGate } from "../execution/gate.js";

export type AcCoverage = { index: number; text: string; status: "met" | "not_met" | "not_verified" | "not_covered"; evidence: string[] };

export function buildReport(runId: string) {
  const run = labDb.prepare("SELECT * FROM runs WHERE id = ?").get(runId) as any;
  if (!run) throw new Error("Run not found.");
  const story = getStory(run.story_id);
  const results = (labDb.prepare("SELECT * FROM scenario_results WHERE run_id = ? ORDER BY id").all(runId) as any[]).map((r) => ({
    key: r.scenario_key,
    kind: r.kind,
    title: r.title,
    status: r.status,
    agentStatus: r.agent_status,
    summary: r.summary,
    expectations: json<any[]>(r.expectations_json) ?? [],
    verificationNotes: json<string[]>(r.verification_notes) ?? [],
    stepsUsed: r.steps_used,
    critical: !!r.critical,
    costUsd: r.cost_usd as number | null,
    model: r.model as string | null,
    actions: r.actions as number | null,
    browserMs: r.browser_ms as number | null,
    attempts: r.attempts as number | null,
  }));
  const findings = (labDb.prepare("SELECT * FROM findings WHERE run_id = ? ORDER BY id").all(runId) as any[]).map((f) => ({
    id: f.id,
    scenarioKey: f.scenario_key,
    title: f.title,
    severity: f.severity,
    expected: f.expected,
    actual: f.actual,
    steps: json<string[]>(f.steps_json) ?? [],
    evidence: json<string[]>(f.evidence_json) ?? [],
    classification: f.classification,
    verifierRationale: f.verifier_rationale,
    duplicate: f.eval_label === "duplicate",
    advisory: f.scenario_key.startsWith("EX-") || f.classification !== "verified_defect",
  }));
  const proposals = listScenarios({ storyId: run.story_id }).filter((s) => s.discoverySource.runId === runId);
  const usage = json<any>(run.usage_json) ?? {};
  const options = json<any>(run.options_json) ?? {};

  // Acceptance criteria coverage from verified expectations of mandatory scenarios.
  const acCoverage: AcCoverage[] = (story?.acceptanceCriteria ?? []).map((text, i) => {
    const n = i + 1;
    const linked = results
      .filter((r) => r.kind !== "exploratory")
      .flatMap((r) => r.expectations)
      .filter((e) => Number(e.acceptance_criterion) === n || new RegExp(`^AC${n}\\b`).test(e.expectation ?? ""));
    const status = !linked.length
      ? "not_covered"
      : linked.some((e) => e.outcome === "not_met")
        ? "not_met"
        : linked.some((e) => e.outcome === "met")
          ? "met"
          : "not_verified";
    return { index: n, text, status, evidence: [...new Set(linked.flatMap((e) => e.evidence_ids ?? []))] };
  });

  const hp = results.find((r) => r.kind === "happy_path");
  const regression = results.filter((r) => r.kind === "regression");
  const exploratory = results.filter((r) => r.kind === "exploratory");
  const count = (s: string) => results.filter((r) => r.status === s).length;
  const unique = findings.filter((f) => !f.duplicate && f.classification !== "rejected");

  const recommendations: string[] = [];
  if (hp && hp.status !== "Passed") recommendations.push(`Happy Path is ${hp.status}: treat as release-blocking until investigated.`);
  for (const f of unique.filter((f) => f.classification === "verified_defect")) recommendations.push(`Fix verified defect: ${f.title} (${f.severity}).`);
  const suspected = unique.filter((f) => f.classification === "suspected");
  if (suspected.length) recommendations.push(`Manually triage ${suspected.length} suspected issue(s); evidence was not conclusive.`);
  const pendingProposals = proposals.filter((p) => p.status === "proposed");
  if (pendingProposals.length) recommendations.push(`Review ${pendingProposals.length} proposed regression scenario(s) in Regression Memory.`);
  const blocked = results.filter((r) => r.status === "Blocked" || r.status === "Inconclusive");
  if (blocked.length) recommendations.push(`Re-run or investigate ${blocked.length} blocked/inconclusive scenario(s): ${blocked.map((b) => b.key).join(", ")}.`);
  const uncovered = acCoverage.filter((a) => a.status === "not_covered" || a.status === "not_verified");
  if (uncovered.length) recommendations.push(`Acceptance criteria without verified evidence: ${uncovered.map((a) => `AC${a.index}`).join(", ")}.`);
  if (!recommendations.length) recommendations.push("No action required: all scenarios passed with evidence.");

  const gate = evaluateGate([runId]);
  return {
    runId,
    mode: run.mode as string,
    trigger: run.trigger as string | null,
    metadata: json<any>(run.metadata_json) ?? {},
    cost: { ...(json<any>(run.cost_json) ?? {}), byScenario: costByScenario(runId) },
    gate,
    generatedAt: new Date().toISOString(),
    story: story ? { id: story.id, title: story.title, priority: story.priority, appUrl: story.appUrl } : { id: run.story_id },
    environment: { id: run.environment_id, baseUrl: story?.appUrl },
    model: { provider: run.provider, model: run.model, effort: options.effort ?? null },
    status: run.status,
    error: run.error,
    startedAt: run.started_at,
    finishedAt: run.finished_at,
    durationMs: run.duration_ms,
    usage,
    limits: options.limits,
    totals: { scenarios: results.length, passed: count("Passed"), failed: count("Failed"), blocked: count("Blocked"), inconclusive: count("Inconclusive") },
    happyPath: hp ?? null,
    acceptanceCriteria: acCoverage,
    regression,
    exploratory,
    findings,
    proposals: proposals.map((p) => ({ id: p.id, title: p.title, status: p.status })),
    recommendations,
  };
}

export type Report = ReturnType<typeof buildReport>;

export function reportToMarkdown(r: Report) {
  const lines: string[] = [];
  const dur = r.durationMs ? `${Math.round(r.durationMs / 1000)}s` : "n/a";
  lines.push(`# AI Test Report — ${r.story.id} ${"title" in r.story ? r.story.title : ""}`, "");
  const md = r.metadata;
  lines.push(`- **Run:** ${r.runId} (${r.status}) · **Mode:** ${r.mode} · **Trigger:** ${r.trigger ?? "manual"}`);
  lines.push(`- **CI gate:** ${r.gate.verdict.toUpperCase()} (exit code ${r.gate.exitCode})`);
  lines.push(`- **Environment:** ${r.environment.id} — ${r.environment.baseUrl ?? ""}`);
  lines.push(`- **Models:** ${r.model.provider} — requested ${md.routing ? Object.entries(md.routing).filter(([k]) => k !== "roles").map(([k, v]) => `${k} ${v}`).join(", ") : r.model.model}; served ${(md.servedModels ?? []).join(", ") || "n/a"}${r.model.effort ? ` (effort ${r.model.effort})` : ""}`);
  lines.push(`- **Browser:** ${md.browserVersion ?? "n/a"} · **Commit:** ${md.commitSha ?? "n/a"}${md.dirty ? " (uncommitted changes)" : ""} · **Ref:** ${md.ref ?? "n/a"} · **Node:** ${md.node ?? "n/a"}`);
  lines.push(`- **Duration:** ${dur} · **Browser actions:** ${r.usage.actions ?? 0} · **Model calls:** ${r.usage.modelCalls ?? 0}`);
  lines.push(`- **Tokens:** in ${r.usage.inputTokens ?? 0}, out ${r.usage.outputTokens ?? 0}, cache read ${r.usage.cacheReadTokens ?? 0}, cache write ${r.usage.cacheWriteTokens ?? 0}`);
  lines.push(`- **Estimated cost:** $${Number(r.cost.totalUsd ?? r.usage.costUsd ?? 0).toFixed(3)} of $${r.cost.budgetUsd ?? r.limits?.maxCostUsd ?? "?"} budget (model $${Number(r.cost.modelUsd ?? 0).toFixed(3)}, browser $${Number(r.cost.browserUsd ?? 0).toFixed(3)}, tools $${Number(r.cost.toolUsd ?? 0).toFixed(3)})${r.cost.unpricedCalls ? ` — ${r.cost.unpricedCalls} call(s) to models without a configured price are NOT included` : ""}`);
  lines.push(`- **Totals:** ${r.totals.passed} passed, ${r.totals.failed} failed, ${r.totals.blocked} blocked, ${r.totals.inconclusive} inconclusive`);
  if (r.error) lines.push(`- **Run error:** ${r.error}`);
  lines.push("");

  const scenario = (s: any) => {
    lines.push(`### ${s.key} — ${s.title}: **${s.status}**${s.critical ? " · critical" : ""}`, "");
    lines.push(`_${s.model ?? "-"}${s.attempts && s.attempts > 1 ? ` (attempt ${s.attempts})` : ""} · ${s.stepsUsed ?? 0} model steps · ${s.actions ?? 0} browser actions · $${Number(s.costUsd ?? 0).toFixed(3)}_`, "", s.summary || "", "");
    if (s.expectations.length) {
      lines.push("| Expectation | Outcome | Observed | Evidence |", "|---|---|---|---|");
      for (const e of s.expectations) lines.push(`| ${esc(e.expectation)} | ${e.outcome} | ${esc(e.observed)} | ${(e.evidence_ids ?? []).join(", ")} |`);
      lines.push("");
    }
    if (s.verificationNotes.length) lines.push(...s.verificationNotes.map((n: string) => `> Verification: ${n}`), "");
  };

  lines.push("## Happy Path", "");
  if (r.happyPath) scenario(r.happyPath);
  else lines.push("Not executed.", "");

  lines.push("## Acceptance Criteria Coverage", "", "| # | Criterion | Status | Evidence |", "|---|---|---|---|");
  for (const a of r.acceptanceCriteria) lines.push(`| AC${a.index} | ${esc(a.text)} | ${a.status} | ${a.evidence.join(", ")} |`);
  lines.push("");

  lines.push("## Regression Scenarios", "");
  if (!r.regression.length) lines.push("No approved regression scenarios yet.", "");
  r.regression.forEach(scenario);

  lines.push("## Exploratory Testing", "");
  if (!r.exploratory.length) lines.push("No exploratory scenarios executed.", "");
  r.exploratory.forEach(scenario);

  const section = (title: string, list: Report["findings"]) => {
    lines.push(`## ${title}`, "");
    if (!list.length) lines.push("None.", "");
    for (const f of list) {
      lines.push(`### ${f.title} (${f.severity}) — found in ${f.scenarioKey}`, "");
      lines.push(`- **Expected:** ${f.expected}`, `- **Actual:** ${f.actual}`, `- **Evidence:** ${f.evidence.join(", ") || "none"}`, `- **Reviewer:** ${f.verifierRationale}`);
      lines.push("- **Steps:**", ...f.steps.map((s, i) => `  ${i + 1}. ${s}`), "");
    }
  };
  const active = r.findings.filter((f) => !f.duplicate);
  section("Verified Defects", active.filter((f) => f.classification === "verified_defect"));
  section("Suspected Issues (advisory — not conclusively evidenced)", active.filter((f) => f.classification === "suspected"));
  const rejected = active.filter((f) => f.classification === "rejected");
  if (rejected.length) section("Rejected by Verifier", rejected);

  lines.push("## Blocked and Inconclusive", "");
  const bi = [r.happyPath, ...r.regression, ...r.exploratory].filter((s) => s && (s.status === "Blocked" || s.status === "Inconclusive"));
  if (!bi.length) lines.push("None.", "");
  for (const s of bi) lines.push(`- **${s!.key}** ${s!.status}: ${s!.verificationNotes.join(" ") || s!.summary}`);
  lines.push("");

  lines.push("## CI Gate", "", `Verdict: **${r.gate.verdict}** (exit code ${r.gate.exitCode}).`, "");
  for (const [title, list] of [["Blocking", r.gate.blocking], ["Incomplete (not counted as success)", r.gate.incomplete], ["Non-blocking failures", r.gate.nonBlocking], ["Advisory", r.gate.advisory]] as const)
    if (list.length) lines.push(`**${title}**`, ...list.map((g) => `- ${g.scenario}: ${g.reason}`), "");

  lines.push("## Cost by Scenario", "", "| Scenario | Role | Calls | Input | Output | Cache read | Model cost | Models |", "|---|---|---|---|---|---|---|---|");
  for (const c of r.cost.byScenario) lines.push(`| ${c.scenario} | ${c.role} | ${c.calls} | ${c.input} | ${c.output} | ${c.cacheRead} | $${c.usd.toFixed(4)} | ${c.models} |`);
  lines.push("");

  lines.push("## Proposed Regression Scenarios", "");
  if (!r.proposals.length) lines.push("None.", "");
  for (const p of r.proposals) lines.push(`- ${p.id} — ${p.title} (${p.status})`);
  lines.push("", "## Recommendations", "", ...r.recommendations.map((x) => `- ${x}`), "");
  lines.push(`_Evidence ids (E…) refer to recorded browser actions and observations in the run timeline; screenshots are stored under artifacts/runs/${r.runId}/._`, "");
  return lines.join("\n");
}

const esc = (s: unknown) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");

export function writeReport(runId: string) {
  const report = buildReport(runId);
  fs.writeFileSync(path.join(paths.reports, `${runId}.json`), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(paths.reports, `${runId}.md`), reportToMarkdown(report));
  return { totals: report.totals, happyPath: report.happyPath?.status ?? null, acceptanceCriteria: report.acceptanceCriteria.map((a) => a.status), gate: report.gate.verdict, costUsd: report.cost.totalUsd ?? null };
}
