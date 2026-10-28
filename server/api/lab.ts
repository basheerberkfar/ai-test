import { Router, type Request, type Response, type NextFunction } from "express";
import { ZodError } from "zod";
import { readSutConfig, writeSutConfig, readEnvironments, readAiConfig, limitsForMode, MODES } from "../config.js";
import { labDb, json } from "../database/lab-db.js";
import { resetDemoData } from "../database/demo-db.js";
import { getStory, listStories, saveStory } from "../stories/store.js";
import * as regression from "../regression/store.js";
import { cancelRun, startRun } from "../execution/runner.js";
import { buildReport, reportToMarkdown } from "../reports/report.js";
import { providerStatus } from "../agents/providers/index.js";
import { aggregateMetrics, runMetrics } from "../evaluation/metrics.js";
import { labelFinding, loadHiddenBugs, suggestBug } from "../evaluation/evaluator.js";
import { baselineComparison } from "../evaluation/baseline.js";
import { costByScenario } from "../agents/cost.js";
import { evaluateGate } from "../execution/gate.js";

/** API of the AI Testing Workspace. Not reachable from the demo app origin (see apps/demo-app/vite.config.ts). */
export const labApi = Router();

const wrap = (fn: (req: Request, res: Response) => unknown) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    await fn(req, res);
  } catch (e) {
    next(e);
  }
};
const ACTOR = "workspace-user";

function runRow(r: any) {
  return {
    id: r.id,
    storyId: r.story_id,
    status: r.status,
    phase: r.phase,
    currentScenario: r.current_scenario,
    provider: r.provider,
    model: r.model,
    environmentId: r.environment_id,
    options: json(r.options_json),
    plan: json(r.plan_json),
    usage: json(r.usage_json),
    summary: json(r.summary_json),
    error: r.error,
    createdAt: r.created_at,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    durationMs: r.duration_ms,
    mode: r.mode,
    trigger: r.trigger,
    metadata: json(r.metadata_json),
    cost: json(r.cost_json),
  };
}

/** Total and average estimated cost of completed runs per story. */
function storyCost(storyId: string) {
  const rows = labDb.prepare("SELECT cost_json, usage_json FROM runs WHERE story_id = ? AND status IN ('completed','failed','cancelled')").all(storyId) as any[];
  const costs = rows.map((r) => json<any>(r.cost_json)?.totalUsd ?? json<any>(r.usage_json)?.costUsd ?? 0);
  const total = costs.reduce((a, c) => a + c, 0);
  return { runs: rows.length, totalUsd: total, avgUsd: rows.length ? total / rows.length : null };
}

// --- Status & overview -------------------------------------------------------

labApi.get("/status", (_req, res) => {
  const cfg = readAiConfig();
  res.json({
    ai: providerStatus(),
    limits: cfg.limits,
    modes: Object.fromEntries(MODES.map((m) => [m, { ...cfg.modes[m], limits: limitsForMode(m) }])),
    environments: readEnvironments().map((e) => ({ id: e.id, name: e.name, baseUrl: e.baseUrl })) });
});

labApi.get("/overview", (_req, res) => {
  const count = (sql: string) => (labDb.prepare(sql).get() as { n: number }).n;
  const latest = (labDb.prepare("SELECT * FROM runs ORDER BY created_at DESC LIMIT 8").all() as any[]).map(runRow);
  res.json({
    totalStories: listStories().length,
    totalRuns: count("SELECT COUNT(*) AS n FROM runs WHERE status IN ('completed','failed','cancelled')"),
    passedScenarios: count("SELECT COUNT(*) AS n FROM scenario_results WHERE status = 'Passed'"),
    failedScenarios: count("SELECT COUNT(*) AS n FROM scenario_results WHERE status = 'Failed'"),
    blockedOrInconclusive: count("SELECT COUNT(*) AS n FROM scenario_results WHERE status IN ('Blocked','Inconclusive')"),
    verifiedDefects: count("SELECT COUNT(*) AS n FROM findings WHERE classification = 'verified_defect' AND COALESCE(eval_label,'') != 'duplicate'"),
    discoveredScenarios: regression.listScenarios().filter((s) => s.discoverySource.type === "ai-exploration").length,
    pendingProposals: regression.listScenarios({ status: "proposed" }).length,
    approvedScenarios: regression.listScenarios({ status: "approved" }).length,
    latestRuns: latest,
  });
});

