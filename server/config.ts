import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// AI_TEST_DATA_DIR / AI_TEST_OUTPUT_DIR isolate databases and evidence (used by CI).
const outputDir = process.env.AI_TEST_OUTPUT_DIR ? path.resolve(process.env.AI_TEST_OUTPUT_DIR) : ROOT;
export const paths = {
  root: ROOT,
  data: process.env.AI_TEST_DATA_DIR ? path.resolve(process.env.AI_TEST_DATA_DIR) : path.join(ROOT, "data"),
  artifacts: path.join(outputDir, "artifacts"),
  reports: path.join(outputDir, "reports"),
  aiTesting: path.join(ROOT, "config", "ai-testing.json"),
  stories: path.join(ROOT, "stories"),
  regression: path.join(ROOT, "regression", "scenarios.json"),
  prompts: path.join(ROOT, "prompts"),
  sutConfig: path.join(ROOT, "config", "sut.json"),
  environments: path.join(ROOT, "config", "environments.json"),
  // Read ONLY by server/evaluation. Never passed to the agent.
  hiddenBugs: path.join(ROOT, "evaluation", "hidden-bugs.json"),
};
for (const dir of [paths.data, paths.artifacts, paths.reports]) fs.mkdirSync(dir, { recursive: true });

const num = (name: string, fallback: number) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

export const settings = {
  port: num("SERVER_PORT", 4000),
  provider: (process.env.AI_PROVIDER || "anthropic").toLowerCase() as "anthropic" | "openai",
  effort: process.env.AI_EFFORT || "medium",
  anthropicFallbacks: (process.env.ANTHROPIC_FALLBACKS || "default") !== "off",
  chromePath: process.env.CHROME_PATH || "",
  headless: (process.env.BROWSER_HEADLESS || "true") !== "false",
};

// ---------------------------------------------------------------------------
// AI testing configuration (config/ai-testing.json)
// ---------------------------------------------------------------------------

export type ModelTier = "economy" | "advanced";
export type Role = "planner" | "executor" | "explorer" | "verifier";
export type ExecutionMode = "smoke" | "regression" | "exploratory";
export const MODES: ExecutionMode[] = ["smoke", "regression", "exploratory"];

export type Limits = {
  stepsPerScenario: number;
  maxModelCalls: number;
  maxBrowserActions: number;
  maxScenarioRetries: number;
  apiRetries: number;
  runMinutes: number;
  maxCostUsd: number;
  screenshotsToModelPerScenario: number;
  outlineMaxChars: number;
};
export type Pricing = { input: number; output: number; cacheRead: number; cacheWrite: number };
export type AiTestingConfig = {
  pricing: {
    models: Record<string, Pricing>;
    infrastructure: { browserPerMinuteUsd: number; perBrowserActionUsd: number; perScreenshotToModelUsd: number; ciRunnerPerMinuteUsd: number };
  };
  routing: Record<"anthropic" | "openai", Record<ModelTier, string>> & { roles: Record<Role, ModelTier>; escalateIncompleteToAdvanced: boolean };
  limits: Limits;
  modes: Record<ExecutionMode, { description: string; regression: "all" | "critical" | "none"; exploratoryCharters: number; plan: boolean; limits: Partial<Limits> }>;
  ci: {
    failOnVerifiedFailures: boolean;
    failOnIncomplete: boolean;
    blockingFindingSeverities: string[];
    exploratoryFindingsBlocking: boolean;
    maxTotalCostUsd: number;
    runAllWhenChanged: string[];
  };
  baseline: {
    engineerHourlyUsd: number;
    authoringHoursPerScenario: number;
    maintenanceHoursPerScenarioPerMonth: number;
    uiChangeBreakageHoursPerScenario: number;
    uiChangesPerMonth: number;
    ciMinutesPerScenarioRun: number;
    aiReviewHoursPerProposal: number;
    aiReviewHoursPerIncompleteRun: number;
    runsPerMonth: Record<ExecutionMode, number>;
  };
};

/** Re-read on every call so edits apply to the next run without a restart. */
export function readAiConfig(): AiTestingConfig {
  const cfg: AiTestingConfig = JSON.parse(fs.readFileSync(paths.aiTesting, "utf8"));
  // Env overrides (single model for every role, or per tier).
  const p = settings.provider;
  if (process.env.AI_MODEL) cfg.routing[p] = { economy: process.env.AI_MODEL, advanced: process.env.AI_MODEL };
  if (process.env.AI_MODEL_ECONOMY) cfg.routing[p].economy = process.env.AI_MODEL_ECONOMY;
  if (process.env.AI_MODEL_ADVANCED) cfg.routing[p].advanced = process.env.AI_MODEL_ADVANCED;
  if (process.env.AI_MAX_COST_USD) cfg.limits.maxCostUsd = num("AI_MAX_COST_USD", cfg.limits.maxCostUsd);
  return cfg;
}

/** Effective limits for a mode: global defaults < mode overrides < explicit run overrides. Env cost cap always wins if lower. */
export function limitsForMode(mode: ExecutionMode, overrides: Partial<Limits> = {}): Limits {
  const cfg = readAiConfig();
  const merged = { ...cfg.limits, ...cfg.modes[mode].limits, ...overrides };
  if (process.env.AI_MAX_COST_USD) merged.maxCostUsd = Math.min(merged.maxCostUsd, num("AI_MAX_COST_USD", merged.maxCostUsd));
  return merged;
}

export function modelFor(provider: "anthropic" | "openai", role: Role, tier?: ModelTier) {
  const cfg = readAiConfig();
  return cfg.routing[provider][tier ?? cfg.routing.roles[role]];
}

export type SutConfig = { uiVariant: "classic" | "refresh"; bugs: Record<string, boolean> };

/** System-under-test configuration. Re-read on every call so toggles apply without restart. */
export function readSutConfig(): SutConfig {
  return JSON.parse(fs.readFileSync(paths.sutConfig, "utf8"));
}
export function writeSutConfig(cfg: SutConfig) {
  fs.writeFileSync(paths.sutConfig, JSON.stringify(cfg, null, 2) + "\n");
}
export const bugOn = (id: string) => readSutConfig().bugs[id] === true;

export type Environment = {
  id: string;
  name: string;
  baseUrl: string;
  allowedOrigins: string[];
  apiPathPrefix: string;
  authTokenStorageKey: string;
  resettable: boolean;
  accounts: Record<string, { emailEnv: string; passwordEnv: string }>;
};

export function readEnvironments(): Environment[] {
  return JSON.parse(fs.readFileSync(paths.environments, "utf8")).environments;
}

/** Resolve the authorized environment for a story URL. Throws if the URL is not explicitly allowed. */
export function resolveEnvironment(appUrl: string): Environment {
  const origin = new URL(appUrl).origin;
  const env = readEnvironments().find((e) => e.allowedOrigins.includes(origin));
  if (!env) throw new Error(`Target ${origin} is not an authorized test environment (see config/environments.json).`);
  return env;
}

export function accountCredentials(env: Environment, role: string) {
  const acc = env.accounts[role.toLowerCase()];
  if (!acc) return null;
  const email = process.env[acc.emailEnv];
  const password = process.env[acc.passwordEnv];
  if (!email || !password) return null;
  return { email, password };
}
