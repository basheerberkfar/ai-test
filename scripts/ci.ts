/**
 * CI entry point: boots an isolated environment (fresh databases, seeded data), selects stories,
 * runs them in the requested mode under a total cost cap, applies the required-check policy and
 * writes Markdown/JSON summaries plus evidence for upload.
 *
 *   npm run ci -- --mode smoke --stories affected --base origin/main
 *   npm run ci -- --mode regression --stories all --max-cost 10
 *   npm run ci -- --mode smoke --dry-run            # selection and plan only, no AI calls
 *
 * Options: --mode smoke|regression|exploratory  --stories all|affected|ID,ID  --base <git ref>
 *          --max-cost <usd>  --output <dir> (default ci-output)  --reuse-servers  --dry-run
 *
 * Exit codes: 0 pass · 1 verified blocking failure · 2 incomplete (Blocked/Inconclusive; per policy)
 *             3 infrastructure error (environment, credentials, server)
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const opt = (name: string, fallback: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};

const mode = opt("mode", "smoke");
const storiesArg = opt("stories", mode === "smoke" ? "affected" : "all");
const base = opt("base", process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : "origin/main");
const outDir = path.resolve(opt("output", "ci-output"));
const dryRun = flag("dry-run");
const reuse = flag("reuse-servers");
const aiConfig = JSON.parse(fs.readFileSync(path.join(ROOT, "config", "ai-testing.json"), "utf8"));
const policy = aiConfig.ci;
const maxTotalCost = Number(opt("max-cost", String(policy.maxTotalCostUsd)));
const API = "http://localhost:4000/api/lab";
const DEMO = "http://localhost:5173";

const children: ChildProcess[] = [];
const log = (...a: unknown[]) => console.log("[ci]", ...a);
const gh = (kind: "error" | "warning" | "notice", msg: string) => process.env.GITHUB_ACTIONS && console.log(`::${kind}::${msg.replace(/\r?\n/g, " ")}`);

class InfraError extends Error {}

async function call<T>(p: string, init?: RequestInit): Promise<T> {
  const res = await fetch(API + p, { ...init, headers: { "Content-Type": "application/json" } });
  const body = res.headers.get("content-type")?.includes("json") ? await res.json() : await res.text();
  if (!res.ok) throw new Error((body as any)?.error ?? String(body));
  return body as T;
}

async function waitFor(url: string, ms: number) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new InfraError(`Timed out waiting for ${url}`);
}

/** Start API server + demo app with isolated data/output directories. */
async function bootEnvironment() {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  if (reuse) {
    log("Reusing running servers (not isolated).");
    return;
  }
  const env = {
    ...process.env,
    AI_TEST_DATA_DIR: path.join(outDir, "data"), // fresh databases → seeded on first start
    AI_TEST_OUTPUT_DIR: outDir, // reports + artifacts land in the upload directory
    BROWSER_HEADLESS: "true",
    AI_MAX_COST_USD: String(maxTotalCost), // no single run may exceed the CI budget
  };
  const start = (name: string, args: string[]) => {
    const child = spawn(process.execPath, args, { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
    const logFile = fs.createWriteStream(path.join(outDir, `${name}.log`));
    child.stdout!.pipe(logFile);
    child.stderr!.pipe(logFile);
    children.push(child);
  };
  start("server", [path.join(ROOT, "node_modules/tsx/dist/cli.mjs"), "server/index.ts"]);
  start("demo-app", [path.join(ROOT, "node_modules/vite/bin/vite.js"), "--config", "apps/demo-app/vite.config.ts"]);
  await waitFor(`${API}/status`, 60_000);
  await waitFor(DEMO, 60_000);
  log("Environment up: API :4000, demo app :5173 (isolated data in", path.relative(ROOT, outDir) + ")");
}

function changedFiles(): string[] | null {
  try {
    const out = execFileSync("git", ["diff", "--name-only", `${base}...HEAD`], { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString();
    return out.split("\n").map((l) => l.trim()).filter(Boolean);
  } catch {
    return null;
  }
}

/** Affected-story detection: story files, their `covers` paths, regression memory, or core agent/config changes. */
function selectStories(stories: { id: string; file: string; covers: string[] }[]) {
  if (storiesArg === "all") return { ids: stories.map((s) => s.id), reason: "all stories requested" };
  if (storiesArg !== "affected") {
    const ids = storiesArg.split(",").map((s) => s.trim());
    const unknown = ids.filter((id) => !stories.some((s) => s.id === id));
    if (unknown.length) throw new InfraError(`Unknown stories: ${unknown.join(", ")}`);
    return { ids, reason: "explicit selection" };
  }
  const files = changedFiles();
  if (!files) return { ids: stories.map((s) => s.id), reason: `could not diff against ${base}; running all stories` };
  const all = files.find((f) => policy.runAllWhenChanged.some((p: string) => f.startsWith(p)) || f === "regression/scenarios.json");
  if (all) return { ids: stories.map((s) => s.id), reason: `${all} changed (affects every story)` };
  const ids = stories.filter((s) => files.some((f) => f === `stories/${s.file}` || s.covers.some((c) => f.startsWith(c)))).map((s) => s.id);
  return { ids, reason: ids.length ? `${files.length} changed file(s) match story coverage` : `none of ${files.length} changed file(s) is covered by a story` };
}

type RunRecord = { storyId: string; runId: string | null; status: string; costUsd: number; durationMs: number; happyPath: string | null; error?: string };

async function main(): Promise<number> {
  await bootEnvironment();
  const status = await call<any>("/status");
  if (!status.modes[mode]) throw new InfraError(`Unknown mode "${mode}".`);
  const stories = await call<any[]>("/stories");
  const selection = selectStories(stories);
  log(`Mode ${mode}: ${status.modes[mode].description}`);
  log(`Stories: ${selection.ids.join(", ") || "none"} (${selection.reason})`);
  log(`Budget: $${maxTotalCost} total, per run ≤ $${status.modes[mode].limits.maxCostUsd}`);

  const summary: any = {
    mode,
    selection,
    budgetUsd: maxTotalCost,
    commit: process.env.GITHUB_SHA ?? null,
    event: process.env.GITHUB_EVENT_NAME ?? "local",
    runs: [] as RunRecord[],
  };

  if (dryRun) {
    for (const id of selection.ids) {
      const s = await call<any>(`/stories/${id}`);
      const approved = s.regression.filter((r: any) => r.status === "approved");
      const rs = status.modes[mode].regression === "all" ? approved : status.modes[mode].regression === "critical" ? approved.filter((r: any) => r.critical) : [];
      log(`  ${id}: HP + ${rs.length} regression [${rs.map((r: any) => r.id).join(", ")}] + ${status.modes[mode].exploratoryCharters} exploratory charter(s)`);
    }
    writeSummary({ ...summary, dryRun: true }, null);
    return 0;
  }

  if (!status.ai.configured) throw new InfraError(`AI provider "${status.ai.provider}" has no API key. In GitHub, add it as an environment secret.`);
  if (!selection.ids.length) {
    writeSummary(summary, { verdict: "pass", exitCode: 0, blocking: [], incomplete: [], nonBlocking: [], advisory: [] });
    log("No affected stories — nothing to run.");
    return 0;
  }

  let spent = 0;
  for (const storyId of selection.ids) {
    const remaining = maxTotalCost - spent;
    if (remaining <= 0.001) {
      summary.runs.push({ storyId, runId: null, status: "not-run", costUsd: 0, durationMs: 0, happyPath: null, error: "CI cost budget exhausted" });
      continue;
    }
    let runId: string;
    try {
      ({ id: runId } = await call<{ id: string }>(`/stories/${storyId}/runs`, {
        method: "POST",
        body: JSON.stringify({ mode, resetData: true, maxCostUsd: Math.min(remaining, status.modes[mode].limits.maxCostUsd), trigger: `ci:${process.env.GITHUB_EVENT_NAME ?? "local"}` }),
      }));
    } catch (e: any) {
      throw new InfraError(`Could not start run for ${storyId}: ${e.message}`);
    }
    log(`${storyId}: run ${runId} started`);
    let run: any;
    for (;;) {
      await new Promise((r) => setTimeout(r, 4000));
      run = await call<any>(`/runs/${runId}`);
      if (!["queued", "running"].includes(run.status)) break;
    }
    const cost = run.cost?.totalUsd ?? 0;
    spent += cost;
    summary.runs.push({ storyId, runId, status: run.status, costUsd: cost, durationMs: run.durationMs ?? 0, happyPath: run.summary?.happyPath ?? null, error: run.error ?? undefined });
    log(`${storyId}: ${run.status}, gate ${run.gate?.verdict}, $${cost.toFixed(3)}, ${Math.round((run.durationMs ?? 0) / 1000)}s`);
  }

  const runIds = summary.runs.map((r: RunRecord) => r.runId).filter(Boolean);
  const gate = await call<any>("/gate", { method: "POST", body: JSON.stringify({ runIds }) });
  // Stories skipped for budget reasons are incomplete, never passed.
  for (const r of summary.runs as RunRecord[])
    if (!r.runId) gate.incomplete.push({ runId: "-", storyId: r.storyId, scenario: "(run)", reason: r.error });
  if (gate.verdict === "pass" && gate.incomplete.length) Object.assign(gate, { verdict: "incomplete", exitCode: policy.failOnIncomplete ? 2 : 0 });
  summary.totalCostUsd = spent;
  writeSummary(summary, gate);

  for (const b of gate.blocking) gh("error", `${b.storyId} ${b.scenario}: ${b.reason}`);
  for (const i of gate.incomplete) gh("warning", `Incomplete — ${i.storyId} ${i.scenario}: ${i.reason}`);
  for (const a of gate.advisory) gh("notice", `Advisory — ${a.storyId} ${a.scenario}: ${a.reason}`);
  log(`Gate: ${gate.verdict.toUpperCase()} → exit ${gate.exitCode}. Total cost $${spent.toFixed(3)}.`);
  return gate.exitCode;
}

function writeSummary(summary: any, gate: any) {
  summary.gate = gate;
  const md: string[] = [];
  const verdict = summary.dryRun ? "DRY RUN" : gate?.verdict?.toUpperCase();
  md.push(`## AI E2E — ${summary.mode} · ${verdict}`, "");
  md.push(`Stories: ${summary.selection.ids.join(", ") || "none"} — ${summary.selection.reason}`, "");
  if (summary.runs.length) {
    md.push("| Story | Run | Status | Happy Path | Cost | Duration |", "|---|---|---|---|---|---|");
    for (const r of summary.runs) md.push(`| ${r.storyId} | ${r.runId ?? "—"} | ${r.status} | ${r.happyPath ?? "—"} | $${r.costUsd.toFixed(3)} | ${Math.round(r.durationMs / 1000)}s |`);
    md.push("", `Total estimated cost: **$${(summary.totalCostUsd ?? 0).toFixed(3)}** of $${summary.budgetUsd} budget.`, "");
  }
  if (gate) {
    const section = (title: string, items: any[]) => items.length && md.push(`**${title}**`, ...items.map((i) => `- ${i.storyId} · ${i.scenario}: ${i.reason}`), "");
    section("❌ Blocking (verified failures)", gate.blocking);
    section("⚠️ Incomplete — not counted as success", gate.incomplete);
    section("Non-blocking verified failures", gate.nonBlocking);
    section("ℹ️ Advisory (suspected / exploratory findings)", gate.advisory);
    md.push(`Exit code ${gate.exitCode} (0 pass · 1 verified failure · 2 incomplete · 3 infrastructure). Full reports and screenshots are in the build artifacts.`);
  }
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "summary.md"), md.join("\n") + "\n");
  fs.writeFileSync(path.join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md.join("\n") + "\n");
  console.log("\n" + md.join("\n"));
}

let code = 3;
try {
  code = await main();
} catch (e: any) {
  const msg = e instanceof InfraError ? e.message : `Unexpected error: ${e?.stack ?? e}`;
  console.error("[ci] INFRASTRUCTURE ERROR:", msg);
  gh("error", `AI E2E infrastructure error: ${msg}`);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "summary.md"), `## AI E2E — ${mode} · INFRASTRUCTURE ERROR\n\n${msg}\n\nExit code 3. No test result was produced; this is not a pass.\n`);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## AI E2E — infrastructure error\n\n${msg}\n`);
  code = 3;
} finally {
  for (const c of children) c.kill();
}
process.exit(code);
