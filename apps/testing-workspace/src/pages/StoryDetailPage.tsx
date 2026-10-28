import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronLeft, ExternalLink, Pencil, Play, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, CardDescription, Dialog, DialogContent, Field, Input, Segmented, Select, Skeleton } from "@ui/ui";
import { fmtCost, lab, post, ScenarioStatusBadge, type Run, type Scenario, type Story } from "../lib";
import { RunsTable } from "./RunsPage";
import { StoryEditor } from "./StoryEditor";
import { priorityTone } from "./StoriesPage";

function RunLauncher({ story, approved, critical }: { story: Story; approved: number; critical: number }) {
  const navigate = useNavigate();
  const status = useQuery({ queryKey: ["status"], queryFn: () => lab<any>("/status") });
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"smoke" | "regression" | "exploratory">("regression");
  const [exploratory, setExploratory] = useState("");
  const [budget, setBudget] = useState("");
  const [reset, setReset] = useState("yes");
  const [provider, setProvider] = useState<string>("");
  const [model, setModel] = useState("");
  const modeCfg = status.data?.modes?.[mode];
  const charters = exploratory === "" ? (modeCfg?.exploratoryCharters ?? 0) : Number(exploratory);
  const regressionCount = modeCfg?.regression === "all" ? approved : modeCfg?.regression === "critical" ? critical : 0;
  const start = useMutation({
    mutationFn: () =>
      post<{ id: string }>(`/stories/${story.id}/runs`, {
        mode,
        exploratory: exploratory === "" ? undefined : Number(exploratory),
        maxCostUsd: budget ? Number(budget) : undefined,
        resetData: reset === "yes",
        provider: provider || undefined,
        model: model.trim() || undefined,
      }),
    onSuccess: ({ id }) => navigate(`/runs/${id}`),
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="lg" onClick={() => setOpen(true)}>
        <Play className="h-4 w-4 fill-current" /> Run AI Tests
      </Button>
      <DialogContent title="Run AI Tests" description={`${story.id} · ${story.title}`}>
        <div className="space-y-4">
          <Segmented
            className="flex w-full [&>button]:flex-1"
            value={mode}
            onChange={(m) => {
              setMode(m);
              setExploratory("");
            }}
            options={[
              { value: "smoke", label: "Smoke" },
              { value: "regression", label: "Regression" },
              { value: "exploratory", label: "Exploratory" },
            ]}
          />
          <div className="rounded-xl bg-canvas p-3.5 text-[13px] leading-relaxed">
            <p className="font-medium">{modeCfg?.description ?? "…"}</p>
            <ul className="mt-1.5 space-y-0.5 text-muted">
              <li>• mandatory Happy Path ({story.happyPath.length} steps)</li>
              <li>
                • {regressionCount} approved regression scenario{regressionCount === 1 ? "" : "s"}
                {modeCfg?.regression === "critical" ? " marked critical" : modeCfg?.regression === "none" ? " (not in this mode)" : ""}
              </li>
              <li>• {charters} exploratory charter{charters === 1 ? "" : "s"}</li>
            </ul>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Budget (USD)" htmlFor="budget" hint={modeCfg ? `mode limit $${modeCfg.limits.maxCostUsd}` : undefined}>
              <Input id="budget" type="number" min="0.1" step="0.5" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder={modeCfg ? String(modeCfg.limits.maxCostUsd) : ""} />
            </Field>
            <Field label="Exploratory charters" htmlFor="ex">
              <Select id="ex" value={exploratory} onChange={(e) => setExploratory(e.target.value)}>
                <option value="">Mode default ({modeCfg?.exploratoryCharters ?? 0})</option>
                {[0, 1, 2, 3, 4, 5, 6].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Provider" htmlFor="prov">
              <Select id="prov" value={provider} onChange={(e) => setProvider(e.target.value)}>
                <option value="">Default ({status.data?.ai.provider ?? "…"})</option>
                <option value="anthropic">Anthropic</option>
                <option value="openai">OpenAI</option>
              </Select>
            </Field>
            <Field label="Model" htmlFor="model" hint="Empty = routed by role">
              <Input id="model" value={model} onChange={(e) => setModel(e.target.value)} placeholder={status.data ? `${status.data.ai.models.economy} / ${status.data.ai.models.advanced}` : ""} />
            </Field>
            <Field label="Test data" htmlFor="reset" className="col-span-2">
              <Select id="reset" value={reset} onChange={(e) => setReset(e.target.value)}>
                <option value="yes">Reset to seed before the run</option>
                <option value="no">Keep current data</option>
              </Select>
            </Field>
          </div>
          {modeCfg && (
            <p className="flex items-start gap-1.5 text-[12px] text-muted">
              <ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0" />
              Limits: {modeCfg.limits.stepsPerScenario} steps/scenario · {modeCfg.limits.maxModelCalls} model calls · {modeCfg.limits.maxBrowserActions} actions · {modeCfg.limits.runMinutes} min · {modeCfg.limits.maxScenarioRetries} retry
            </p>
          )}
          <div className="flex justify-end gap-2 border-t border-hairline pt-4">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => start.mutate()} loading={start.isPending} disabled={start.isPending}>
              Start {mode} run
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function StoryDetailPage() {
  const { id } = useParams();
  const { data: story } = useQuery({ queryKey: ["story", id], queryFn: () => lab<Story & { regression: Scenario[]; cost: { runs: number; totalUsd: number; avgUsd: number | null } }>(`/stories/${id}`) });
  const runs = useQuery({ queryKey: ["runs", id], queryFn: () => lab<Run[]>(`/runs?storyId=${id}`) });
  const [editing, setEditing] = useState(false);

  if (!story) return <Skeleton className="h-64 rounded-2xl" />;
  const approved = story.regression.filter((r) => r.status === "approved");

  return (
    <div className="animate-fade-in">
      <Link to="/stories" className="mb-4 inline-flex items-center gap-1 text-[13px] font-medium text-accent hover:underline">
        <ChevronLeft className="h-4 w-4" /> Stories
      </Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[12.5px] text-muted">{story.id}</span>
            <Badge tone={priorityTone[story.priority as keyof typeof priorityTone]}>{story.priority}</Badge>
            <Badge>{story.role}</Badge>
          </div>
          <h1 className="mt-1 text-[28px] font-semibold tracking-[-0.022em]">{story.title}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
            <a href={story.appUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
              {story.appUrl} <ExternalLink className="h-3 w-3" />
            </a>
            <span className="text-muted">
              AI cost: {fmtCost(story.cost.totalUsd)} over {story.cost.runs} run{story.cost.runs === 1 ? "" : "s"} · avg {fmtCost(story.cost.avgUsd)}/run
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Dialog open={editing} onOpenChange={setEditing}>
            <Button variant="secondary" size="lg" onClick={() => setEditing(true)}>
              <Pencil className="h-4 w-4" /> Edit
            </Button>
            <DialogContent title={`Edit ${story.id}`} wide>
              <StoryEditor story={story} onSaved={() => setEditing(false)} />
            </DialogContent>
          </Dialog>
          <RunLauncher story={story} approved={approved.length} critical={approved.filter((r) => r.critical).length} />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-3">
          <Card>
            <CardContent>
              <p className="text-[15px] leading-relaxed">{story.description}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Acceptance Criteria</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="space-y-2.5">
                {story.acceptanceCriteria.map((c, i) => (
                  <li key={i} className="flex gap-3 text-[14px]">
                    <span className="grid h-5 w-7 shrink-0 place-items-center rounded-md bg-fill font-mono text-[11px] font-medium text-muted">AC{i + 1}</span>
                    {c}
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>
        <Card className="lg:col-span-2">
          <CardHeader>
            <div>
              <CardTitle>Happy Path</CardTitle>
              <CardDescription>Mandatory in every run.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <ol className="relative space-y-3 border-l border-hairline pl-5">
              {story.happyPath.map((s, i) => (
                <li key={i} className="relative text-[13.5px]">
                  <span className="absolute -left-[27px] top-0.5 grid h-3.5 w-3.5 place-items-center rounded-full bg-surface ring-2 ring-accent/60" />
                  <span className="mr-1.5 font-mono text-[11.5px] text-muted">{i + 1}</span>
                  {s}
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader>
          <div>
            <CardTitle>Regression Scenarios</CardTitle>
            <CardDescription>Approved scenarios are executed in every run.</CardDescription>
          </div>
          <Button variant="link" asChild>
            <Link to="/regression">Manage →</Link>
          </Button>
        </CardHeader>
        <CardContent>
          {story.regression.length ? (
            <ul className="divide-y divide-hairline">
              {story.regression.map((r) => (
                <li key={r.id} className="flex items-center gap-3 py-2.5 text-[13.5px]">
                  <span className="font-mono text-[12px] text-muted">{r.id}</span>
                  <span className="flex-1">{r.title}</span>
                  {r.critical && <Badge tone="red">critical</Badge>}
                  <ScenarioStatusBadge status={r.status} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13.5px] text-muted">No regression scenarios yet. Scenarios discovered by the AI will appear as proposals after a run.</p>
          )}
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader className="pb-3">
          <CardTitle>Runs</CardTitle>
        </CardHeader>
        {runs.data?.length ? <RunsTable runs={runs.data} /> : <CardContent className="pt-0 text-[13.5px] text-muted">No runs yet.</CardContent>}
      </Card>
    </div>
  );
}
