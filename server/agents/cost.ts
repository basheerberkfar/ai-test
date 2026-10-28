import { labDb } from "../database/lab-db.js";
import { now } from "../database/sqlite.js";
import { readAiConfig, type Limits, type ModelTier, type Role } from "../config.js";
import type { Conversation, ModelProvider, Usage } from "./providers/types.js";

export class BudgetExceeded extends Error {}

export function modelCost(model: string, u: Usage): number | null {
  const p = readAiConfig().pricing.models[model];
  if (!p) return null;
  return (u.inputTokens * p.input + u.outputTokens * p.output + u.cacheReadTokens * p.cacheRead + u.cacheWriteTokens * p.cacheWrite) / 1_000_000;
}

type Tag = { role: Role; tier: ModelTier; scenarioKey: string | null };

/**
 * AI Cost Manager: one per run. Every model request goes through a metered provider, which
 * checks the budget BEFORE the call and records tokens/cost AFTER it. Browser time and actions
 * are added as infrastructure cost. Any limit breach throws BudgetExceeded.
 */
export class CostManager {
  private insert = labDb.prepare(
    `INSERT INTO model_calls (run_id, ts, scenario_key, role, tier, model_requested, model_served, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, latency_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  readonly totals = { modelCalls: 0, actions: 0, screenshotsToModel: 0, scenarioRetries: 0, modelUsd: 0, browserUsd: 0, toolUsd: 0, unpricedCalls: 0 };
  readonly usage: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  readonly servedModels = new Set<string>();
  /** Most recent call cost per model, used as the reserve required before the next call. */
  private lastCallUsd = new Map<string, number>();
  private readonly deadline: number;

  constructor(
    readonly runId: string,
    readonly limits: Limits,
    private readonly isCancelled: () => boolean,
    private readonly onChange: () => void = () => {},
  ) {
    this.deadline = Date.now() + limits.runMinutes * 60_000;
  }

  get totalUsd() {
    return this.totals.modelUsd + this.totals.browserUsd + this.totals.toolUsd;
  }
  get remainingUsd() {
    return Math.max(0, this.limits.maxCostUsd - this.totalUsd);
  }

  /** Throws when any guard rail is hit. Called before every model call and browser action. */
  check() {
    if (this.isCancelled()) throw new BudgetExceeded("Run cancelled by user.");
    if (Date.now() > this.deadline) throw new BudgetExceeded(`Run time limit (${this.limits.runMinutes} min) reached.`);
    if (this.totalUsd >= this.limits.maxCostUsd) throw new BudgetExceeded(`Cost budget of $${this.limits.maxCostUsd} reached ($${this.totalUsd.toFixed(2)} spent).`);
    if (this.totals.modelCalls >= this.limits.maxModelCalls) throw new BudgetExceeded(`Model call limit (${this.limits.maxModelCalls}) reached.`);
    if (this.totals.actions >= this.limits.maxBrowserActions) throw new BudgetExceeded(`Browser action limit (${this.limits.maxBrowserActions}) reached.`);
  }

  /** Refuse a model call that would likely push spending past the budget. */
  private checkCall(model: string) {
    this.check();
    const reserve = this.lastCallUsd.get(model) ?? 0;
    if (this.totalUsd + reserve > this.limits.maxCostUsd)
      throw new BudgetExceeded(`Cost budget of $${this.limits.maxCostUsd} reached ($${this.totalUsd.toFixed(3)} spent; next ${model} call ≈ $${reserve.toFixed(3)}).`);
  }

  recordAction() {
    this.check();
    this.totals.actions++;
    this.totals.toolUsd += readAiConfig().pricing.infrastructure.perBrowserActionUsd;
  }

  /** Returns false when the per-scenario screenshot budget is used up (the agent should use the text outline). */
  allowScreenshotToModel(usedInScenario: number) {
    if (usedInScenario >= this.limits.screenshotsToModelPerScenario) return false;
    this.totals.screenshotsToModel++;
    this.totals.toolUsd += readAiConfig().pricing.infrastructure.perScreenshotToModelUsd;
    return true;
  }

  recordBrowserTime(ms: number) {
    this.totals.browserUsd += (ms / 60_000) * readAiConfig().pricing.infrastructure.browserPerMinuteUsd;
    this.onChange();
  }

  allowScenarioRetry() {
    if (this.totals.scenarioRetries >= this.limits.maxScenarioRetries) return false;
    this.totals.scenarioRetries++;
    return true;
  }

  private record(tag: Tag, requested: string, served: string, u: Usage, latencyMs: number) {
    const cost = modelCost(requested, u) ?? modelCost(served, u);
    this.totals.modelCalls++;
    if (cost !== null) this.lastCallUsd.set(requested, cost);
    if (cost === null) this.totals.unpricedCalls++;
    this.totals.modelUsd += cost ?? 0;
    this.usage.inputTokens += u.inputTokens;
    this.usage.outputTokens += u.outputTokens;
    this.usage.cacheReadTokens += u.cacheReadTokens;
    this.usage.cacheWriteTokens += u.cacheWriteTokens;
    this.servedModels.add(served);
    this.insert.run(this.runId, now(), tag.scenarioKey, tag.role, tag.tier, requested, served, u.inputTokens, u.outputTokens, u.cacheReadTokens, u.cacheWriteTokens, cost, latencyMs);
    this.onChange();
  }

  /** Wrap a provider so every request is budget-checked and recorded under the given tag. */
  meter(provider: ModelProvider, tag: Tag): ModelProvider {
    const mgr = this;
    return {
      name: provider.name,
      model: provider.model,
      startConversation(opts): Conversation {
        const inner = provider.startConversation(opts);
        return {
          addUser: (p) => inner.addUser(p),
          addToolResults: (r) => inner.addToolResults(r),
          async step() {
            mgr.checkCall(provider.model);
            const t = Date.now();
            const res = await inner.step();
            mgr.record(tag, provider.model, res.servedModel, res.usage, Date.now() - t);
            return res;
          },
        };
      },
      async completeJson(opts) {
        mgr.checkCall(provider.model);
        const t = Date.now();
        const res = await provider.completeJson(opts);
        mgr.record(tag, provider.model, res.servedModel, res.usage, Date.now() - t);
        return res;
      },
    };
  }

  summary() {
    return {
      ...this.totals,
      totalUsd: this.totalUsd,
      budgetUsd: this.limits.maxCostUsd,
      usage: this.usage,
      servedModels: [...this.servedModels],
    };
  }
}

/** Cost aggregated from the call ledger (used for per-scenario / per-story views). */
export function costByScenario(runId: string) {
  return labDb
    .prepare(
      `SELECT COALESCE(scenario_key, '(run)') AS scenario, role, COUNT(*) AS calls, SUM(input_tokens) AS input, SUM(output_tokens) AS output,
              SUM(cache_read_tokens) AS cacheRead, SUM(cache_write_tokens) AS cacheWrite, SUM(COALESCE(cost_usd, 0)) AS usd,
              GROUP_CONCAT(DISTINCT model_served) AS models
       FROM model_calls WHERE run_id = ? GROUP BY scenario, role ORDER BY MIN(id)`,
    )
    .all(runId) as { scenario: string; role: string; calls: number; input: number; output: number; cacheRead: number; cacheWrite: number; usd: number; models: string }[];
}