// --- Stories -----------------------------------------------------------------

labApi.get("/stories", (_req, res) => {
  res.json(
    listStories().map((s) => ({
      ...s,
      regression: regression.listScenarios({ storyId: s.id }).map((r) => ({ id: r.id, title: r.title, status: r.status })),
      lastRun: (() => {
        const r = labDb.prepare("SELECT * FROM runs WHERE story_id = ? ORDER BY created_at DESC LIMIT 1").get(s.id);
        return r ? runRow(r) : null;
      })(),
      cost: storyCost(s.id),
    })),
  );
});

labApi.get("/stories/:id", (req, res) => {
  const story = getStory(req.params.id);
  if (!story) return res.status(404).json({ error: "Story not found" });
  res.json({ ...story, regression: regression.listScenarios({ storyId: story.id }), cost: storyCost(story.id) });
});

labApi.post("/stories", wrap((req, res) => res.status(201).json(saveStory(req.body))));
labApi.put("/stories/:id", wrap((req, res) => res.json(saveStory(req.body, String(req.params.id)))));

labApi.post(
  "/stories/:id/runs",
  wrap((req, res) => {
    const id = startRun(String(req.params.id), req.body ?? {});
    res.status(202).json({ id });
  }),
);

// --- Runs --------------------------------------------------------------------

labApi.get("/runs", (req, res) => {
  const rows = req.query.storyId
    ? labDb.prepare("SELECT * FROM runs WHERE story_id = ? ORDER BY created_at DESC").all(String(req.query.storyId))
    : labDb.prepare("SELECT * FROM runs ORDER BY created_at DESC LIMIT 200").all();
  res.json((rows as any[]).map(runRow));
});

labApi.get("/runs/:id", (req, res) => {
  const r = labDb.prepare("SELECT * FROM runs WHERE id = ?").get(req.params.id);
  if (!r) return res.status(404).json({ error: "Run not found" });
  const results = (labDb.prepare("SELECT * FROM scenario_results WHERE run_id = ? ORDER BY id").all(req.params.id) as any[]).map((x) => ({
    ...x,
    expectations: json(x.expectations_json),
    verificationNotes: json(x.verification_notes),
  }));
  const findings = (labDb.prepare("SELECT * FROM findings WHERE run_id = ? ORDER BY id").all(req.params.id) as any[]).map((f) => ({
    ...f,
    steps: json(f.steps_json),
    evidence: json(f.evidence_json),
  }));
  const lastShot = labDb.prepare("SELECT screenshot FROM run_events WHERE run_id = ? AND screenshot IS NOT NULL ORDER BY id DESC LIMIT 1").get(req.params.id) as any;
  const { sut_json: _hidden, ...row } = r as any; // bug flags stay in the evaluation view
  const done = !["queued", "running"].includes(row.status);
  res.json({ ...runRow(row), results, findings, liveScreenshot: lastShot?.screenshot ?? null, costByScenario: costByScenario(row.id), gate: done ? evaluateGate([row.id]) : null });
});

labApi.get("/runs/:id/events", (req, res) => {
  const after = Number(req.query.after) || 0;
  const rows = labDb.prepare("SELECT * FROM run_events WHERE run_id = ? AND id > ? ORDER BY id LIMIT 500").all(req.params.id, after) as any[];
  res.json(rows.map((e) => ({ id: e.id, ts: e.ts, scenarioKey: e.scenario_key, kind: e.kind, title: e.title, detail: json(e.detail_json), screenshot: e.screenshot })));
});

labApi.post("/runs/:id/cancel", (req, res) => {
  cancelRun(String(req.params.id));
  res.json({ ok: true });
});

