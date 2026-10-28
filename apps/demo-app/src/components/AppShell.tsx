import { NavLink, Outlet } from "react-router-dom";
import { CalendarDays, LogOut, Plus, Settings, Users } from "lucide-react";
import { cn, Button } from "@ui/ui";
import { runtime } from "../api";
import { useAuth } from "../auth";

const Brand = () => (
  <div className="flex items-center gap-2.5">
    <div className="grid h-7 w-7 place-items-center rounded-[8px] bg-accent text-white shadow-sm">
      <Plus className="h-4 w-4" strokeWidth={3} />
    </div>
    <span className="text-[15px] font-semibold tracking-tight">Clinic</span>
  </div>
);

function UserChip({ compact }: { compact?: boolean }) {
  const { user, logout } = useAuth();
  if (!user) return null;
  return (
    <div className={cn("flex items-center gap-2.5", !compact && "rounded-xl bg-fill/60 p-2.5")}>
      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#5ac8fa] to-accent text-[12px] font-semibold text-white">
        {user.name.split(" ").map((p) => p[0]).slice(-2).join("")}
      </div>
      {!compact && (
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium">{user.name}</p>
          <p className="text-[11.5px] capitalize text-muted">{user.role}</p>
        </div>
      )}
      <Button variant="ghost" size="icon" onClick={logout} aria-label="Sign out" title="Sign out">
        <LogOut className="h-4 w-4" />
      </Button>
    </div>
  );
}

const nav = [
  { to: "/patients", label: "Patients", icon: Users, enabled: true },
  { to: "/schedule", label: "Schedule", icon: CalendarDays, enabled: false },
  { to: "/settings", label: "Settings", icon: Settings, enabled: false },
];

export function AppShell() {
  if (runtime.layout === "refresh") {
    return (
      <div className="min-h-screen">
        <header className="glass sticky top-0 z-30 border-b border-hairline">
          <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-6">
            <Brand />
            <nav className="flex items-center gap-1">
              {nav
                .filter((n) => n.enabled)
                .map((n) => (
                  <NavLink
                    key={n.to}
                    to={n.to}
                    className={({ isActive }) => cn("rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors", isActive ? "bg-ink text-white" : "text-muted hover:text-ink")}
                  >
                    {n.label}
                  </NavLink>
                ))}
            </nav>
            <div className="ml-auto">
              <UserChip compact />
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-6 py-8">
          <Outlet />
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-hairline bg-surface/60 px-3 py-5 md:flex">
        <div className="px-2">
          <Brand />
        </div>
        <nav className="mt-8 flex-1 space-y-0.5">
          {nav.map((n) =>
            n.enabled ? (
              <NavLink
                key={n.to}
                to={n.to}
                className={({ isActive }) =>
                  cn("flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-[13.5px] font-medium transition-colors", isActive ? "bg-accent/10 text-accent" : "text-ink hover:bg-fill")
                }
              >
                <n.icon className="h-4 w-4" />
                {n.label}
              </NavLink>
            ) : (
              <span key={n.to} className="flex cursor-default items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-[13.5px] text-subtle" title="Coming soon">
                <n.icon className="h-4 w-4" />
                {n.label}
              </span>
            ),
          )}
        </nav>
        <UserChip />
      </aside>
      <div className="min-w-0 flex-1">
        <div className="glass sticky top-0 z-20 flex items-center justify-between border-b border-hairline px-5 py-3 md:hidden">
          <Brand />
          <UserChip compact />
        </div>
        <main className="mx-auto max-w-6xl px-5 py-8 md:px-10">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
