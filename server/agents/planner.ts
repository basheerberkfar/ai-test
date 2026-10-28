import { z } from "zod";
import type { Story } from "../stories/store.js";
import type { Scenario } from "../regression/store.js";
import type { ModelProvider } from "./providers/types.js";
import { structuredCall } from "./json.js";

/**
 * Planning is separated from execution: the planner never touches the browser. Mandatory
 * scenarios (Happy Path + every approved regression scenario) are fixed by code; the planner only
 * adds execution notes and chooses exploratory charters.
 */

const RunPlanSchema = z.object({
  summary: z.string(),
  risks: z.array(z.string()).default([]),
  happyPathNotes: z.string().default(""),
  testData: z.string().default(""),
  regressionNotes: z.array(z.object({ id: z.string(), notes: z.string() })).default([]),
});
export type RunPlan = z.infer<typeof RunPlanSchema>;

const ExplorationPlanSchema = z.object({
  charters: z
    .array(
      z.object({
        title: z.string(),
        charter: z.string(),
        rationale: z.string(),
        priority: z.number().int().min(1).max(5),
      }),
    )
    .min(1),
});
export type Charter = z.infer<typeof ExplorationPlanSchema>["charters"][number];

const SYSTEM =
  "You are a senior QA lead planning AI-driven browser testing. You reason from the user story only. Respond with a single JSON object and nothing else.";

const storyBlock = (s: Story) =>
  [
    `Story ${s.id}: ${s.title} (priority ${s.priority}, role ${s.role})`,
    s.description,
    "Acceptance criteria:",
    ...s.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`),
    "Mandatory happy path:",
    ...s.happyPath.map((c, i) => `${i + 1}. ${c}`),
  ].join("\n");

export async function planRun(provider: ModelProvider, story: Story, regression: Scenario[]) {
  const prompt = [
    storyBlock(story),
    "",
    "Approved regression scenarios (all must be executed):",
    regression.length ? regression.map((r) => `- ${r.id}: ${r.title}\n  Steps: ${r.steps.join(" / ")}\n  Expected: ${r.expectedResults.join(" / ")}`).join("\n") : "(none yet)",
    "",
    "Produce a JSON object with:",
    '- "summary": one paragraph describing the overall test approach',
    '- "risks": the main product risks for this story',
    '- "happyPathNotes": how to execute and independently verify the happy path (which fields to check, how to confirm persistence)',
    '- "testData": the valid test data to use for creation (all fields), unique and realistic',
    '- "regressionNotes": [{"id": "RS-…", "notes": "execution hints"}] for each approved regression scenario',
  ].join("\n");
  return structuredCall(provider, SYSTEM, prompt, RunPlanSchema);
}

export async function planExploration(provider: ModelProvider, story: Story, observations: string, maxCharters: number) {
  const prompt = [
    storyBlock(story),
    "",
    "What the mandatory scenarios observed in this run (from the real application):",
    observations,
    "",
    `Choose up to ${maxCharters} exploratory testing charters that are most likely to reveal real defects for THIS story.`,
    "Consider invalid/empty/very long inputs, duplicate submissions, refresh/back navigation, network failures,",
    "authorization boundaries between roles (UI and API), search/filter consistency, narrow viewports and unexpected states.",
    "Each charter must be specific and executable in about 30 browser actions. Do not repeat what the mandatory scenarios already verified.",
    'Return {"charters": [{"title", "charter", "rationale", "priority": 1-5 (5 = most important)}]}',
  ].join("\n");
  const res = await structuredCall(provider, SYSTEM, prompt, ExplorationPlanSchema);
  res.data.charters = res.data.charters.sort((a, b) => b.priority - a.priority).slice(0, maxCharters);
  return res;
}
