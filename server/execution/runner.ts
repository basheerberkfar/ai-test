import crypto from "node:crypto";
import {
  limitsForMode,
  modelFor,
  readAiConfig,
  readSutConfig,
  resolveEnvironment,
  settings,
  type ExecutionMode,
  type Limits,
  type ModelTier,
  type Role,
} from "../config.js";
import { labDb } from "../database/lab-db.js";
import { now } from "../database/sqlite.js";
import { resetDemoData } from "../database/demo-db.js";
import { getStory, type Story } from "../stories/store.js";
import { approvedScenarios, proposeScenario, type Scenario } from "../regression/store.js";
import { createProvider, providerConfigured } from "../agents/providers/index.js";
import type { ModelProvider } from "../agents/providers/types.js";
import { BudgetExceeded, CostManager, costByScenario } from "../agents/cost.js";
import type { RunContext, ScenarioBrief, ScenarioOutcome } from "../agents/context.js";
import { executeScenario } from "../agents/executor.js";
import { planExploration, planRun, type Charter, type RunPlan } from "../agents/planner.js";
import { verifyFindings, verifyScenario } from "../agents/verifier.js";
import { parseEvidenceIds, getEvents, emit } from "./events.js";
import { hashOf, sourceInfo } from "./metadata.js";
import { autoLabelRun } from "../evaluation/evaluator.js";
import { writeReport } from "../reports/report.js";
import { browserVersion, closeBrowser } from "../browser/session.js";

export type RunOptions = {
  mode?: ExecutionMode;
  provider?: "anthropic" | "openai";
  /** Forces one model for every role (disables tier routing). */
  model?: string;
  resetData?: boolean;
  /** Overrides the mode's number of exploratory charters. */
  exploratory?: number;
  /** Overrides the mode's cost budget (can only be set lower than the env cap AI_MAX_COST_USD). */
  maxCostUsd?: number;
  trigger?: string;
  label?: string;
};

const queue: string[] = [];
let active: string | null = null;
const cancelled = new Set<string>();
const waiters = new Map<string, (() => void)[]>();

