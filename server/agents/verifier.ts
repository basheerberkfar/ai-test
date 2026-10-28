import { z } from "zod";
import { getEvents, parseEvidenceIds } from "../execution/events.js";
import type { Completion, RawFinding, ScenarioOutcome } from "./context.js";
import type { ModelProvider } from "./providers/types.js";
import { structuredCall } from "./json.js";

export type VerifiedStatus = "Passed" | "Failed" | "Blocked" | "Inconclusive";

/**
 * Deterministic verification of a scenario result. The agent's claim is only accepted when
 * every expectation it marks as met/not met cites evidence that exists in this run.
 */
export function verifyScenario(runId: string, outcome: ScenarioOutcome): { status: VerifiedStatus; notes: string[]; expectations: Completion["expectations"] } {
  const notes: string[] = [];
  const c = outcome.completion;
  if (!c) {
    const status: VerifiedStatus = outcome.endReason === "error" || outcome.endReason === "cancelled" ? "Blocked" : "Inconclusive";
    notes.push(`Scenario did not complete (${outcome.endReason}${outcome.error ? `: ${outcome.error}` : ""}).`);
    return { status, notes, expectations: [] };
  }
  const exps = Array.isArray(c.expectations) ? c.expectations : [];
  const checked = exps.map((e) => {
    const ids = parseEvidenceIds(e.evidence_ids);
    const found = getEvents(runId, ids).filter((ev) => ev.scenario_key === outcome.brief.key);
    if (e.outcome !== "not_verified" && found.length === 0) {
      notes.push(`"${e.expectation}" was marked ${e.outcome} without valid evidence from this scenario; downgraded to not_verified.`);
      return { ...e, outcome: "not_verified" as const };
    }
    return e;
  });

  let status: VerifiedStatus;
  const claimed = c.status;
  if (claimed === "blocked") status = "Blocked";
  else if (checked.some((e) => e.outcome === "not_met")) status = "Failed";
  else if (checked.length === 0) {
    status = "Inconclusive";
    notes.push("No expectations were reported.");
  } else if (checked.some((e) => e.outcome === "not_verified")) status = "Inconclusive";
  else status = "Passed";

  // Expected results given to the agent must all be accounted for before a pass is accepted.
  if (status === "Passed" && outcome.brief.expectedResults.length > checked.length) {
    status = "Inconclusive";
    notes.push(`Only ${checked.length} of ${outcome.brief.expectedResults.length} expected results were reported.`);
  }
  if (claimed === "failed" && status !== "Failed") notes.push("Agent reported failure but no expectation was evidenced as not met.");
  if (claimed !== status.toLowerCase()) notes.push(`Agent claimed "${claimed}", verified status is ${status}.`);
  return { status, notes, expectations: checked };
}

const VerdictSchema = z.object({
  verdicts: z.array(
    z.object({
      index: z.number().int(),
      verdict: z.enum(["verified_defect", "suspected", "rejected"]),
      duplicate_of: z.number().int().nullable().default(null),
      rationale: z.string(),
    }),
  ),
});

const evidenceText = (ev: any) => {
  const d = ev.detail ?? {};
  const parts = [`E${ev.id} [${ev.kind}] ${ev.title}`];
  if (d.url) parts.push(`URL: ${d.url}`);
  if (d.network?.length) parts.push("API: " + d.network.map((n: any) => `${n.method} ${n.path} → ${n.status} req=${(n.requestBody ?? "").slice(0, 300)} res=${(n.responseBody ?? "").slice(0, 300)}`).join(" | "));
  if (d.response) parts.push(`Response ${d.response.status}: ${String(d.response.body).slice(0, 800)}`);
  if (d.outline) parts.push(`Page:\n${String(d.outline).slice(0, 1500)}`);
  return parts.join("\n");
};

/**
 * Independent LLM review of findings against the recorded evidence only (no browser access).
 * A finding is a verified defect only if the cited evidence itself demonstrates it.
 */
export async function verifyFindings(provider: ModelProvider, runId: string, findings: RawFinding[]) {
  if (!findings.length) return { verdicts: [] as z.infer<typeof VerdictSchema>["verdicts"], usage: null };
  const blocks = findings.map((f, i) => {
    const evs = getEvents(runId, parseEvidenceIds(f.evidence_ids));
    return [
      `### Finding ${i}: ${f.title} (severity ${f.severity}, observed ${f.times_observed}x, scenario ${f.scenarioKey})`,
      `Expected: ${f.expected}`,
      `Actual (claimed): ${f.actual}`,
      `Steps: ${(f.steps_to_reproduce ?? []).join(" / ")}`,
      `Cited evidence (${evs.length} of ${(f.evidence_ids ?? []).length} ids found):`,
      evs.map(evidenceText).join("\n---\n") || "(none)",
    ].join("\n");
  });
  const prompt = [
    "You are an independent reviewer. A browser QA agent reported the findings below. Judge each ONLY against the cited evidence.",
    "- verified_defect: the evidence itself clearly shows the actual behavior and that it contradicts a reasonable expectation.",
    "- suspected: plausible but the evidence is incomplete or ambiguous.",
    "- rejected: the evidence contradicts the claim, or the expectation is unreasonable / not a defect.",
    "Mark duplicate_of with the index of an earlier finding describing the same root defect, else null.",
    "",
    ...blocks,
    "",
    'Return {"verdicts": [{"index", "verdict", "duplicate_of", "rationale"}]} with one entry per finding.',
  ].join("\n");
  const res = await structuredCall(provider, "You verify QA findings strictly from evidence. Respond with JSON only.", prompt, VerdictSchema);
  return { verdicts: res.data.verdicts, usage: res.usage };
}