labApi.get(
  "/runs/:id/report.:format",
  wrap((req, res) => {
    const report = buildReport(String(req.params.id));
    if (req.params.format === "md") {
      res.type("text/markdown").attachment(`${req.params.id}.md`).send(reportToMarkdown(report));
    } else if (req.params.format === "json") {
      res.attachment(`${req.params.id}.json`).json(report);
    } else res.status(400).json({ error: "Use .md or .json" });
  }),
);
labApi.get("/runs/:id/report", wrap((req, res) => res.json(buildReport(String(req.params.id)))));

// --- Regression memory -------------------------------------------------------

labApi.get("/scenarios", (req, res) => {
  res.json(regression.listScenarios({ storyId: req.query.storyId as string | undefined, status: req.query.status as any }));
});
labApi.get("/scenarios/:id", (req, res) => {
  const s = regression.getScenario(req.params.id);
  s ? res.json(s) : res.status(404).json({ error: "Not found" });
});
labApi.post(
  "/scenarios",
  wrap((req, res) => {
    const { storyId, ...fields } = req.body ?? {};
    if (!getStory(storyId)) return res.status(400).json({ error: "Unknown story" });
    res.status(201).json(regression.proposeScenario({ storyId, fields, discoverySource: { type: "manual" }, actor: ACTOR }));
  }),
);
labApi.put("/scenarios/:id", wrap((req, res) => res.json(regression.editScenario(String(req.params.id), req.body?.fields, ACTOR, req.body?.reason))));
labApi.post("/scenarios/:id/approve", wrap((req, res) => res.json(regression.approveScenario(String(req.params.id), ACTOR, req.body?.note))));
labApi.post("/scenarios/:id/reject", wrap((req, res) => res.json(regression.rejectScenario(String(req.params.id), ACTOR, req.body?.note))));
labApi.post("/scenarios/:id/retire", wrap((req, res) => res.json(regression.retireScenario(String(req.params.id), ACTOR, req.body?.note))));
labApi.post("/scenarios/:id/critical", wrap((req, res) => res.json(regression.setCritical(String(req.params.id), !!req.body?.critical, ACTOR))));
labApi.post("/scenarios/:id/revision", wrap((req, res) => res.json(regression.resolveRevision(String(req.params.id), !!req.body?.accept, ACTOR, req.body?.note))));

// --- Evaluation & environment (human evaluator only) ------------------------

labApi.get("/evaluation", (req, res) => {
  const bugs = loadHiddenBugs();
  const findings = (labDb
    .prepare("SELECT f.*, r.created_at AS run_created FROM findings f JOIN runs r ON r.id = f.run_id ORDER BY f.id DESC LIMIT 300")
    .all() as any[]).map((f) => ({ ...f, suggestedBug: suggestBug(`${f.title} ${f.expected} ${f.actual}`, bugs)?.id ?? null }));
  res.json({ sut: readSutConfig(), bugs, metrics: aggregateMetrics(req.query.storyId as string | undefined), findings, baseline: baselineComparison() });
});

labApi.post("/gate", (req, res) => res.json(evaluateGate(Array.isArray(req.body?.runIds) ? req.body.runIds.map(String) : [])));

labApi.get("/runs/:id/metrics", (req, res) => res.json(runMetrics(String(req.params.id))));

labApi.put(
  "/sut",
  wrap((req, res) => {
    const cur = readSutConfig();
    const next = {
      uiVariant: req.body?.uiVariant === "refresh" ? "refresh" : req.body?.uiVariant === "classic" ? "classic" : cur.uiVariant,
      bugs: { ...cur.bugs, ...(req.body?.bugs ?? {}) },
    } as const;
    writeSutConfig(next);
    res.json(next);
  }),
);

labApi.post("/environment/reset", (_req, res) => {
  resetDemoData();
  res.json({ ok: true });
});

labApi.post(
  "/findings/:id/label",
  wrap((req, res) => {
    const label = req.body?.label ?? null;
    if (![null, "true_positive", "false_positive", "duplicate"].includes(label)) return res.status(400).json({ error: "Invalid label" });
    labelFinding(Number(req.params.id), label, req.body?.bugId ?? null);
    res.json({ ok: true });
  }),
);

// --- Errors ------------------------------------------------------------------

labApi.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ZodError) return res.status(400).json({ error: "Validation failed", issues: err.issues });
  res.status(400).json({ error: String(err?.message ?? err) });
});
