import { NavLink, Outlet } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, BrainCircuit, FlaskConical, LayoutGrid, PlayCircle } from "lucide-react";
import { cn } from "@ui/ui";
import { lab } from "./lib";

const nav = [
  { to: "/", label: "Overview", icon: LayoutGrid, end: true },
  { to: "/stories", label: "Stories", icon: BookOpen },
  { to: "/runs", label: "Test Runs", icon: PlayCircle },
  { to: "/regression", label: "Regression Memory", icon: BrainCircuit },
  { to: "/benchmark", label: "Benchmark", icon: FlaskConical },
];

export function Shell() {
  const status = useQuery({ queryKey: ["status"], queryFn: () => lab<any>("/status"), staleTime: 60_000 });
  const ai = status.data?.ai;
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-hairline bg-surface/50 px-3 py-5 lg:flex">
        <div className="flex items-center gap-2.5 px-2">
          <div className="grid h-7 w-7 place-items-center rounded-[8px] bg-ink">
            <div className="h-3 w-3 rounded-full border-[2.5px] border-white" />
          </div>
          <div>
            <p className="text-[14px] font-semibold leading-tight tracking-tight">AI Test Lab</p>
            <p className="text-[11px] text-muted">Story-driven E2E</p>
          </div>
        </div>
        <nav className="mt-8 flex-1 space-y-0.5">
          {nav.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) => cn("flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-[13.5px] font-medium transition-colors", isActive ? "bg-ink/[0.06] text-ink" : "text-muted hover:bg-fill hover:text-ink")}
            >
              <n.icon className="h-4 w-4" />
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="rounded-xl bg-fill/60 p-3 text-[12px]">
          <div className="flex items-center gap-1.5 font-medium">
            <span className={cn("h-1.5 w-1.5 rounded-full", ai?.configured ? "bg-success" : "bg-warning")} />
            {ai ? ai.provider : "…"}
          </div>
          <p className="mt-0.5 truncate text-muted">{ai ? (ai.configured ? ai.model : "API key not configured") : "Checking…"}</p>
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <nav className="glass sticky top-0 z-20 flex gap-1 overflow-x-auto border-b border-hairline px-4 py-2 lg:hidden">
          {nav.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => cn("whitespace-nowrap rounded-full px-3 py-1.5 text-[13px] font-medium", isActive ? "bg-ink text-white" : "text-muted")}>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <main className="mx-auto max-w-[1240px] px-5 py-8 lg:px-10">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