export function startRun(storyId: string, options: RunOptions = {}) {
  const story = getStory(storyId);
  if (!story) throw new Error(`Story ${storyId} not found.`);
  const env = resolveEnvironment(story.appUrl); // throws for unauthorized targets
  const provider = options.provider ?? settings.provider;
  if (!providerConfigured(provider)) throw new Error(`${provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY"} is not set (see .env.example).`);
  const mode = options.mode ?? "regression";
  const modeCfg = readAiConfig().modes[mode];
  if (!modeCfg) throw new Error(`Unknown mode ${mode}.`);
  const limits = limitsForMode(mode, options.maxCostUsd ? { maxCostUsd: options.maxCostUsd } : {});
  const id = `run_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}_${crypto.randomBytes(3).toString("hex")}`;
  const opts = {
    mode,
    resetData: options.resetData ?? true,
    exploratory: Math.min(8, options.exploratory ?? modeCfg.exploratoryCharters),
    regression: modeCfg.regression,
    plan: modeCfg.plan,
    model: options.model ?? null,
    label: options.label ?? "",
    limits,
    effort: provider === "anthropic" ? settings.effort : undefined,
  };
  labDb
    .prepare(
      `INSERT INTO runs (id, story_id, status, phase, provider, model, environment_id, options_json, sut_json, created_at, mode, trigger)
       VALUES (?, ?, 'queued', NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, story.id, provider, options.model ?? modelFor(provider, "executor"), env.id, JSON.stringify(opts), JSON.stringify(readSutConfig()), now(), mode, options.trigger ?? "manual");
  queue.push(id);
  void pump();
  return id;
}

/** Resolves when the run has finished (completed, failed or cancelled). */
export function waitForRun(id: string) {
  const row = labDb.prepare("SELECT status FROM runs WHERE id = ?").get(id) as { status: string } | undefined;
  if (!row || !["queued", "running"].includes(row.status)) return Promise.resolve();
  return new Promise<void>((resolve) => waiters.set(id, [...(waiters.get(id) ?? []), resolve]));
}

export function cancelRun(id: string) {
  const idx = queue.indexOf(id);
  if (idx >= 0) {
    queue.splice(idx, 1);
    labDb.prepare("UPDATE runs SET status = 'cancelled', phase = 'done', finished_at = ? WHERE id = ?").run(now(), id);
    waiters.get(id)?.forEach((r) => r());
    return;
  }
  if (active === id) cancelled.add(id);
}

/** Marks runs left 'running' by a crashed/restarted server as failed. */
export function recoverInterruptedRuns() {
  labDb.prepare("UPDATE runs SET status = 'failed', phase = 'done', error = 'Server restarted during execution.' WHERE status IN ('running', 'queued')").run();
}

async function pump() {
  if (active || !queue.length) return;
  active = queue.shift()!;
  const id = active;
  try {
    await executeRun(id);
  } catch (e: any) {
    // Last-resort guard: a run must never stay "running" forever.
    labDb.prepare("UPDATE runs SET status = 'failed', phase = 'done', error = ?, finished_at = ? WHERE id = ?").run(`Internal error: ${e?.message ?? e}`, now(), id);
  } finally {
    cancelled.delete(id);
    active = null;
    waiters.get(id)?.forEach((r) => r());
    waiters.delete(id);
    void pump();
  }
}

function updateRun(id: string, fields: Record<string, unknown>) {
  const keys = Object.keys(fields);
  labDb.prepare(`UPDATE runs SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`).run(...(keys.map((k) => fields[k]) as any[]), id);
}

function mandatoryBriefs(story: Story, plan: RunPlan | null, regression: Scenario[]): ScenarioBrief[] {
  const hp: ScenarioBrief = {
    key: "HP",
    kind: "happy_path",
    critical: true,
    title: `Happy Path — ${story.title}`,
    instructions: [
      "Execute the mandatory Happy Path below step by step, in order, and verify every step with evidence.",
      ...story.happyPath.map((s, i) => `${i + 1}. ${s}`),
      "",
      "Verify the acceptance criteria that this path touches; map each expectation to its acceptance criterion number.",
      "Verify that ALL entered field values were saved (check the details view and/or read the record back via api_request).",
      plan?.happyPathNotes ? `Planner notes: ${plan.happyPathNotes}` : "",
      plan?.testData ? `Suggested test data: ${plan.testData}` : "",
      "Only report deviations as findings if you actually observed them.",
    ]
      .filter(Boolean)
      .join("\n"),
    expectedResults: [
      ...story.acceptanceCriteria.map((c, i) => `AC${i + 1}: ${c}`),
      ...story.happyPath.filter((s) => /^verify/i.test(s)).map((s) => s.replace(/\.$/, "")),
    ],
  };
  const rs = regression.map<ScenarioBrief>((r) => ({
    key: r.id,
    kind: "regression",
    critical: !!r.critical,
    title: r.title,
    instructions: [
      `Execute approved regression scenario ${r.id}. ${r.description}`,
      r.preconditions.length ? `Preconditions:\n${r.preconditions.map((p) => `- ${p}`).join("\n")}` : "",
      `Steps:\n${r.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}`,
      "The UI may have changed since the scenario was written; adapt to the current layout but keep the intent of each step.",
      "If an expected result is not met, report it as a finding as well.",
      plan?.regressionNotes.find((n) => n.id === r.id)?.notes ? `Planner notes: ${plan.regressionNotes.find((n) => n.id === r.id)!.notes}` : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
    expectedResults: r.expectedResults,
  }));
  return [hp, ...rs];
}

const charterBrief = (ch: Charter, i: number): ScenarioBrief => ({
  key: `EX-${i + 1}`,
  kind: "exploratory",
  critical: false,
  title: ch.title,
  instructions: `Exploratory charter: ${ch.charter}\nWhy: ${ch.rationale}\nInvestigate actively and follow up on anything suspicious. Report each real defect with report_finding and propose regression scenarios for meaningful ones. In complete_scenario list what you checked as expectations.`,
  expectedResults: [],
});

const blockedOutcome = (brief: ScenarioBrief, reason: ScenarioOutcome["endReason"], error: string): ScenarioOutcome => ({
  brief,
  completion: null,
  stepsUsed: 0,
  actions: 0,
  browserMs: 0,
  model: "-",
  attempts: 0,
  endReason: reason,
  error,
  startedAt: now(),
  finishedAt: now(),
});

async function executeRun(runId: string) {
  const run = labDb.prepare("SELECT * FROM runs WHERE id = ?").get(runId) as any;
  const opts = JSON.parse(run.options_json) as { mode: ExecutionMode; resetData: boolean; exploratory: number; regression: "all" | "critical" | "none"; plan: boolean; model: string | null; limits: Limits };
  const story = getStory(run.story_id)!;
  const env = resolveEnvironment(story.appUrl);
  const providerName = run.provider as "anthropic" | "openai";
  const started = Date.now();
  const isCancelled = () => cancelled.has(runId);
  updateRun(runId, { status: "running", phase: "planning", started_at: now() });

  const cost = new CostManager(runId, opts.limits, isCancelled, () => updateRun(runId, { cost_json: JSON.stringify(cost.summary()) }));
  const providers = new Map<string, ModelProvider>();
  const providerFor = (role: Role, scenarioKey: string | null, tier?: ModelTier) => {
    const cfg = readAiConfig().routing;
    const t = opts.model ? "advanced" : (tier ?? cfg.roles[role]);
    const model = opts.model ?? modelFor(providerName, role, t);
    if (!providers.has(model)) providers.set(model, createProvider(providerName, model));
    return cost.meter(providers.get(model)!, { role, tier: t, scenarioKey });
  };

  const ctx: RunContext = {
    runId,
    mode: opts.mode,
    story,
    env,
    testDataTag: `AIQA-${runId.slice(-6).toUpperCase()}`,
    cost,
    providerFor,
    findings: [],
    proposals: [],
    isCancelled,
    setCurrent: (key) => updateRun(runId, { current_scenario: key }),
  };

  const metadata: Record<string, unknown> = {
    mode: opts.mode,
    trigger: run.trigger,
    provider: providerName,
    routing: opts.model ? { forced: opts.model } : { ...readAiConfig().routing[providerName], roles: readAiConfig().routing.roles },
    effort: providerName === "anthropic" ? settings.effort : null,
    environment: { id: env.id, baseUrl: env.baseUrl },
    sutConfigHash: hashOf(JSON.parse(run.sut_json)),
    storyHash: hashOf(story),
    ...sourceInfo(),
  };
  try {
    metadata.browserVersion = await browserVersion();
  } catch (e: any) {
    metadata.browserVersion = `unavailable: ${e.message}`;
  }
  updateRun(runId, { metadata_json: JSON.stringify(metadata) });

  const outcomes: ScenarioOutcome[] = [];
  let plan: RunPlan | null = null;
  let charters: Charter[] = [];
  let fatal: string | null = null;
  const regression = approvedScenarios(story.id, opts.regression);
  const mandatory = () => mandatoryBriefs(story, plan, regression);

  /** Run a mandatory scenario; escalate once to the advanced tier if the economy model could not reach a verdict. */
  const runMandatory = async (brief: ScenarioBrief) => {
    let outcome = await executeScenario(ctx, brief);
    const routing = readAiConfig().routing;
    const economy = !opts.model && routing.roles.executor === "economy";
    const retryable = ["step_limit", "no_progress", "completed", "error"].includes(outcome.endReason);
    if (economy && routing.escalateIncompleteToAdvanced && retryable && verifyScenario(runId, outcome).status === "Inconclusive" && cost.allowScenarioRetry()) {
      emit(runId, { scenarioKey: brief.key, kind: "system", title: `No conclusive verdict with the economy model; retrying ${brief.key} once with the advanced model.` });
      outcome = await executeScenario(ctx, brief, { tier: "advanced", attempt: 2 });
    }
    outcomes.push(outcome);
  };

  try {
    if (opts.resetData && env.resettable) {
      resetDemoData();
      emit(runId, { kind: "system", title: "Demo data reset to the seeded baseline." });
    }
    emit(runId, {
      kind: "system",
      title: `${opts.mode} run started: ${story.id} via ${providerName}. ${regression.length} regression scenario(s) selected (${opts.regression}). Budget $${opts.limits.maxCostUsd}.`,
      detail: { limits: opts.limits, metadata },
    });

    // 1. Planning (no browser). Skipped in modes configured without planning (smoke) to save cost.
    if (opts.plan) {
      try {
        const res = await planRun(providerFor("planner", null), story, regression);
        plan = res.data;
        updateRun(runId, { plan_json: JSON.stringify({ run: plan }) });
        emit(runId, { kind: "plan", title: "Execution plan prepared", detail: plan });
      } catch (e: any) {
        if (e instanceof BudgetExceeded) throw e;
        emit(runId, { kind: "error", title: `Planner failed, continuing with mandatory scenarios only: ${e.message}` });
      }
    }

    // 2. Mandatory scenarios: Happy Path, then the selected approved regression scenarios (never skipped).
    updateRun(runId, { phase: "executing" });
    for (const brief of mandatory()) {
      if (isCancelled()) break;
      await runMandatory(brief);
    }

    // 3. Exploration, planned from what the mandatory scenarios observed.
    if (opts.exploratory > 0 && !isCancelled()) {
      try {
        const observations = outcomes
          .map((o) => `- ${o.brief.key} (${o.completion?.status ?? o.endReason}): ${o.completion?.summary ?? o.error ?? ""}`)
          .concat(ctx.findings.map((f) => `- finding: ${f.title}`))
          .join("\n");
        const res = await planExploration(providerFor("planner", null), story, observations, opts.exploratory);
        charters = res.data.charters;
        updateRun(runId, { plan_json: JSON.stringify({ run: plan, exploration: charters }) });
        emit(runId, { kind: "plan", title: `Exploration plan: ${charters.length} charter(s)`, detail: res.data });
        for (const [i, ch] of charters.entries()) {
          if (isCancelled()) break;
          outcomes.push(await executeScenario(ctx, charterBrief(ch, i)));
        }
      } catch (e: any) {
        if (e instanceof BudgetExceeded) throw e;
        emit(runId, { kind: "error", title: `Exploration planning failed: ${e.message}` });
      }
    }
  } catch (e: any) {
    fatal = e instanceof BudgetExceeded ? e.message : `Unexpected error: ${e?.message ?? e}`;
    emit(runId, { kind: "error", title: fatal });
  }

  // Scenarios that never started (budget/cancel/error) are recorded as Blocked — never skipped, never passed.
  const executedKeys = new Set(outcomes.map((o) => o.brief.key));
  const reason = isCancelled() ? "cancelled" : "budget";
  for (const b of [...mandatory(), ...charters.map(charterBrief)])
    if (!executedKeys.has(b.key)) outcomes.push(blockedOutcome(b, reason, fatal ?? "Not started"));

  // 4. Verification (separate from execution). The verifier may still run after the budget is
  //    exhausted only if budget remains; otherwise findings stay "suspected".
  updateRun(runId, { phase: "verifying", current_scenario: null });
  const infra = readAiConfig().pricing.infrastructure;
  const modelUsdByScenario = new Map<string, number>();
  for (const c of costByScenario(runId)) modelUsdByScenario.set(c.scenario, (modelUsdByScenario.get(c.scenario) ?? 0) + c.usd);
  const insResult = labDb.prepare(
    `INSERT INTO scenario_results (run_id, scenario_key, kind, title, status, agent_status, summary, expectations_json, verification_notes, steps_used, started_at, finished_at, cost_usd, model, browser_ms, actions, attempts, critical)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const o of outcomes) {
    const v = verifyScenario(runId, o);
    const scenarioUsd = (modelUsdByScenario.get(o.brief.key) ?? 0) + (o.browserMs / 60_000) * infra.browserPerMinuteUsd + o.actions * infra.perBrowserActionUsd;
    insResult.run(runId, o.brief.key, o.brief.kind, o.brief.title, v.status, o.completion?.status ?? null, o.completion?.summary ?? o.error ?? "", JSON.stringify(v.expectations), JSON.stringify(v.notes), o.stepsUsed, o.startedAt, o.finishedAt, scenarioUsd, o.model, o.browserMs, o.actions, o.attempts, o.brief.critical ? 1 : 0);
    emit(runId, { scenarioKey: o.brief.key, kind: "result", title: `${o.brief.key}: ${v.status} ($${scenarioUsd.toFixed(3)})`, detail: { notes: v.notes } });
  }

  let verdicts: Awaited<ReturnType<typeof verifyFindings>>["verdicts"] = [];
  if (ctx.findings.length) {
    try {
      verdicts = (await verifyFindings(providerFor("verifier", null), runId, ctx.findings)).verdicts;
    } catch (e: any) {
      emit(runId, { kind: "error", title: `Finding verification not completed; findings kept as suspected: ${e.message}` });
    }
  }
  const insFinding = labDb.prepare(
    `INSERT INTO findings (run_id, scenario_key, title, severity, expected, actual, steps_json, evidence_json, agent_reproduced, classification, verifier_rationale, eval_label, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  ctx.findings.forEach((f, i) => {
    const v = verdicts.find((x) => x.index === i);
    const hasEvidence = getEvents(runId, parseEvidenceIds(f.evidence_ids)).length > 0;
    // Without evidence a finding can never be "verified", whatever the reviewer said.
    let classification = v?.verdict ?? "suspected";
    if (classification === "verified_defect" && !hasEvidence) classification = "suspected";
    const duplicate = v?.duplicate_of !== null && v?.duplicate_of !== undefined && v.duplicate_of !== i;
    insFinding.run(runId, f.scenarioKey, f.title, f.severity, f.expected, f.actual, JSON.stringify(f.steps_to_reproduce ?? []), JSON.stringify(f.evidence_ids ?? []), f.times_observed ?? 1, classification, v?.rationale ?? "Not reviewed.", duplicate ? "duplicate" : null, now());
  });

  // 5. Persist regression proposals (status: proposed — humans approve).
  for (const p of ctx.proposals) {
    try {
      const evs = getEvents(runId, parseEvidenceIds(p.evidence_ids));
      const s = proposeScenario({
        storyId: story.id,
        fields: { title: p.title, description: p.description, preconditions: p.preconditions ?? [], steps: p.steps, expectedResults: p.expected_results },
        discoverySource: { type: "ai-exploration", runId, scenarioKey: p.scenarioKey, findingTitle: p.related_finding },
        evidence: evs.map((e) => ({ label: `E${e.id} ${e.title}`, screenshot: e.screenshot ?? undefined, eventId: e.id })),
        actor: `ai-agent (${run.provider})`,
      });
      emit(runId, { kind: "proposal", title: `Saved proposal ${s.id}: ${s.title}` });
    } catch (e: any) {
      emit(runId, { kind: "error", title: `Could not save proposal "${p.title}": ${e.message}` });
    }
  }

  // 6. Report + evaluator labels
  updateRun(runId, { phase: "reporting" });
  autoLabelRun(runId);
  // A run in which no scenario could complete (e.g. invalid API key, app down) is a failed run, not a result.
  const status = isCancelled() ? "cancelled" : !outcomes.some((o) => o.completion) ? "failed" : "completed";
  if (status === "failed" && !fatal) fatal = outcomes.find((o) => o.error)?.error ?? "No scenario could be completed.";
  metadata.servedModels = [...cost.servedModels];
  updateRun(runId, {
    status,
    phase: "done",
    error: fatal,
    finished_at: now(),
    duration_ms: Date.now() - started,
    metadata_json: JSON.stringify(metadata),
    cost_json: JSON.stringify(cost.summary()),
    usage_json: JSON.stringify({ ...cost.usage, costUsd: cost.totalUsd, modelCostUsd: cost.totals.modelUsd, actions: cost.totals.actions, modelCalls: cost.totals.modelCalls }),
  });
  try {
    const summary = writeReport(runId);
    updateRun(runId, { summary_json: JSON.stringify(summary) });
  } catch (e: any) {
    emit(runId, { kind: "error", title: `Report generation failed: ${e.message}` });
  }
  emit(runId, { kind: "system", title: `Run ${status}. Total estimated cost $${cost.totalUsd.toFixed(3)} of $${opts.limits.maxCostUsd} budget.` });
  if (!queue.length) await closeBrowser();
}

