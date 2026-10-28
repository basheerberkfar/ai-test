import type { Environment, ExecutionMode, ModelTier, Role } from "../config.js";
import type { Story } from "../stories/store.js";
import type { ModelProvider } from "./providers/types.js";
import type { CostManager } from "./cost.js";

export { BudgetExceeded } from "./cost.js";

export type ScenarioKind = "happy_path" | "regression" | "exploratory";

export type ScenarioBrief = {
  key: string; // HP, RS-001, EX-1
  kind: ScenarioKind;
  title: string;
  instructions: string;
  expectedResults: string[];
  critical: boolean; // gates CI when it fails
};

export type Expectation = {
  expectation: string;
  outcome: "met" | "not_met" | "not_verified";
  observed: string;
  evidence_ids: string[];
  acceptance_criterion?: number;
};

export type Completion = {
  status: "passed" | "failed" | "blocked" | "inconclusive";
  summary: string;
  expectations: Expectation[];
};

export type RawFinding = {
  scenarioKey: string;
  title: string;
  severity: string;
  expected: string;
  actual: string;
  steps_to_reproduce: string[];
  evidence_ids: string[];
  times_observed: number;
};

export type RawProposal = {
  scenarioKey: string;
  title: string;
  description: string;
  preconditions: string[];
  steps: string[];
  expected_results: string[];
  evidence_ids: string[];
  related_finding?: string;
};

export type ScenarioOutcome = {
  brief: ScenarioBrief;
  completion: Completion | null;
  stepsUsed: number;
  actions: number;
  browserMs: number;
  model: string;
  attempts: number;
  endReason: "completed" | "step_limit" | "budget" | "cancelled" | "error" | "no_progress";
  error?: string;
  startedAt: string;
  finishedAt: string;
};

export type RunContext = {
  runId: string;
  mode: ExecutionMode;
  story: Story;
  env: Environment;
  testDataTag: string;
  cost: CostManager;
  /** Metered provider for a role (tier from routing config unless overridden). */
  providerFor: (role: Role, scenarioKey: string | null, tier?: ModelTier) => ModelProvider;
  findings: RawFinding[];
  proposals: RawProposal[];
  isCancelled: () => boolean;
  setCurrent: (scenarioKey: string | null) => void;
};
