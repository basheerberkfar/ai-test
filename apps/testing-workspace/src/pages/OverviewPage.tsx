import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, BookOpen, BrainCircuit, CheckCircle2, PlayCircle, Sparkles, XCircle } from "lucide-react";
import { Card, CardHeader, CardTitle, EmptyState, PageHeader, Skeleton } from "@ui/ui";
import { lab, type Run } from "../lib";
import { RunsTable } from "./RunsPage";

function Stat({ label, value, icon: Icon, tone, to }: { label: string; value?: number; icon: any; tone: string; to?: string }) {
  const inner = (
    <Card className="p-5 transition-shadow hover:shadow-pop">
      <div className="flex items-center justify-between">
        <p className="text-[13px] font-medium text-muted">{label}</p>
        <Icon className="h-4 w-4" style={{ color: tone }} />
      </div>
      {value === undefined ? <Skeleton className="mt-3 h-8 w-16" /> : <p className="mt-2 text-[32px] font-semibold tracking-[-0.03em] tabular-nums">{value}</p>}
    </Card>
  );
  return to ? <Link to={to}>{inner}</Link> : inner;
}

export function OverviewPage() {
  const { data } = useQuery({
    queryKey: ["overview"],
    queryFn: () => lab<any>("/overview"),
    refetchInterval: (q) => (q.state.data?.latestRuns?.some((r: Run) => r.status === "running" || r.status === "queued") ? 3000 : false),
  });
  const status = useQuery({ queryKey: ["status"], queryFn: () => lab<any>("/status") });

  return (
    <div className="animate-fade-in">
      <PageHeader title="Overview" subtitle="Every number below comes from recorded browser executions." />
      {status.data && !status.data.ai.configured && (
        <div className="mb-6 flex items-start gap-3 rounded-2xl bg-warning/10 p-4 text-[13.5px]">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <p>
            <span className="font-medium">No AI provider key configured.</span> Copy <code className="font-mono text-[12px]">.env.example</code> to{" "}
            <code className="font-mono text-[12px]">.env</code> and set <code className="font-mono text-[12px]">{status.data.ai.provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY"}</code>, then restart the server.
          </p>
        </div>
      )}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        <Stat label="Stories" value={data?.totalStories} icon={BookOpen} tone="#007AFF" to="/stories" />
        <Stat label="Test Runs" value={data?.totalRuns} icon={PlayCircle} tone="#1D1D1F" to="/runs" />
        <Stat label="Passed Scenarios" value={data?.passedScenarios} icon={CheckCircle2} tone="#34C759" />
        <Stat label="Failed Scenarios" value={data?.failedScenarios} icon={XCircle} tone="#FF3B30" />
        <Stat label="AI-Discovered Scenarios" value={data?.discoveredScenarios} icon={Sparkles} tone="#AF52DE" to="/regression" />
        <Stat label="Verified Defects" value={data?.verifiedDefects} icon={AlertTriangle} tone="#FF9500" />
      </div>
      {data && data.pendingProposals > 0 && (
        <Link to="/regression" className="mt-4 flex items-center gap-2 rounded-2xl bg-accent/8 px-4 py-3 text-[13.5px] text-accent hover:bg-accent/12">
          <BrainCircuit className="h-4 w-4" /> {data.pendingProposals} proposed regression scenario{data.pendingProposals > 1 ? "s" : ""} waiting for review →
        </Link>
      )}
      <Card className="mt-6">
        <CardHeader className="pb-3">
          <CardTitle>Latest Test Runs</CardTitle>
        </CardHeader>
        {data?.latestRuns?.length ? (
          <RunsTable runs={data.latestRuns} />
        ) : data ? (
          <EmptyState icon={<PlayCircle className="h-5 w-5" />} title="No test runs yet" description="Open a story and click Run AI Tests to start the first browser execution." />
        ) : (
          <div className="space-y-2 p-5">
            <Skeleton className="h-9" />
            <Skeleton className="h-9" />
          </div>
        )}
      </Card>
    </div>
  );
}
