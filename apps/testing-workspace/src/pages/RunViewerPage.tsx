import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertOctagon,
  Bug,
  ChevronDown,
  ChevronLeft,
  CircleDot,
  Download,
  Globe,
  Image as ImageIcon,
  Lightbulb,
  ListChecks,
  MessageSquareText,
  MousePointerClick,
  Square,
  Terminal,
} from "lucide-react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, cn, Dialog, DialogContent, EmptyState, Segmented, Select, Skeleton, Spinner, Table, Td, Th, Tr } from "@ui/ui";
import { ClassificationBadge, fmtCost, fmtDuration, fmtTime, GateBadge, lab, ModeBadge, post, ResultBadge, runCost, RunStatusBadge, type Run, type RunEvent } from "../lib";

type RunDetail = Run & { results: any[]; findings: any[]; liveScreenshot: string | null; costByScenario: any[]; gate: any | null };

function useRunEvents(runId: string, live: boolean) {
  const [events, setEvents] = useState<RunEvent[]>([]);
  const cursor = useRef(0);
  useEffect(() => {
    setEvents([]);
    cursor.current = 0;
  }, [runId]);
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        for (;;) {
          const batch = await lab<RunEvent[]>(`/runs/${runId}/events?after=${cursor.current}`);
          if (!batch.length || stop) break;
          cursor.current = batch[batch.length - 1].id;
          setEvents((e) => [...e, ...batch]);
          if (batch.length < 500) break;
        }
      } catch {}
    };
    tick();
    const t = live ? setInterval(tick, 1500) : undefined;
    return () => {
      stop = true;
      if (t) clearInterval(t);
    };
  }, [runId, live]);
  return events;
}

const kindMeta: Record<string, { icon: any; color: string; label: string }> = {
  system: { icon: CircleDot, color: "#86868b", label: "System" },
  plan: { icon: ListChecks, color: "#5856D6", label: "Plan" },
  reasoning: { icon: MessageSquareText, color: "#007AFF", label: "Agent" },
  action: { icon: MousePointerClick, color: "#1D1D1F", label: "Action" },
  observation: { icon: Globe, color: "#30B0C7", label: "Check" },
  network: { icon: Globe, color: "#8E8E93", label: "Network" },
  console: { icon: Terminal, color: "#FF9500", label: "Console" },
  result: { icon: ListChecks, color: "#34C759", label: "Result" },
  finding: { icon: Bug, color: "#FF3B30", label: "Finding" },
  proposal: { icon: Lightbulb, color: "#AF52DE", label: "Proposal" },
  error: { icon: AlertOctagon, color: "#FF3B30", label: "Error" },
};

const filters = {
  all: () => true,
  actions: (e: RunEvent) => ["action", "observation", "reasoning"].includes(e.kind),
  network: (e: RunEvent) => e.kind === "network" || e.kind === "console",
  findings: (e: RunEvent) => ["finding", "proposal", "result", "error"].includes(e.kind),
};

function Shot({ src, className }: { src: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <button type="button" onClick={() => setOpen(true)} className={cn("overflow-hidden rounded-lg ring-1 ring-hairline transition hover:ring-accent", className)}>
        <img src={`/artifacts/${src}`} alt="screenshot" className="w-full" loading="lazy" />
      </button>
      <DialogContent title="Screenshot" className="max-w-5xl">
        <img src={`/artifacts/${src}`} alt="screenshot" className="w-full rounded-lg ring-1 ring-hairline" />
      </DialogContent>
    </Dialog>
  );
}

