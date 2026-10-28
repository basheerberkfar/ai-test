import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, ChevronRight, Plus } from "lucide-react";
import { Badge, Button, Card, Dialog, DialogContent, EmptyState, PageHeader, Skeleton } from "@ui/ui";
import { fmtCost, fmtTime, lab, ResultBadge, type Run, type Story } from "../lib";
import { StoryEditor } from "./StoryEditor";

type StoryRow = Story & { regression: { id: string; title: string; status: string }[]; lastRun: Run | null; cost: { runs: number; totalUsd: number; avgUsd: number | null } };

export const priorityTone = { Critical: "red", High: "orange", Medium: "blue", Low: "neutral" } as const;

export function StoriesPage() {
  const { data } = useQuery({ queryKey: ["stories"], queryFn: () => lab<StoryRow[]>("/stories") });
  const [open, setOpen] = useState(false);
  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Stories"
        subtitle="User stories with acceptance criteria, a mandatory happy path and their regression memory."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <Button onClick={() => setOpen(true)}>
              <Plus className="h-4 w-4" /> New Story
            </Button>
            <DialogContent title="New Story" wide>
              <StoryEditor onSaved={() => setOpen(false)} />
            </DialogContent>
          </Dialog>
        }
      />
      {!data ? (
        <Skeleton className="h-32 rounded-2xl" />
      ) : !data.length ? (
        <Card>
          <EmptyState icon={<BookOpen className="h-5 w-5" />} title="No stories" description="Create a story to start testing." />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {data.map((s) => {
            const approved = s.regression.filter((r) => r.status === "approved").length;
            const proposed = s.regression.filter((r) => r.status === "proposed").length;
            return (
              <Link key={s.id} to={`/stories/${s.id}`} className="group">
                <Card className="h-full p-5 transition-all group-hover:shadow-pop">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[12px] text-muted">{s.id}</span>
                    <Badge tone={priorityTone[s.priority as keyof typeof priorityTone]}>{s.priority}</Badge>
                    <ChevronRight className="ml-auto h-4 w-4 text-subtle transition-transform group-hover:translate-x-0.5" />
                  </div>
                  <h3 className="mt-2 text-[18px] font-semibold tracking-tight">{s.title}</h3>
                  <p className="mt-1 line-clamp-2 text-[13.5px] text-muted">{s.description}</p>
                  <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-[12.5px] text-muted">
                    <span>{s.acceptanceCriteria.length} acceptance criteria</span>
                    <span>{s.happyPath.length}-step happy path</span>
                    <span>
                      {approved} regression scenario{approved === 1 ? "" : "s"}
                      {proposed ? ` · ${proposed} proposed` : ""}
                    </span>
                    <span>
                      AI cost {fmtCost(s.cost.totalUsd)} ({s.cost.runs} runs, avg {fmtCost(s.cost.avgUsd)})
                    </span>
                  </div>
                  <div className="mt-4 flex items-center gap-2 border-t border-hairline pt-3 text-[12.5px] text-muted">
                    {s.lastRun ? (
                      <>
                        Last run {fmtTime(s.lastRun.createdAt)}
                        {s.lastRun.summary?.happyPath && (
                          <span className="ml-auto flex items-center gap-1.5">
                            Happy path <ResultBadge status={s.lastRun.summary.happyPath} />
                          </span>
                        )}
                      </>
                    ) : (
                      "Never run"
                    )}
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
