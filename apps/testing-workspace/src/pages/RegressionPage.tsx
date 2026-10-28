import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BrainCircuit, Check, ChevronDown, History, Pencil, Plus, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Badge, Button, Card, cn, Dialog, DialogContent, EmptyState, Field, Input, PageHeader, Segmented, Select, Skeleton, Textarea } from "@ui/ui";
import { fmtTime, lab, post, put, ScenarioStatusBadge, type Scenario, type ScenarioFields, type Story } from "../lib";

const lines = (a: string[]) => a.join("\n");
const split = (s: string) => s.split("\n").map((l) => l.replace(/^\s*(\d+[.)]|[-*])\s*/, "").trim()).filter(Boolean);

function ScenarioEditor({ initial, approved, onSubmit, pending, storyPicker }: { initial?: ScenarioFields; approved?: boolean; onSubmit: (f: ScenarioFields, reason: string, storyId?: string) => void; pending: boolean; storyPicker?: Story[] }) {
  const [v, setV] = useState({
    title: initial?.title ?? "",
    description: initial?.description ?? "",
    preconditions: lines(initial?.preconditions ?? []),
    steps: lines(initial?.steps ?? []),
    expectedResults: lines(initial?.expectedResults ?? []),
    reason: "",
    storyId: storyPicker?.[0]?.id ?? "",
  });
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }));
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ title: v.title, description: v.description, preconditions: split(v.preconditions), steps: split(v.steps), expectedResults: split(v.expectedResults) }, v.reason, v.storyId);
      }}
    >
      {approved && (
        <p className="rounded-xl bg-warning/10 p-3 text-[13px]">
          This scenario is approved. Your edit is saved as a <b>pending revision</b>; the approved version keeps running until the revision is explicitly approved.
        </p>
      )}
      {storyPicker && (
        <Field label="Story" htmlFor="story">
          <Select id="story" value={v.storyId} onChange={set("storyId")}>
            {storyPicker.map((s) => (
              <option key={s.id} value={s.id}>
                {s.id} — {s.title}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Field label="Title" htmlFor="t" required>
        <Input id="t" value={v.title} onChange={set("title")} />
      </Field>
      <Field label="Description" htmlFor="d" required>
        <Textarea id="d" value={v.description} onChange={set("description")} />
      </Field>
      <Field label="Preconditions" htmlFor="p" hint="One per line.">
        <Textarea id="p" value={v.preconditions} onChange={set("preconditions")} className="min-h-[60px]" />
      </Field>
      <Field label="Execution steps" htmlFor="s" required hint="One per line.">
        <Textarea id="s" value={v.steps} onChange={set("steps")} className="min-h-[110px] font-mono text-[12.5px]" />
      </Field>
      <Field label="Expected results" htmlFor="x" required hint="One per line. These define pass/fail.">
        <Textarea id="x" value={v.expectedResults} onChange={set("expectedResults")} className="min-h-[90px] font-mono text-[12.5px]" />
      </Field>
      {initial && (
        <Field label="Reason for change" htmlFor="r">
          <Input id="r" value={v.reason} onChange={set("reason")} placeholder="Recorded in the scenario history" />
        </Field>
      )}
      <div className="flex justify-end border-t border-hairline pt-4">
        <Button type="submit" loading={pending} disabled={pending}>
          {approved ? "Propose revision" : "Save"}
        </Button>
      </div>
    </form>
  );
}

const List = ({ title, items, mono }: { title: string; items: string[]; mono?: boolean }) =>
  items.length ? (
    <div>
      <p className="mb-1 text-[11.5px] font-medium uppercase tracking-wide text-subtle">{title}</p>
      <ol className={cn("list-decimal space-y-0.5 pl-5 text-[13.5px]", mono && "font-mono text-[12.5px]")}>
        {items.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ol>
    </div>
  ) : null;

function ScenarioCard({ s }: { s: Scenario }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(s.status === "proposed");
  const [editing, setEditing] = useState(false);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["scenarios"] });
    qc.invalidateQueries({ queryKey: ["story"] });
    qc.invalidateQueries({ queryKey: ["overview"] });
  };
  const act = useMutation({
    mutationFn: ({ path, body }: { path: string; body?: unknown }) => post(`/scenarios/${s.id}/${path}`, body),
    onSuccess: (_d, v) => {
      refresh();
      toast.success(`Scenario ${s.id}: ${v.path === "revision" ? "revision resolved" : v.path === "critical" ? "critical flag updated" : v.path + "d"}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const edit = useMutation({
    mutationFn: ({ fields, reason }: { fields: ScenarioFields; reason: string }) => put(`/scenarios/${s.id}`, { fields, reason }),
    onSuccess: () => {
      refresh();
      setEditing(false);
      toast.success(s.status === "approved" ? "Revision proposed — approve it to take effect" : "Scenario updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const retire = () => {
    const note = window.prompt("Why retire this scenario? (required, kept in history)");
    if (note?.trim()) act.mutate({ path: "retire", body: { note } });
  };

  return (
    <Card className={cn("overflow-hidden", s.status === "proposed" && "ring-1 ring-accent/30")}>
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center gap-3 px-5 py-4 text-left">
        <span className="font-mono text-[12px] text-muted">{s.id}</span>
        <span className="min-w-0 flex-1 truncate text-[14.5px] font-medium">{s.title}</span>
        {s.discoverySource.type === "ai-exploration" && (
          <Badge tone="purple">
            <Sparkles className="h-3 w-3" /> AI-discovered
          </Badge>
        )}
        {s.critical && <Badge tone="red">critical</Badge>}
        {s.pendingRevision && <Badge tone="orange">revision pending</Badge>}
        <ScenarioStatusBadge status={s.status} />
        <ChevronDown className={cn("h-4 w-4 text-subtle transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="space-y-4 border-t border-hairline px-5 py-4 animate-fade-in">
          <p className="text-[13.5px] text-ink/85">{s.description}</p>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-3">
              <List title="Preconditions" items={s.preconditions} />
              <List title="Steps" items={s.steps} />
            </div>
            <List title="Expected results" items={s.expectedResults} />
          </div>

          {s.pendingRevision && (
            <div className="rounded-xl bg-warning/8 p-4">
              <p className="text-[13px] font-medium">
                Pending revision by {s.pendingRevision.proposedBy} · {fmtTime(s.pendingRevision.proposedAt)}
                {s.pendingRevision.reason ? ` — "${s.pendingRevision.reason}"` : ""}
              </p>
              <div className="mt-3 grid gap-4 md:grid-cols-2">
                <List title="New steps" items={s.pendingRevision.steps} />
                <List title="New expected results" items={s.pendingRevision.expectedResults} />
              </div>
              <div className="mt-3 flex gap-2">
                <Button size="sm" onClick={() => act.mutate({ path: "revision", body: { accept: true } })}>
                  Approve revision
                </Button>
                <Button size="sm" variant="secondary" onClick={() => act.mutate({ path: "revision", body: { accept: false } })}>
                  Discard revision
                </Button>
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-x-6 gap-y-1 text-[12.5px] text-muted">
            <span>
              Source:{" "}
              {s.discoverySource.runId ? (
                <Link to={`/runs/${s.discoverySource.runId}`} className="text-accent hover:underline">
                  {s.discoverySource.runId} · {s.discoverySource.scenarioKey}
                </Link>
              ) : (
                s.discoverySource.type
              )}
            </span>
            {s.discoverySource.findingTitle && <span>Related finding: {s.discoverySource.findingTitle}</span>}
            <span>Updated {fmtTime(s.updatedAt)}</span>
          </div>

          {s.evidence.some((e) => e.screenshot) && (
            <div className="flex gap-2 overflow-x-auto">
              {s.evidence
                .filter((e) => e.screenshot)
                .slice(0, 6)
                .map((e) => (
                  <a key={e.label} href={`/artifacts/${e.screenshot}`} target="_blank" rel="noreferrer" title={e.label} className="w-40 shrink-0 overflow-hidden rounded-lg ring-1 ring-hairline hover:ring-accent">
                    <img src={`/artifacts/${e.screenshot}`} alt={e.label} loading="lazy" />
                  </a>
                ))}
            </div>
          )}

          <details className="text-[12.5px]">
            <summary className="flex cursor-pointer items-center gap-1.5 font-medium text-muted">
              <History className="h-3.5 w-3.5" /> History ({s.history.length})
            </summary>
            <ul className="mt-2 space-y-1.5 border-l border-hairline pl-4">
              {s.history.map((h, i) => (
                <li key={i}>
                  <span className="font-medium">{h.action.replace("_", " ")}</span> by {h.actor} · <span className="text-muted">{fmtTime(h.at)}</span>
                  {h.note && <span className="text-muted"> — {h.note}</span>}
                  {h.before && h.after && JSON.stringify(h.before.expectedResults) !== JSON.stringify(h.after.expectedResults) && (
                    <span className="ml-1 text-warning">(expected results changed)</span>
                  )}
                </li>
              ))}
            </ul>
          </details>

          <div className="flex flex-wrap gap-2 border-t border-hairline pt-4">
            {(s.status === "proposed" || s.status === "rejected") && (
              <Button size="sm" onClick={() => act.mutate({ path: "approve" })}>
                <Check className="h-3.5 w-3.5" /> Approve
              </Button>
            )}
            {s.status === "proposed" && (
              <Button size="sm" variant="secondary" onClick={() => act.mutate({ path: "reject" })}>
                <X className="h-3.5 w-3.5" /> Reject
              </Button>
            )}
            {(s.status === "proposed" || s.status === "approved") && (
              <Dialog open={editing} onOpenChange={setEditing}>
                <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
                  <Pencil className="h-3.5 w-3.5" /> Edit
                </Button>
                <DialogContent title={`Edit ${s.id}`} wide>
                  <ScenarioEditor initial={s} approved={s.status === "approved"} pending={edit.isPending} onSubmit={(fields, reason) => edit.mutate({ fields, reason })} />
                </DialogContent>
              </Dialog>
            )}
            {(s.status === "approved" || s.status === "proposed") && (
              <Button size="sm" variant="secondary" onClick={() => act.mutate({ path: "critical", body: { critical: !s.critical } })} title="Critical scenarios run in smoke mode (pull requests) and gate CI">
                {s.critical ? "Unmark critical" : "Mark critical (smoke)"}
              </Button>
            )}
            {s.status === "approved" && (
              <Button size="sm" variant="danger-ghost" onClick={retire}>
                Retire
              </Button>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

export function RegressionPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<"proposed" | "approved" | "rejected" | "retired" | "all">("proposed");
  const { data } = useQuery({ queryKey: ["scenarios"], queryFn: () => lab<Scenario[]>("/scenarios") });
  const stories = useQuery({ queryKey: ["stories"], queryFn: () => lab<Story[]>("/stories") });
  const [creating, setCreating] = useState(false);
  const create = useMutation({
    mutationFn: ({ fields, storyId }: { fields: ScenarioFields; storyId: string }) => post("/scenarios", { storyId, ...fields }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["scenarios"] });
      setCreating(false);
      toast.success("Scenario proposed");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const count = (s: string) => data?.filter((x) => x.status === s).length ?? 0;
  const list = (data ?? []).filter((s) => status === "all" || s.status === status).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Regression Memory"
        subtitle="Scenarios the AI proposed or humans wrote. Approved scenarios run in every future run — they are never deleted, and expected results only change through approved revisions."
        actions={
          <Dialog open={creating} onOpenChange={setCreating}>
            <Button variant="secondary" onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" /> Manual scenario
            </Button>
            <DialogContent title="New regression scenario" wide>
              <ScenarioEditor storyPicker={stories.data ?? []} pending={create.isPending} onSubmit={(fields, _r, storyId) => create.mutate({ fields, storyId: storyId! })} />
            </DialogContent>
          </Dialog>
        }
      />
      <Segmented
        className="mb-4"
        value={status}
        onChange={setStatus}
        options={[
          { value: "proposed", label: `Proposed (${count("proposed")})` },
          { value: "approved", label: `Approved (${count("approved")})` },
          { value: "rejected", label: `Rejected (${count("rejected")})` },
          { value: "retired", label: `Retired (${count("retired")})` },
          { value: "all", label: "All" },
        ]}
      />
      {!data ? (
        <Skeleton className="h-24 rounded-2xl" />
      ) : list.length ? (
        <div className="space-y-3">
          {list.map((s) => (
            <ScenarioCard key={s.id} s={s} />
          ))}
        </div>
      ) : (
        <Card>
          <EmptyState icon={<BrainCircuit className="h-5 w-5" />} title={`No ${status === "all" ? "" : status} scenarios`} description="Run AI tests on a story; scenarios the agent discovers appear here for review." />
        </Card>
      )}
    </div>
  );
}