function EventRow({ e }: { e: RunEvent }) {
  const [open, setOpen] = useState(false);
  const meta = kindMeta[e.kind] ?? kindMeta.system;
  const d = e.detail ?? {};
  const expandable = !!(e.screenshot || d.outline || d.network?.length || d.response || (e.kind === "plan" && d) || e.kind === "finding" || e.kind === "proposal" || d.notes?.length);
  return (
    <li className={cn("group border-t border-hairline first:border-t-0", e.kind === "reasoning" && "bg-accent/[0.025]")}>
      <button type="button" disabled={!expandable} onClick={() => setOpen(!open)} className="flex w-full items-start gap-3 px-4 py-2.5 text-left">
        <meta.icon className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: meta.color }} />
        <span className="w-16 shrink-0 font-mono text-[11px] leading-5 text-subtle">E{e.id}</span>
        <span className={cn("min-w-0 flex-1 text-[13px] leading-5", e.kind === "reasoning" ? "italic text-ink/80" : e.kind === "network" ? "font-mono text-[12px] text-muted" : "")}>
          {e.scenarioKey && <span className="mr-1.5 rounded bg-fill px-1 font-mono text-[10.5px] not-italic text-muted">{e.scenarioKey}</span>}
          {e.title}
        </span>
        {e.screenshot && <ImageIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-subtle" />}
        <span className="shrink-0 font-mono text-[11px] leading-5 text-subtle">{new Date(e.ts).toLocaleTimeString()}</span>
        {expandable && <ChevronDown className={cn("mt-0.5 h-3.5 w-3.5 shrink-0 text-subtle transition-transform", open && "rotate-180")} />}
      </button>
      {open && (
        <div className="grid gap-3 px-4 pb-4 pl-[104px] animate-fade-in md:grid-cols-[1fr_280px]">
          <div className="min-w-0 space-y-2">
            {d.url && <p className="truncate font-mono text-[11.5px] text-muted">{d.url}</p>}
            {d.network?.length > 0 && (
              <div className="rounded-lg bg-canvas p-2 font-mono text-[11.5px]">
                {d.network.map((n: any, i: number) => (
                  <div key={i}>
                    <span className={n.status >= 400 || n.status === 0 ? "text-danger" : "text-[#248a3d]"}>{n.status || "ERR"}</span> {n.method} {n.path}
                    {n.requestBody && <div className="truncate text-muted">→ {n.requestBody}</div>}
                    {n.responseBody && <div className="truncate text-muted">← {n.responseBody}</div>}
                  </div>
                ))}
              </div>
            )}
            {d.response && <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-canvas p-2 font-mono text-[11.5px]">HTTP {d.response.status}{"\n"}{d.response.body}</pre>}
            {d.outline && (
              <details>
                <summary className="cursor-pointer text-[12px] font-medium text-muted">Page outline seen by the agent</summary>
                <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-canvas p-2 font-mono text-[11px] leading-relaxed">{d.outline}</pre>
              </details>
            )}
            {(e.kind === "finding" || e.kind === "proposal" || e.kind === "plan" || d.notes) && !d.outline && (
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-canvas p-2 font-mono text-[11px]">{JSON.stringify(d, null, 2)}</pre>
            )}
          </div>
          {e.screenshot && <Shot src={e.screenshot} />}
        </div>
      )}
    </li>
  );
}

