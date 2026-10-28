import fs from "node:fs";
import { z } from "zod";
import { paths } from "../config.js";

/**
 * Persistent regression memory (regression/scenarios.json).
 * Rules: scenarios are never deleted (only rejected/retired), every change is appended to
 * history, and approved expectations only change through an explicitly approved revision.
 */

export const ScenarioFieldsSchema = z.object({
  title: z.string().min(3),
  description: z.string().min(1),
  preconditions: z.array(z.string()).default([]),
  steps: z.array(z.string().min(1)).min(1),
  expectedResults: z.array(z.string().min(1)).min(1),
});
export type ScenarioFields = z.infer<typeof ScenarioFieldsSchema>;

export type ScenarioStatus = "proposed" | "approved" | "rejected" | "retired";
export type HistoryEntry = { at: string; action: string; actor: string; note?: string; before?: Partial<ScenarioFields>; after?: Partial<ScenarioFields> };
export type Scenario = ScenarioFields & {
  id: string;
  storyId: string;
  status: ScenarioStatus;
  /** Critical scenarios run in smoke mode (pull requests) and gate CI when they fail. */
  critical?: boolean;
  discoverySource: { type: "ai-exploration" | "manual"; runId?: string; scenarioKey?: string; findingTitle?: string };
  evidence: { label: string; screenshot?: string; eventId?: number }[];
  pendingRevision: (ScenarioFields & { proposedAt: string; proposedBy: string; reason?: string }) | null;
  createdAt: string;
  updatedAt: string;
  history: HistoryEntry[];
};

type File = { version: 1; scenarios: Scenario[] };

function load(): File {
  if (!fs.existsSync(paths.regression)) return { version: 1, scenarios: [] };
  return JSON.parse(fs.readFileSync(paths.regression, "utf8"));
}
function save(f: File) {
  const tmp = paths.regression + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(f, null, 2) + "\n");
  fs.renameSync(tmp, paths.regression);
}

const ts = () => new Date().toISOString();
const pick = (s: ScenarioFields): ScenarioFields => ({
  title: s.title,
  description: s.description,
  preconditions: s.preconditions,
  steps: s.steps,
  expectedResults: s.expectedResults,
});

export function listScenarios(filter?: { storyId?: string; status?: ScenarioStatus }) {
  return load().scenarios.filter(
    (s) => (!filter?.storyId || s.storyId === filter.storyId) && (!filter?.status || s.status === filter.status),
  );
}
export const approvedScenarios = (storyId: string, only: "all" | "critical" | "none" = "all") =>
  only === "none" ? [] : listScenarios({ storyId, status: "approved" }).filter((s) => only === "all" || s.critical);
export const getScenario = (id: string) => load().scenarios.find((s) => s.id === id) ?? null;

function nextId(f: File) {
  const max = f.scenarios.reduce((m, s) => Math.max(m, Number(s.id.replace(/\D/g, "")) || 0), 0);
  return `RS-${String(max + 1).padStart(3, "0")}`;
}

export function proposeScenario(input: {
  storyId: string;
  fields: ScenarioFields;
  discoverySource: Scenario["discoverySource"];
  evidence?: Scenario["evidence"];
  actor: string;
}): Scenario {
  const f = load();
  const fields = ScenarioFieldsSchema.parse(input.fields);
  const scenario: Scenario = {
    id: nextId(f),
    storyId: input.storyId,
    status: "proposed", // AI and manual scenarios alike need explicit approval
    ...fields,
    discoverySource: input.discoverySource,
    evidence: input.evidence ?? [],
    pendingRevision: null,
    createdAt: ts(),
    updatedAt: ts(),
    history: [{ at: ts(), action: "proposed", actor: input.actor, after: fields }],
  };
  f.scenarios.push(scenario);
  save(f);
  return scenario;
}

function mutate(id: string, fn: (s: Scenario) => void) {
  const f = load();
  const s = f.scenarios.find((x) => x.id === id);
  if (!s) throw new Error(`Scenario ${id} not found.`);
  fn(s);
  s.updatedAt = ts();
  save(f);
  return s;
}

export function approveScenario(id: string, actor: string, note?: string) {
  return mutate(id, (s) => {
    if (s.status !== "proposed" && s.status !== "rejected") throw new Error(`Only proposed or rejected scenarios can be approved (current: ${s.status}).`);
    s.status = "approved";
    s.history.push({ at: ts(), action: "approved", actor, note });
  });
}

export function setCritical(id: string, critical: boolean, actor: string) {
  return mutate(id, (s) => {
    if (!!s.critical === critical) return;
    s.critical = critical;
    s.history.push({ at: ts(), action: critical ? "marked_critical" : "unmarked_critical", actor });
  });
}

export function rejectScenario(id: string, actor: string, note?: string) {
  return mutate(id, (s) => {
    if (s.status !== "proposed") throw new Error(`Only proposed scenarios can be rejected (current: ${s.status}). Retire approved scenarios instead.`);
    s.status = "rejected";
    s.history.push({ at: ts(), action: "rejected", actor, note });
  });
}

export function retireScenario(id: string, actor: string, note: string) {
  return mutate(id, (s) => {
    if (s.status !== "approved") throw new Error("Only approved scenarios can be retired.");
    if (!note?.trim()) throw new Error("A reason is required to retire a scenario.");
    s.status = "retired";
    s.history.push({ at: ts(), action: "retired", actor, note });
  });
}

/**
 * Edit a scenario. Proposed scenarios are edited in place. Approved scenarios get a
 * pending revision that only takes effect after explicit approval.
 */
export function editScenario(id: string, input: unknown, actor: string, reason?: string) {
  const fields = ScenarioFieldsSchema.parse(input);
  return mutate(id, (s) => {
    if (s.status === "approved") {
      s.pendingRevision = { ...fields, proposedAt: ts(), proposedBy: actor, reason };
      s.history.push({ at: ts(), action: "revision_proposed", actor, note: reason, before: pick(s), after: fields });
    } else if (s.status === "proposed") {
      s.history.push({ at: ts(), action: "edited", actor, note: reason, before: pick(s), after: fields });
      Object.assign(s, fields);
    } else {
      throw new Error(`Scenarios in status ${s.status} cannot be edited.`);
    }
  });
}

export function resolveRevision(id: string, accept: boolean, actor: string, note?: string) {
  return mutate(id, (s) => {
    if (!s.pendingRevision) throw new Error("No pending revision.");
    const { proposedAt: _a, proposedBy: _b, reason: _c, ...fields } = s.pendingRevision;
    if (accept) {
      s.history.push({ at: ts(), action: "revision_approved", actor, note, before: pick(s), after: fields });
      Object.assign(s, fields);
    } else {
      s.history.push({ at: ts(), action: "revision_rejected", actor, note });
    }
    s.pendingRevision = null;
  });
}
