import fs from "node:fs";
import path from "node:path";
import { accountCredentials, paths } from "../config.js";
import { BrowserSession } from "../browser/session.js";
import { emit } from "../execution/events.js";
import { now } from "../database/sqlite.js";
import { AGENT_TOOLS } from "./tools.js";
import type { ModelTier } from "../config.js";
import { BudgetExceeded, type Completion, type RunContext, type ScenarioBrief, type ScenarioOutcome } from "./context.js";
import type { ContentPart, ToolCall, ToolResult } from "./providers/types.js";

const systemPrompt = () => fs.readFileSync(path.join(paths.prompts, "qa-agent.md"), "utf8");

function scenarioMessage(ctx: RunContext, brief: ScenarioBrief, stepLimit: number) {
  const s = ctx.story;
  return [
    `# Scenario ${brief.key}: ${brief.title}`,
    `Type: ${brief.kind.replace("_", " ")}`,
    "",
    `## Story ${s.id} — ${s.title}`,
    s.description,
    "",
    "Acceptance criteria:",
    ...s.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`),
    "",
    "## Environment",
    `Application URL: ${ctx.env.baseUrl}`,
    `API path prefix (for api_request): ${ctx.env.apiPathPrefix}`,
    `Available test account roles: ${Object.keys(ctx.env.accounts).join(", ")}`,
    `Test data tag (put it in every record you create): ${ctx.testDataTag}`,
    "The browser starts on a blank page in a fresh session (not logged in).",
    "",
    "## Your task",
    brief.instructions,
    ...(brief.expectedResults.length ? ["", "## Expected results to verify", ...brief.expectedResults.map((e, i) => `${i + 1}. ${e}`)] : []),
    "",
    `You have at most ${stepLimit} steps (model turns) for this scenario. Finish with complete_scenario.`,
  ].join("\n");
}

const fmtNetwork = (n: { method: string; path: string; status: number; ms: number; responseBody?: string }) =>
  `${n.method} ${n.path} → ${n.status || "FAILED"} (${n.ms}ms)${n.status >= 400 || n.status === 0 ? ` ${n.responseBody?.slice(0, 200) ?? ""}` : ""}`;

/**
 * Runs one scenario in an isolated browser context with a fresh model conversation.
 * The model tier comes from routing config (executor/explorer role) unless `tier` is given.
 */
export async function executeScenario(ctx: RunContext, brief: ScenarioBrief, opts: { tier?: ModelTier; attempt?: number } = {}): Promise<ScenarioOutcome> {
  const startedAt = now();
  const started = Date.now();
  const key = brief.key;
  const role = brief.kind === "exploratory" ? "explorer" : "executor";
  const provider = ctx.providerFor(role, key, opts.tier);
  const limits = ctx.cost.limits;
  ctx.setCurrent(key);
  emit(ctx.runId, {
    scenarioKey: key,
    kind: "system",
    title: `Scenario ${key} started (${provider.model}${(opts.attempt ?? 1) > 1 ? `, attempt ${opts.attempt}` : ""}): ${brief.title}`,
    detail: { brief, model: provider.model },
  });

  const browser = new BrowserSession(ctx.env.allowedOrigins, ctx.env.apiPathPrefix);
  let completion: Completion | null = null;
  let steps = 0;
  let endReason: ScenarioOutcome["endReason"] = "completed";
  let error: string | undefined;
  let shotIndex = 0;
  let actions = 0;
  let screenshotsToModel = 0;
  let lastOutline = "";
  let lastOutlineEvidence = 0;

  const shot = async () => {
    const rel = path.join("runs", ctx.runId, `${key}-${String(++shotIndex).padStart(3, "0")}.jpg`);
    const b64 = await browser.screenshot(path.join(paths.artifacts, rel)).catch(() => null);
    return { rel: b64 ? rel.replace(/\\/g, "/") : null, b64 };
  };

  async function observeAfterAction(callTitle: string, input: unknown): Promise<{ text: string; image?: ContentPart }> {
    const snap = await browser.snapshot(limits.outlineMaxChars).catch((e) => ({ url: browser.page.url(), title: "", outline: `(snapshot failed: ${e.message})`, viewport: "" }));
    const activity = browser.drainActivity();
    const s = await shot();
    for (const n of activity.network) emit(ctx.runId, { scenarioKey: key, kind: "network", title: fmtNetwork(n), detail: n });
    for (const c of activity.console) emit(ctx.runId, { scenarioKey: key, kind: "console", title: `[${c.level}] ${c.text.slice(0, 200)}`, detail: c });
    const id = emit(ctx.runId, {
      scenarioKey: key,
      kind: "action",
      title: callTitle,
      detail: { input, url: snap.url, outline: snap.outline, network: activity.network, console: activity.console },
      screenshot: s.rel,
    });
    // Token saver: an unchanged page is referenced instead of re-sent (full outline stays in the evidence log).
    const unchanged = snap.outline === lastOutline;
    if (!unchanged) {
      lastOutline = snap.outline;
      lastOutlineEvidence = id;
    }
    const text = [
      `Evidence E${id}. URL: ${snap.url}`,
      activity.network.length ? `API traffic: ${activity.network.map(fmtNetwork).join("; ")}` : "API traffic: none",
      activity.console.length ? `Console: ${activity.console.map((c) => `[${c.level}] ${c.text.slice(0, 160)}`).join("; ")}` : "",
      unchanged ? `Page outline: unchanged since E${lastOutlineEvidence}.` : "Page outline:",
      unchanged ? "" : snap.outline,
    ]
      .filter(Boolean)
      .join("\n");
    return { text };
  }

  async function runTool(call: ToolCall): Promise<ToolResult> {
    const input = call.input ?? {};
    const ok = (text: string, extra: ContentPart[] = []): ToolResult => ({ id: call.id, parts: [{ type: "text", text }, ...extra] });
    const fail = (text: string): ToolResult => ({ id: call.id, parts: [{ type: "text", text }], isError: true });
    try {
      switch (call.name) {
        case "get_test_account": {
          const creds = accountCredentials(ctx.env, String(input.role));
          const id = emit(ctx.runId, { scenarioKey: key, kind: "action", title: `Requested ${input.role} test account`, detail: { role: input.role, email: creds?.email } });
          return creds ? ok(`Evidence E${id}. email: ${creds.email}\npassword: ${creds.password}`) : fail(`No test account configured for role ${input.role}.`);
        }
        case "report_finding": {
          ctx.findings.push({ scenarioKey: key, ...input });
          const id = emit(ctx.runId, { scenarioKey: key, kind: "finding", title: `Finding reported: ${input.title}`, detail: input });
          return ok(`Finding recorded (E${id}). It will be independently verified.`);
        }
        case "propose_regression_scenario": {
          ctx.proposals.push({ scenarioKey: key, ...input });
          const id = emit(ctx.runId, { scenarioKey: key, kind: "proposal", title: `Regression scenario proposed: ${input.title}`, detail: input });
          return ok(`Proposal recorded (E${id}) for human review.`);
        }
        case "complete_scenario":
          return ok("Scenario completion recorded.");
      }

      ctx.cost.recordAction(); // throws BudgetExceeded when a limit is reached
      actions++;
      switch (call.name) {
        case "navigate":
          await browser.navigate(String(input.path), ctx.env.baseUrl);
          return ok((await observeAfterAction(`Navigate to ${input.path}`, input)).text);
        case "snapshot":
          return ok((await observeAfterAction("Read page", input)).text);
        case "click": {
          const times = Math.min(5, Math.max(1, Number(input.times) || 1));
          await browser.click(String(input.ref), times, Number(input.interval_ms ?? 60));
          return ok((await observeAfterAction(times > 1 ? `Click ${input.ref} ×${times}` : `Click ${input.ref}`, input)).text);
        }
        case "type_text": {
          const text = String(input.text ?? "").repeat(Math.max(1, Number(input.repeat) || 1)).slice(0, 5000);
          const isPassword = await browser.type(String(input.ref), text, input.clear !== false, !!input.press_enter);
          // Never write passwords into the evidence log.
          const secrets = Object.keys(ctx.env.accounts).map((r) => accountCredentials(ctx.env, r)?.password);
          const label = isPassword || secrets.includes(text) ? "••••••••" : text.length > 60 ? `${text.slice(0, 40)}… (${text.length} chars)` : text;
          return ok((await observeAfterAction(`Type "${label}" into ${input.ref}`, { ...input, text: label })).text);
        }
        case "select_option":
          await browser.select(String(input.ref), String(input.option));
          return ok((await observeAfterAction(`Select "${input.option}" in ${input.ref}`, input)).text);
        case "press_key":
          await browser.pressKey(String(input.key));
          return ok((await observeAfterAction(`Press ${input.key}`, input)).text);
        case "reload_page":
          await browser.reload();
          return ok((await observeAfterAction("Reload page", input)).text);
        case "go_back":
          await browser.back();
          return ok((await observeAfterAction("Browser back", input)).text);
        case "set_viewport":
          await browser.setViewport(Number(input.width), Number(input.height));
          return ok((await observeAfterAction(`Resize viewport to ${input.width}×${input.height}`, input)).text);
        case "set_network":
          await browser.setNetwork(input.mode);
          return ok(`Evidence E${emit(ctx.runId, { scenarioKey: key, kind: "action", title: `Network set to ${input.mode}`, detail: input })}. Network mode: ${input.mode}.`);
        case "wait":
          await new Promise((r) => setTimeout(r, Math.min(5000, Number(input.ms) || 500)));
          return ok((await observeAfterAction(`Wait ${input.ms}ms`, input)).text);
        case "api_request": {
          const res = await browser.apiRequest(String(input.method), String(input.path), input.body, ctx.env.authTokenStorageKey);
          browser.drainActivity(); // in-page fetch already captured here; avoid double logging
          const id = emit(ctx.runId, {
            scenarioKey: key,
            kind: "observation",
            title: `API ${input.method} ${input.path} → ${res.status}`,
            detail: { request: input, response: res },
          });
          return ok(`Evidence E${id}. HTTP ${res.status}${res.authenticated ? "" : " (no session token found — not logged in?)"}\n${res.body}`);
        }
        case "screenshot": {
          if (!ctx.cost.allowScreenshotToModel(screenshotsToModel))
            return fail(`Screenshot budget for this scenario (${limits.screenshotsToModelPerScenario}) is used up. Use the text outline / snapshot instead.`);
          screenshotsToModel++;
          const s = await shot();
          const id = emit(ctx.runId, { scenarioKey: key, kind: "observation", title: "Screenshot captured", screenshot: s.rel });
          return s.b64 ? ok(`Evidence E${id}. Screenshot attached.`, [{ type: "image", mediaType: "image/jpeg", base64: s.b64 }]) : fail("Screenshot failed.");
        }
        default:
          return fail(`Unknown tool ${call.name}.`);
      }
    } catch (e: any) {
      if (e instanceof BudgetExceeded) throw e;
      const msg = String(e?.message ?? e).slice(0, 400);
      const id = emit(ctx.runId, { scenarioKey: key, kind: "error", title: `${call.name} failed: ${msg}`, detail: { input } });
      return fail(`Evidence E${id}. Action failed: ${msg}`);
    }
  }

  try {
    await browser.open();
    const convo = provider.startConversation({ system: systemPrompt(), tools: AGENT_TOOLS });
    const stepLimit = limits.stepsPerScenario;
    convo.addUser([{ type: "text", text: scenarioMessage(ctx, brief, stepLimit) }]);
    let idleTurns = 0;

    while (!completion) {
      ctx.cost.check();
      if (steps >= stepLimit + 2) {
        endReason = "step_limit";
        break;
      }
      steps++;
      const res = await convo.step(); // metered: budget-checked and recorded by the cost manager
      if (res.text.trim()) emit(ctx.runId, { scenarioKey: key, kind: "reasoning", title: res.text.trim().slice(0, 500) });

      if (!res.toolCalls.length) {
        if (res.stopReason === "refusal" || ++idleTurns > 2) {
          endReason = "no_progress";
          break;
        }
        convo.addUser([{ type: "text", text: "Continue the scenario using the tools, or call complete_scenario if you are done." }]);
        continue;
      }
      idleTurns = 0;

      const results: ToolResult[] = [];
      for (const call of res.toolCalls) {
        if (call.name === "complete_scenario" && !completion) completion = call.input as Completion;
        results.push(await runTool(call));
      }
      const remaining = stepLimit - steps;
      if (!completion && remaining <= 3) {
        const note = remaining <= 0 ? "STEP LIMIT REACHED. Call complete_scenario now with what you verified." : `Note: ${remaining} steps left. Start wrapping up.`;
        const last = results[results.length - 1];
        last.parts = [...last.parts, { type: "text", text: note }];
      }
      convo.addToolResults(results);
    }
  } catch (e: any) {
    if (e instanceof BudgetExceeded) {
      endReason = ctx.isCancelled() ? "cancelled" : "budget";
      error = e.message;
    } else {
      endReason = "error";
      error = String(e?.message ?? e);
    }
    emit(ctx.runId, { scenarioKey: key, kind: "error", title: `Scenario ${key} interrupted: ${error}` });
  } finally {
    await browser.close();
    ctx.cost.recordBrowserTime(Date.now() - started);
  }

  emit(ctx.runId, {
    scenarioKey: key,
    kind: "system",
    title: completion ? `Scenario ${key}: agent reported "${completion.status}"` : `Scenario ${key} ended without completion (${endReason})`,
  });
  return {
    brief,
    completion,
    stepsUsed: steps,
    actions,
    browserMs: Date.now() - started,
    model: provider.model,
    attempts: opts.attempt ?? 1,
    endReason: completion ? "completed" : endReason,
    error,
    startedAt,
    finishedAt: now(),
  };
}