function ScenarioResultCard({ r }: { r: any }) {
  return (
    <Card>
      <CardHeader>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[12px] text-muted">{r.scenario_key}</span>
            <Badge>{r.kind.replace("_", " ")}</Badge>
          </div>
          <CardTitle className="mt-1">{r.title}</CardTitle>
        </div>
        <div className="flex flex-col items-end gap-1">
          <ResultBadge status={r.status} />
          {r.agent_status && r.agent_status !== r.status.toLowerCase() && <span className="text-[11px] text-muted">agent said: {r.agent_status}</span>}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {r.summary && <p className="text-[13.5px] leading-relaxed text-ink/85">{r.summary}</p>}
        {r.expectations?.length > 0 && (
          <Table>
            <thead>
              <tr>
                <Th className="px-2">Expected</Th>
                <Th className="px-2">Outcome</Th>
                <Th className="px-2">Observed</Th>
                <Th className="px-2">Evidence</Th>
              </tr>
            </thead>
            <tbody>
              {r.expectations.map((x: any, i: number) => (
                <Tr key={i}>
                  <Td className="px-2 py-2 text-[12.5px]">
                    {x.acceptance_criterion ? <span className="mr-1 font-mono text-[10.5px] text-muted">AC{x.acceptance_criterion}</span> : null}
                    {x.expectation}
                  </Td>
                  <Td className="px-2 py-2">
                    <Badge tone={x.outcome === "met" ? "green" : x.outcome === "not_met" ? "red" : "purple"}>{x.outcome.replace("_", " ")}</Badge>
                  </Td>
                  <Td className="px-2 py-2 text-[12.5px] text-muted">{x.observed}</Td>
                  <Td className="px-2 py-2 font-mono text-[11px] text-muted">{(x.evidence_ids ?? []).join(" ")}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
        {r.verificationNotes?.length > 0 && (
          <div className="rounded-lg bg-warning/8 p-2.5 text-[12.5px]">
            {r.verificationNotes.map((n: string, i: number) => (
              <p key={i}>Verifier: {n}</p>
            ))}
          </div>
        )}
        <p className="text-[11.5px] text-subtle">
          {r.critical ? "critical · " : ""}
          {r.model ?? "—"}
          {r.attempts > 1 ? ` (attempt ${r.attempts}, escalated)` : ""} · {r.steps_used} model steps · {r.actions ?? 0} browser actions · {fmtDuration(r.browser_ms)} browser time ·{" "}
          <span className="font-medium text-ink">{fmtCost(r.cost_usd)}</span>
        </p>
      </CardContent>
    </Card>
  );
}

function FindingCard({ f }: { f: any }) {
  return (
    <Card className={cn(f.eval_label === "duplicate" && "opacity-60")}>
      <CardHeader>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <ClassificationBadge c={f.classification} />
            <Badge tone={f.severity === "critical" || f.severity === "high" ? "red" : f.severity === "medium" ? "orange" : "neutral"}>{f.severity}</Badge>
            <span className="font-mono text-[11.5px] text-muted">found in {f.scenario_key}</span>
            {f.eval_label === "duplicate" && <Badge>duplicate</Badge>}
          </div>
          <CardTitle className="mt-1.5">{f.title}</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-[13.5px]">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-xl bg-success/6 p-3">
            <p className="text-[11.5px] font-medium uppercase tracking-wide text-[#248a3d]">Expected</p>
            <p className="mt-1">{f.expected}</p>
          </div>
          <div className="rounded-xl bg-danger/6 p-3">
            <p className="text-[11.5px] font-medium uppercase tracking-wide text-danger">Actual</p>
            <p className="mt-1">{f.actual}</p>
          </div>
        </div>
        {f.steps?.length > 0 && (
          <ol className="list-decimal space-y-0.5 pl-5 text-[13px] text-ink/85">
            {f.steps.map((s: string, i: number) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        )}
        <p className="text-[12.5px] text-muted">
          <span className="font-medium text-ink">Independent review:</span> {f.verifier_rationale}
        </p>
        <p className="font-mono text-[11.5px] text-subtle">Evidence: {(f.evidence ?? []).join(" ") || "none"}</p>
      </CardContent>
    </Card>
  );
}

function ReportTab({ runId, done, run }: { runId: string; done: boolean; run: RunDetail }) {
  const { data } = useQuery({ queryKey: ["report", runId, done], queryFn: () => lab<any>(`/runs/${runId}/report`) });
  if (!data) return <Skeleton className="h-40 rounded-2xl" />;
  const tone = { met: "green", not_met: "red", not_verified: "purple", not_covered: "neutral" } as const;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Acceptance Criteria Coverage</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2.5">
            {data.acceptanceCriteria.map((a: any) => (
              <li key={a.index} className="flex items-start gap-3 text-[13.5px]">
                <span className="mt-0.5 font-mono text-[11px] text-muted">AC{a.index}</span>
                <span className="flex-1">{a.text}</span>
                <Badge tone={tone[a.status as keyof typeof tone]}>{a.status.replace("_", " ")}</Badge>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Recommendations</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-[13.5px]">
            {data.recommendations.map((r: string, i: number) => (
              <li key={i} className="flex gap-2">
                <span className="text-accent">•</span>
                {r}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
      {run.gate && (
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>CI Gate</CardTitle>
            <GateBadge verdict={run.gate.verdict} />
          </CardHeader>
          <CardContent className="grid gap-4 text-[13px] md:grid-cols-2">
            {(
              [
                ["Blocking (verified failures)", run.gate.blocking, "text-danger"],
                ["Incomplete — not counted as success", run.gate.incomplete, "text-[#c93400]"],
                ["Non-blocking verified failures", run.gate.nonBlocking, "text-ink"],
                ["Advisory (suspected / exploratory)", run.gate.advisory, "text-muted"],
              ] as const
            ).map(([title, items, cls]) => (
              <div key={title}>
                <p className={cn("font-medium", cls)}>
                  {title} ({items.length})
                </p>
                <ul className="mt-1 space-y-0.5 text-muted">
                  {items.map((g: any, i: number) => (
                    <li key={i}>
                      <span className="font-mono text-[11.5px]">{g.scenario}</span> {g.reason}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Cost by Scenario</CardTitle>
        </CardHeader>
        <Table>
          <thead>
            <tr>
              <Th>Scenario</Th>
              <Th>Role</Th>
              <Th className="text-right">Calls</Th>
              <Th className="text-right">Input</Th>
              <Th className="text-right">Output</Th>
              <Th className="text-right">Cache read</Th>
              <Th className="text-right">Model cost</Th>
              <Th>Served models</Th>
            </tr>
          </thead>
          <tbody>
            {run.costByScenario.map((c: any, i: number) => (
              <Tr key={i}>
                <Td className="font-mono text-[12px]">{c.scenario}</Td>
                <Td>{c.role}</Td>
                <Td className="text-right tabular-nums">{c.calls}</Td>
                <Td className="text-right tabular-nums">{c.input.toLocaleString()}</Td>
                <Td className="text-right tabular-nums">{c.output.toLocaleString()}</Td>
                <Td className="text-right tabular-nums">{c.cacheRead.toLocaleString()}</Td>
                <Td className="text-right tabular-nums">{fmtCost(c.usd)}</Td>
                <Td className="text-[12px] text-muted">{c.models}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Environment & Cost</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 text-[13px] md:grid-cols-4">
          {[
            ["Environment", data.environment.id],
            ["Model", `${data.model.provider} / ${data.model.model}`],
            ["Duration", fmtDuration(data.durationMs)],
            ["Estimated cost", `${fmtCost(data.cost?.totalUsd ?? data.usage?.costUsd)} of $${data.cost?.budgetUsd ?? "?"}`],
            ["Model / browser / tools", `${fmtCost(data.cost?.modelUsd)} / ${fmtCost(data.cost?.browserUsd)} / ${fmtCost(data.cost?.toolUsd)}`],
            ["Served models", (data.metadata?.servedModels ?? []).join(", ") || "—"],
            ["Browser", data.metadata?.browserVersion ?? "—"],
            ["Commit", data.metadata?.commitSha ? `${String(data.metadata.commitSha).slice(0, 10)}${data.metadata.dirty ? " (dirty)" : ""}` : "—"],
            ["Mode / trigger", `${data.mode} / ${data.trigger ?? "manual"}`],
            ["Browser actions", data.usage?.actions ?? 0],
            ["Model calls", data.usage?.modelCalls ?? 0],
            ["Input tokens", (data.usage?.inputTokens ?? 0).toLocaleString()],
            ["Output tokens", (data.usage?.outputTokens ?? 0).toLocaleString()],
          ].map(([k, v]) => (
            <div key={k as string}>
              <p className="text-muted">{k}</p>
              <p className="mt-0.5 font-medium">{v as any}</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

export function RunViewerPage() {
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const { data: run } = useQuery({
    queryKey: ["run", id],
    queryFn: () => lab<RunDetail>(`/runs/${id}`),
    refetchInterval: (q) => (q.state.data && ["running", "queued"].includes(q.state.data.status) ? 1500 : false),
  });
  const live = !!run && ["running", "queued"].includes(run.status);
  const events = useRunEvents(id, live);
  const [tab, setTab] = useState<"timeline" | "results" | "findings" | "report">("timeline");
  const [filter, setFilter] = useState<keyof typeof filters>("all");
  const [scenario, setScenario] = useState("all");
  const cancel = useMutation({ mutationFn: () => post(`/runs/${id}/cancel`), onSuccess: () => qc.invalidateQueries({ queryKey: ["run", id] }) });
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [live]);

  const scenarioKeys = useMemo(() => [...new Set(events.map((e) => e.scenarioKey).filter(Boolean))] as string[], [events]);
  const visible = useMemo(() => events.filter(filters[filter]).filter((e) => scenario === "all" || e.scenarioKey === scenario), [events, filter, scenario]);
  const lastAction = [...events].reverse().find((e) => e.kind === "action" && e.detail?.url);
  const lastReasoning = [...events].reverse().find((e) => e.kind === "reasoning");

  if (!run) return <Skeleton className="h-96 rounded-2xl" />;
  const elapsed = run.durationMs ?? (run.startedAt ? now - new Date(run.startedAt).getTime() : null);
  const findingsActive = run.findings.filter((f) => f.eval_label !== "duplicate");

  // Scenario progress list: results when done; otherwise derive from events.
  const progress = run.results.length
    ? run.results.map((r) => ({ key: r.scenario_key, title: r.title, status: r.status as string | null }))
    : scenarioKeys.map((k) => ({ key: k, title: events.find((e) => e.scenarioKey === k && e.kind === "system")?.title.replace(/^Scenario \S+ started: /, "") ?? k, status: null }));

  return (
    <div className="animate-fade-in">
      <Link to="/runs" className="mb-4 inline-flex items-center gap-1 text-[13px] font-medium text-accent hover:underline">
        <ChevronLeft className="h-4 w-4" /> Test Runs
      </Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <ModeBadge mode={run.mode} />
            <RunStatusBadge status={run.status} />
            <GateBadge verdict={run.gate?.verdict} />
            {live && <span className="text-[12.5px] text-muted">{run.phase}{run.currentScenario ? ` · ${run.currentScenario}` : ""}</span>}
          </div>
          <h1 className="mt-1.5 font-mono text-[22px] font-semibold tracking-tight">{run.id}</h1>
          <p className="mt-1 text-[13px] text-muted">
            <Link to={`/stories/${run.storyId}`} className="text-accent hover:underline">{run.storyId}</Link> · {run.provider} ·{" "}
            {run.metadata?.routing?.forced ?? `${run.metadata?.routing?.economy ?? run.model} / ${run.metadata?.routing?.advanced ?? ""}`} · {run.metadata?.browserVersion ?? ""} ·
            started {fmtTime(run.startedAt ?? run.createdAt)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {live ? (
            <Button variant="danger-ghost" onClick={() => cancel.mutate()} loading={cancel.isPending}>
              <Square className="h-3.5 w-3.5 fill-current" /> Stop run
            </Button>
          ) : (
            <>
              <Button variant="outline" asChild>
                <a href={`/api/lab/runs/${id}/report.md`}>
                  <Download className="h-3.5 w-3.5" /> Markdown
                </a>
              </Button>
              <Button variant="outline" asChild>
                <a href={`/api/lab/runs/${id}/report.json`}>
                  <Download className="h-3.5 w-3.5" /> JSON
                </a>
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        {[
          ["Duration", fmtDuration(elapsed)],
          ["Browser actions", run.usage?.actions ?? 0],
          ["Model calls", run.usage?.modelCalls ?? 0],
          ["Cost / budget", `${fmtCost(runCost(run))} / $${run.cost?.budgetUsd ?? run.options?.limits?.maxCostUsd ?? "?"}`],
          ["Findings", findingsActive.length || (live ? events.filter((e) => e.kind === "finding").length : 0)],
        ].map(([k, v]) => (
          <Card key={k as string} className="px-4 py-3">
            <p className="text-[12px] text-muted">{k}</p>
            <p className="mt-0.5 text-[20px] font-semibold tabular-nums tracking-tight">{v as any}</p>
          </Card>
        ))}
      </div>
      {run.error && <div className="mb-4 rounded-2xl bg-danger/8 px-4 py-3 text-[13.5px] text-danger">{run.error}</div>}

      <div className="mb-6 grid gap-4 lg:grid-cols-[1fr_340px]">
        <Card className="overflow-hidden">
          <div className="flex items-center gap-2 border-b border-hairline bg-canvas/60 px-4 py-2">
            <div className="flex gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
            </div>
            <div className="mx-auto max-w-md flex-1 truncate rounded-md bg-surface px-3 py-0.5 text-center font-mono text-[11.5px] text-muted ring-1 ring-hairline">
              {lastAction?.detail?.url ?? "about:blank"}
            </div>
            {live && <Spinner className="h-3.5 w-3.5" />}
          </div>
          {run.liveScreenshot ? (
            <img src={`/artifacts/${run.liveScreenshot}`} alt="Latest browser screenshot" className="w-full" />
          ) : (
            <div className="grid aspect-[16/10] place-items-center text-[13px] text-muted">{live ? "Waiting for the first browser action…" : "No screenshots recorded."}</div>
          )}
          {live && lastReasoning && (
            <div className="border-t border-hairline px-4 py-2.5 text-[13px] italic text-ink/80">
              <span className="mr-1.5 rounded bg-fill px-1 font-mono text-[10.5px] not-italic text-muted">{lastReasoning.scenarioKey}</span>
              {lastReasoning.title}
            </div>
          )}
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Scenarios</CardTitle>
          </CardHeader>
          <CardContent className="pt-3">
            {progress.length ? (
              <ul className="space-y-1">
                {progress.map((p) => (
                  <li key={p.key} className={cn("flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13px]", run.currentScenario === p.key && live && "bg-accent/8")}>
                    {run.currentScenario === p.key && live ? <Spinner className="h-3.5 w-3.5 text-accent" /> : <span className="w-3.5" />}
                    <span className="w-14 shrink-0 font-mono text-[11.5px] text-muted">{p.key}</span>
                    <span className="min-w-0 flex-1 truncate">{p.title}</span>
                    {p.status && <ResultBadge status={p.status} />}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-muted">{live ? "Planning…" : "No scenarios executed."}</p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: "timeline", label: `Timeline (${events.length})` },
            { value: "results", label: `Results${run.results.length ? ` (${run.results.length})` : ""}` },
            { value: "findings", label: `Findings${findingsActive.length ? ` (${findingsActive.length})` : ""}` },
            { value: "report", label: "Report" },
          ]}
        />
        {tab === "timeline" && (
          <div className="flex items-center gap-2">
            <Select value={scenario} onChange={(e) => setScenario(e.target.value)} className="h-8 w-40 text-[12.5px]" aria-label="Scenario">
              <option value="all">All scenarios</option>
              {scenarioKeys.map((k) => (
                <option key={k}>{k}</option>
              ))}
            </Select>
            <Segmented
              value={filter}
              onChange={setFilter}
              options={[
                { value: "all", label: "All" },
                { value: "actions", label: "Actions" },
                { value: "network", label: "Network" },
                { value: "findings", label: "Outcomes" },
              ]}
            />
          </div>
        )}
      </div>

      {tab === "timeline" && (
        <Card className="overflow-hidden">
          {visible.length ? (
            <ul>
              {visible.map((e) => (
                <EventRow key={e.id} e={e} />
              ))}
            </ul>
          ) : (
            <EmptyState title={live ? "Waiting for events…" : "No events"} />
          )}
        </Card>
      )}
      {tab === "results" &&
        (run.results.length ? (
          <div className="space-y-4">
            {run.results.map((r) => (
              <ScenarioResultCard key={r.id} r={r} />
            ))}
          </div>
        ) : (
          <Card>
            <EmptyState title="Results appear after verification" description="Scenario verdicts are computed once execution finishes, from the recorded evidence." />
          </Card>
        ))}
      {tab === "findings" &&
        (run.findings.length ? (
          <div className="space-y-4">
            {run.findings.map((f) => (
              <FindingCard key={f.id} f={f} />
            ))}
          </div>
        ) : (
          <Card>
            <EmptyState icon={<Bug className="h-5 w-5" />} title={live ? "Findings are verified at the end of the run" : "No findings"} />
          </Card>
        ))}
      {tab === "report" && (live ? <Card><EmptyState title="Report is generated when the run finishes" /></Card> : <ReportTab runId={id} done={!live} run={run} />)}
    </div>
  );
}
