import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { EyeOff, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, cn, PageHeader, Segmented, Select, Skeleton, Table, Td, Th, Tr } from "@ui/ui";
import { ClassificationBadge, fmtCost, fmtDuration, fmtPct, fmtTime, lab, post, put, ResultBadge } from "../lib";

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="p-4">
      <p className="text-[12.5px] text-muted">{label}</p>
      <p className="mt-1 text-[26px] font-semibold tabular-nums tracking-[-0.03em]">{value}</p>
      {hint && <p className="mt-0.5 text-[11.5px] text-subtle">{hint}</p>}
    </Card>
  );
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} className={cn("relative h-[26px] w-[44px] shrink-0 rounded-full transition-colors", on ? "bg-danger" : "bg-fill-strong")}>
      <span className={cn("absolute top-[3px] h-5 w-5 rounded-full bg-white shadow transition-all", on ? "left-[21px]" : "left-[3px]")} />
    </button>
  );
}

export function BenchmarkPage() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["evaluation"], queryFn: () => lab<any>("/evaluation") });
  const refresh = () => qc.invalidateQueries({ queryKey: ["evaluation"] });
  const sut = useMutation({ mutationFn: (body: any) => put("/sut", body), onSuccess: () => { refresh(); toast.success("Demo app configuration updated (refresh the demo app)"); } });
  const reset = useMutation({ mutationFn: () => post("/environment/reset"), onSuccess: () => toast.success("Demo data reset to seed") });
  const label = useMutation({ mutationFn: ({ id, label, bugId }: any) => post(`/findings/${id}/label`, { label, bugId }), onSuccess: refresh });

  if (!data) return <Skeleton className="h-96 rounded-2xl" />;
  const m = data.metrics;

  return (
    <div className="animate-fade-in">
      <PageHeader title="Benchmark" subtitle="Evaluate the agent objectively: control the system under test, compare findings with the hidden bug list, and track repeatability." />

      <div className="mb-6 flex items-start gap-3 rounded-2xl bg-ink p-4 text-[13px] text-white/85">
        <EyeOff className="mt-0.5 h-4 w-4 shrink-0 text-white" />
        <p>
          <span className="font-medium text-white">Evaluator view.</span> Hidden bug descriptions are shown here only for human evaluators. They live in{" "}
          <code className="font-mono text-[12px]">evaluation/hidden-bugs.json</code> and are never sent to the AI agent, stories or the demo app.
        </p>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Metric label="Happy Path success" value={fmtPct(m.happyPathSuccessRate)} hint={`${m.runs} completed runs`} />
        <Metric label="AC coverage" value={fmtPct(m.acceptanceCriteriaCoverage)} hint="verified with evidence" />
        <Metric label="Regression coverage" value={fmtPct(m.regressionScenarioCoverage)} hint="approved executed" />
        <Metric label="Known bug detection" value={fmtPct(m.knownBugDetectionRate)} hint="of enabled bugs" />
        <Metric label="False positive rate" value={fmtPct(m.falsePositiveRate)} hint="unlabeled count as FP" />
        <Metric label="Repeatability" value={fmtPct(m.repeatability)} hint="same verdict across runs" />
        <Metric label="Avg duration" value={fmtDuration(m.avgDurationMs)} />
        <Metric label="Avg cost" value={fmtCost(m.avgCostUsd)} hint={`total ${fmtCost(m.totalCostUsd)}`} />
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-[1fr_360px]">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Intentional bugs</CardTitle>
              <CardDescription>Toggle to simulate fixes. Changes apply to the demo app immediately (API) or on refresh (UI).</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-1 pt-3">
            {data.bugs.map((b: any) => {
              const on = !!data.sut.bugs[b.id];
              return (
                <div key={b.id} className="flex items-start gap-4 rounded-xl px-2 py-3 hover:bg-canvas">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[12px] text-muted">{b.id}</span>
                      <Badge>{b.category}</Badge>
                      <Badge tone={on ? "red" : "green"}>{on ? "active" : "fixed"}</Badge>
                    </div>
                    <p className="mt-1 text-[14px] font-medium">{b.title}</p>
                    <p className="mt-0.5 text-[12.5px] text-muted">{b.description}</p>
                  </div>
                  <Toggle label={`${b.id} active`} on={on} onChange={(v) => sut.mutate({ bugs: { [b.id]: v } })} />
                </div>
              );
            })}
          </CardContent>
        </Card>
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>UI variant</CardTitle>
                <CardDescription>Same behavior, different layout and labels.</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <Segmented
                value={data.sut.uiVariant}
                onChange={(v) => sut.mutate({ uiVariant: v })}
                options={[
                  { value: "classic", label: "Classic (sidebar)" },
                  { value: "refresh", label: "Refresh (top nav)" },
                ]}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Test data</CardTitle>
                <CardDescription>Runs reset data by default; reset manually before demos.</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <Button variant="secondary" onClick={() => reset.mutate()} loading={reset.isPending}>
                <RotateCcw className="h-3.5 w-3.5" /> Reset demo data
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card className="mb-6">
        <CardHeader className="pb-3">
          <CardTitle>Per-run evaluation</CardTitle>
        </CardHeader>
        {m.perRun.length ? (
          <Table>
            <thead>
              <tr>
                <Th>Run</Th>
                <Th>Enabled bugs</Th>
                <Th>Happy Path</Th>
                <Th>Detected</Th>
                <Th>Missed</Th>
                <Th className="text-right">FP rate</Th>
                <Th className="text-right">Duration</Th>
                <Th className="text-right">Cost</Th>
              </tr>
            </thead>
            <tbody>
              {[...m.perRun].reverse().map((r: any) => (
                <Tr key={r.runId}>
                  <Td>
                    <Link to={`/runs/${r.runId}`} className="font-mono text-[12px] hover:text-accent">
                      {r.runId}
                    </Link>
                    <p className="text-[11.5px] text-muted">
                      {fmtTime(r.createdAt)} · {r.sut?.uiVariant}
                    </p>
                  </Td>
                  <Td className="font-mono text-[11.5px]">{r.evaluation?.enabledBugs.join(" ") || "none"}</Td>
                  <Td>{r.happyPath ? <ResultBadge status={r.happyPath} /> : "—"}</Td>
                  <Td className="font-mono text-[11.5px] text-[#248a3d]">{r.evaluation?.detectedBugs.join(" ") || "—"}</Td>
                  <Td className="font-mono text-[11.5px] text-danger">{r.evaluation?.missedBugs.join(" ") || "—"}</Td>
                  <Td className="text-right tabular-nums">{fmtPct(r.evaluation?.falsePositiveRate)}</Td>
                  <Td className="text-right tabular-nums">{fmtDuration(r.durationMs)}</Td>
                  <Td className="text-right tabular-nums">{fmtCost(r.costUsd)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <CardContent className="pt-0 text-[13.5px] text-muted">No completed runs yet.</CardContent>
        )}
      </Card>

      {m.repeatGroups.length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <div>
              <CardTitle>Repeatability</CardTitle>
              <CardDescription>Runs grouped by story and identical demo-app configuration.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            {m.repeatGroups.map((g: any) => (
              <div key={g.key}>
                <p className="mb-2 text-[13px] font-medium">
                  {g.storyId} · {g.mode} · {g.runs} runs · bugs on: {Object.entries(g.sut.bugs).filter(([, v]) => v).map(([k]) => k).join(" ") || "none"} · {g.sut.uiVariant}
                </p>
                <div className="flex flex-wrap gap-2">
                  {g.perScenario.map((s: any) => (
                    <Badge key={s.scenario} tone={s.agreement === 1 ? "green" : s.agreement >= 0.67 ? "orange" : "red"}>
                      {s.scenario}: {fmtPct(s.agreement)} ({Object.entries(s.counts).map(([k, v]) => `${v}× ${k}`).join(", ")})
                    </Badge>
                  ))}
                  {g.bugs.map((b: any) => (
                    <Badge key={b.bug} tone="neutral">
                      {b.bug} detected {b.detectedIn}/{b.runs}
                    </Badge>
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card className="mb-6">
        <CardHeader className="pb-3">
          <div>
            <CardTitle>AI vs. traditional E2E — monthly cost & effort</CardTitle>
            <CardDescription>{data.baseline.note}</CardDescription>
          </div>
        </CardHeader>
        <Table>
          <thead>
            <tr>
              <Th>Item</Th>
              <Th className="text-right">Traditional (assumed)</Th>
              <Th className="text-right">AI (measured where noted)</Th>
              <Th>Basis</Th>
            </tr>
          </thead>
          <tbody>
            {data.baseline.lines.map((l: any) => (
              <Tr key={l.item}>
                <Td className="font-medium">{l.item}</Td>
                <Td className="text-right tabular-nums">{l.traditionalUsd == null ? "—" : fmtCost(l.traditionalUsd)}</Td>
                <Td className="text-right tabular-nums">{l.aiUsd == null ? "n/a" : fmtCost(l.aiUsd)}</Td>
                <Td className="max-w-md text-[12px] text-muted">{l.basis}</Td>
              </Tr>
            ))}
            <Tr>
              <Td className="font-semibold">Monthly total (excl. one-time authoring)</Td>
              <Td className="text-right font-semibold tabular-nums">{fmtCost(data.baseline.monthlyTraditionalUsd)}</Td>
              <Td className="text-right font-semibold tabular-nums">{data.baseline.monthlyAiUsd == null ? "n/a" : fmtCost(data.baseline.monthlyAiUsd)}</Td>
              <Td className="text-[12px] text-muted">
                {data.baseline.scenarios} scenarios · runs/month: {Object.entries(data.baseline.runsPerMonth).map(([k, v]) => `${k} ${v}`).join(", ")}
              </Td>
            </Tr>
          </tbody>
        </Table>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <div>
            <CardTitle>Label findings</CardTitle>
            <CardDescription>Keyword matching suggests a hidden bug; confirm or override to keep detection and false-positive metrics honest.</CardDescription>
          </div>
        </CardHeader>
        {data.findings.length ? (
          <Table>
            <thead>
              <tr>
                <Th>Finding</Th>
                <Th>Verifier</Th>
                <Th>Suggested</Th>
                <Th className="w-56">Evaluator label</Th>
              </tr>
            </thead>
            <tbody>
              {data.findings.map((f: any) => {
                const value = f.eval_label === "false_positive" || f.eval_label === "duplicate" ? f.eval_label : f.eval_bug_id ? `bug:${f.eval_bug_id}` : "";
                return (
                  <Tr key={f.id}>
                    <Td>
                      <p className="text-[13px] font-medium">{f.title}</p>
                      <Link to={`/runs/${f.run_id}`} className="font-mono text-[11px] text-muted hover:text-accent">
                        {f.run_id} · {f.scenario_key}
                      </Link>
                    </Td>
                    <Td>
                      <ClassificationBadge c={f.classification} />
                    </Td>
                    <Td className="font-mono text-[12px]">{f.suggestedBug ?? "—"}</Td>
                    <Td>
                      <Select
                        aria-label="Label"
                        value={value}
                        className="h-8 text-[12.5px]"
                        onChange={(e) => {
                          const v = e.target.value;
                          if (!v) label.mutate({ id: f.id, label: null, bugId: null });
                          else if (v.startsWith("bug:")) label.mutate({ id: f.id, label: "true_positive", bugId: v.slice(4) });
                          else label.mutate({ id: f.id, label: v, bugId: null });
                        }}
                      >
                        <option value="">Unlabeled</option>
                        {data.bugs.map((b: any) => (
                          <option key={b.id} value={`bug:${b.id}`}>
                            {f.eval_label === "auto_match" && f.eval_bug_id === b.id ? "(auto) " : ""}True positive · {b.id}
                          </option>
                        ))}
                        <option value="false_positive">False positive</option>
                        <option value="duplicate">Duplicate</option>
                      </Select>
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        ) : (
          <CardContent className="pt-0 text-[13.5px] text-muted">No findings yet.</CardContent>
        )}
      </Card>
    </div>
  );
}
