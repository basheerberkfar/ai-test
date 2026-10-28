import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { PlayCircle } from "lucide-react";
import { Card, EmptyState, PageHeader, Skeleton, Table, Td, Th, Tr } from "@ui/ui";
import { fmtCost, fmtDuration, fmtTime, GateBadge, lab, ModeBadge, ResultBadge, runCost, RunStatusBadge, type Run } from "../lib";

export function RunsTable({ runs }: { runs: Run[] }) {
  const navigate = useNavigate();
  return (
    <Table>
      <thead>
        <tr>
          <Th>Run</Th>
          <Th>Story</Th>
          <Th>Mode</Th>
          <Th>Status</Th>
          <Th className="hidden md:table-cell">Happy Path</Th>
          <Th className="hidden md:table-cell">Scenarios</Th>
          <Th className="hidden lg:table-cell">Model</Th>
          <Th className="text-right">Duration</Th>
          <Th className="hidden text-right sm:table-cell">Cost</Th>
        </tr>
      </thead>
      <tbody>
        {runs.map((r) => {
          const t = r.summary?.totals;
          return (
            <Tr key={r.id} className="cursor-pointer" onClick={() => navigate(`/runs/${r.id}`)}>
              <Td>
                <Link to={`/runs/${r.id}`} className="font-mono text-[12.5px] font-medium hover:text-accent" onClick={(e) => e.stopPropagation()}>
                  {r.id}
                </Link>
                <p className="text-[12px] text-muted">{fmtTime(r.createdAt)}</p>
              </Td>
              <Td className="font-medium">{r.storyId}</Td>
              <Td>
                <ModeBadge mode={r.mode} />
                {r.trigger && r.trigger !== "manual" && <p className="mt-0.5 text-[11px] text-muted">{r.trigger}</p>}
              </Td>
              <Td>
                <div className="flex flex-wrap gap-1">
                  <RunStatusBadge status={r.status} />
                  <GateBadge verdict={r.summary?.gate} />
                </div>
                {r.status === "running" && <p className="mt-0.5 text-[11.5px] text-muted">{r.phase}{r.currentScenario ? ` · ${r.currentScenario}` : ""}</p>}
              </Td>
              <Td className="hidden md:table-cell">{r.summary?.happyPath ? <ResultBadge status={r.summary.happyPath} /> : <span className="text-subtle">—</span>}</Td>
              <Td className="hidden text-[12.5px] tabular-nums md:table-cell">
                {t ? (
                  <span>
                    <span className="text-[#248a3d]">{t.passed}✓</span> <span className="text-danger">{t.failed}✗</span>{" "}
                    <span className="text-muted">{t.blocked + t.inconclusive}?</span>
                  </span>
                ) : (
                  "—"
                )}
              </Td>
              <Td className="hidden text-[12.5px] text-muted lg:table-cell">{r.model}</Td>
              <Td className="text-right tabular-nums">{fmtDuration(r.durationMs)}</Td>
              <Td className="hidden text-right tabular-nums sm:table-cell">{fmtCost(runCost(r))}</Td>
            </Tr>
          );
        })}
      </tbody>
    </Table>
  );
}

export function RunsPage() {
  const { data } = useQuery({
    queryKey: ["runs"],
    queryFn: () => lab<Run[]>("/runs"),
    refetchInterval: (q) => (q.state.data?.some((r) => r.status === "running" || r.status === "queued") ? 2500 : false),
  });
  return (
    <div className="animate-fade-in">
      <PageHeader title="Test Runs" subtitle="Each run is a real browser execution against the authorized demo environment." />
      <Card>
        {!data ? (
          <div className="space-y-2 p-5">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
        ) : data.length ? (
          <RunsTable runs={data} />
        ) : (
          <EmptyState icon={<PlayCircle className="h-5 w-5" />} title="No runs yet" description="Start a run from a story." />
        )}
      </Card>
    </div>
  );
}
