import { Badge } from "@ui/ui";

export async function lab<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api/lab${path}`, { ...init, headers: { "Content-Type": "application/json", ...init.headers } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body as T;
}
export const post = <T,>(path: string, body?: unknown) => lab<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) });
export const put = <T,>(path: string, body?: unknown) => lab<T>(path, { method: "PUT", body: JSON.stringify(body ?? {}) });

export type Story = {
  id: string;
  title: string;
  priority: string;
  appUrl: string;
  role: string;
  description: string;
  acceptanceCriteria: string[];
  happyPath: string[];
  file: string;
};

export type ScenarioFields = { title: string; description: string; preconditions: string[]; steps: string[]; expectedResults: string[] };
export type Scenario = ScenarioFields & {
  id: string;
  storyId: string;
  critical?: boolean;
  status: "proposed" | "approved" | "rejected" | "retired";
  discoverySource: { type: string; runId?: string; scenarioKey?: string; findingTitle?: string };
  evidence: { label: string; screenshot?: string; eventId?: number }[];
  pendingRevision: (ScenarioFields & { proposedAt: string; proposedBy: string; reason?: string }) | null;
  createdAt: string;
  updatedAt: string;
  history: { at: string; action: string; actor: string; note?: string; before?: Partial<ScenarioFields>; after?: Partial<ScenarioFields> }[];
};

export type Run = {
  id: string;
  storyId: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  phase: string | null;
  currentScenario: string | null;
  provider: string;
  model: string;
  environmentId: string;
  options: any;
  plan: any;
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; costUsd: number | null; actions: number; modelCalls: number } | null;
  summary: any;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  mode: "smoke" | "regression" | "exploratory";
  trigger: string | null;
  metadata: any;
  cost: { totalUsd: number; budgetUsd: number; modelUsd: number; browserUsd: number; toolUsd: number; modelCalls: number; actions: number; scenarioRetries: number; unpricedCalls: number; servedModels: string[] } | null;
};

export const runCost = (r: Pick<Run, "cost" | "usage">) => r.cost?.totalUsd ?? r.usage?.costUsd ?? null;

const modeTone = { smoke: "blue", regression: "purple", exploratory: "orange" } as const;
export const ModeBadge = ({ mode }: { mode: string }) => <Badge tone={modeTone[mode as keyof typeof modeTone] ?? "neutral"}>{mode}</Badge>;

const gateTone = { pass: "green", fail: "red", incomplete: "orange" } as const;
export const GateBadge = ({ verdict }: { verdict?: string | null }) =>
  verdict ? <Badge tone={gateTone[verdict as keyof typeof gateTone] ?? "neutral"}>gate: {verdict}</Badge> : null;

export type RunEvent = { id: number; ts: string; scenarioKey: string | null; kind: string; title: string; detail: any; screenshot: string | null };

export const fmtDuration = (ms?: number | null) => {
  if (ms == null) return "—";
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
};
export const fmtCost = (c?: number | null) => (c == null ? "—" : `$${c.toFixed(c < 1 ? 3 : 2)}`);
export const fmtPct = (v?: number | null) => (v == null ? "—" : `${Math.round(v * 100)}%`);
export const fmtTime = (iso?: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");

const resultTone = { Passed: "green", Failed: "red", Blocked: "orange", Inconclusive: "purple" } as const;
export const ResultBadge = ({ status }: { status: string }) => (
  <Badge tone={resultTone[status as keyof typeof resultTone] ?? "neutral"} dot>
    {status}
  </Badge>
);

const runTone = { queued: "neutral", running: "blue", completed: "green", failed: "red", cancelled: "orange" } as const;
export const RunStatusBadge = ({ status }: { status: string }) => (
  <Badge tone={runTone[status as keyof typeof runTone] ?? "neutral"} dot>
    {status === "running" ? <span className="flex items-center gap-1">running</span> : status}
  </Badge>
);

const scenarioTone = { proposed: "blue", approved: "green", rejected: "neutral", retired: "orange" } as const;
export const ScenarioStatusBadge = ({ status }: { status: string }) => <Badge tone={scenarioTone[status as keyof typeof scenarioTone] ?? "neutral"}>{status}</Badge>;

const classTone = { verified_defect: "red", suspected: "orange", rejected: "neutral" } as const;
const classLabel = { verified_defect: "Verified defect", suspected: "Suspected", rejected: "Rejected" } as const;
export const ClassificationBadge = ({ c }: { c: string }) => (
  <Badge tone={classTone[c as keyof typeof classTone] ?? "neutral"}>{classLabel[c as keyof typeof classLabel] ?? c}</Badge>
);
