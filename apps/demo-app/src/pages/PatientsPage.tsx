import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, ChevronRight as Chevron, Plus, Search, UserPlus, Users } from "lucide-react";
import { Button, Card, Dialog, DialogContent, EmptyState, Input, PageHeader, Segmented, Select, Skeleton, Table, Td, Th, Tr } from "@ui/ui";
import { api, runtime, STATUSES, type PatientPage } from "../api";
import { StatusBadge } from "../components/StatusBadge";
import { PatientForm } from "../components/PatientForm";
import { useCreatePatient } from "../hooks";

const formatDate = (d: string) => new Date(d + "T00:00:00").toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

export function PatientsPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const status = params.get("status") ?? "All";
  const page = Number(params.get("page") ?? 1);
  const search = params.get("q") ?? "";
  const [searchInput, setSearchInput] = useState(search);
  const [createOpen, setCreateOpen] = useState(false);
  const refresh = runtime.layout === "refresh";

  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) (v === null || v === "" || v === "All" ? next.delete(k) : next.set(k, v));
    setParams(next, { replace: true });
  };

  // Debounced search
  useEffect(() => {
    const t = setTimeout(() => searchInput !== search && update({ q: searchInput.trim(), page: null }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  const query = useQuery({
    queryKey: ["patients", { search, status, page }],
    queryFn: () => {
      const qs = new URLSearchParams({ page: String(page) });
      if (search) qs.set("search", search);
      if (status !== "All") qs.set("status", status);
      return api<PatientPage>(`/patients?${qs}`);
    },
    placeholderData: keepPreviousData,
  });

  const create = useCreatePatient(() => setCreateOpen(false));
  const data = query.data;

  const statusControl = refresh ? (
    <Select aria-label="Status" value={status} onChange={(e) => update({ status: e.target.value, page: null })} className="w-40">
      <option value="All">All statuses</option>
      {STATUSES.map((s) => (
        <option key={s}>{s}</option>
      ))}
    </Select>
  ) : (
    <Segmented
      ariaLabel="Filter by status"
      value={status}
      onChange={(v) => update({ status: v, page: null })}
      options={[{ value: "All", label: "All" }, ...STATUSES.map((s) => ({ value: s, label: s }))]}
    />
  );

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Patients"
        subtitle={data ? `${data.total} ${data.total === 1 ? "patient" : "patients"}` : "Loading…"}
        actions={
          !refresh && (
            <Button asChild>
              <Link to="/patients/new">
                <Plus className="h-4 w-4" /> Add Patient
              </Link>
            </Button>
          )
        }
      />

      <Card>
        <div className="flex flex-wrap items-center gap-3 p-4">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
            <Input aria-label="Search patients by name" placeholder="Search by name" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} className="pl-9" />
          </div>
          {statusControl}
          {refresh && (
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <Button onClick={() => setCreateOpen(true)}>
                <UserPlus className="h-4 w-4" /> New patient
              </Button>
              <DialogContent title="New patient" description="Fields marked * are required." wide>
                <PatientForm submitLabel="Create patient" pending={create.isPending} onSubmit={(v) => create.mutateAsync(v)} onCancel={() => setCreateOpen(false)} compact />
              </DialogContent>
            </Dialog>
          )}
        </div>

        {query.isError ? (
          <div role="alert" className="border-t border-hairline px-6 py-10 text-center">
            <p className="text-[14px] font-medium">Couldn't load patients</p>
            <p className="mt-1 text-[13px] text-muted">{(query.error as Error).message}</p>
            <Button variant="secondary" size="sm" className="mt-4" onClick={() => query.refetch()}>
              Try again
            </Button>
          </div>
        ) : !data ? (
          <div className="space-y-3 border-t border-hairline p-5">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-9" />
            ))}
          </div>
        ) : data.items.length === 0 ? (
          <div className="border-t border-hairline">
            <EmptyState icon={<Users className="h-5 w-5" />} title="No patients found" description={search || status !== "All" ? "Try a different search or filter." : "Add your first patient to get started."} />
          </div>
        ) : (
          <Table aria-busy={query.isFetching}>
            <thead>
              <tr>
                <Th>Name</Th>
                {refresh ? <Th>Status</Th> : <Th className="hidden md:table-cell">Email</Th>}
                {refresh ? <Th className="hidden md:table-cell">Email</Th> : <Th className="hidden lg:table-cell">Date of Birth</Th>}
                {refresh ? <Th className="hidden lg:table-cell">Born</Th> : <Th>Status</Th>}
                <Th className="w-10">
                  <span className="sr-only">Open</span>
                </Th>
              </tr>
            </thead>
            <tbody className={query.isFetching ? "opacity-60 transition-opacity" : "transition-opacity"}>
              {data.items.map((p) => {
                const email = <Td className="hidden text-muted md:table-cell">{p.email}</Td>;
                const dob = <Td className="hidden text-muted lg:table-cell">{formatDate(p.dateOfBirth)}</Td>;
                const st = (
                  <Td>
                    <StatusBadge status={p.status} />
                  </Td>
                );
                return (
                  <Tr key={p.id} className="cursor-pointer" onClick={() => navigate(`/patients/${p.id}`)}>
                    <Td>
                      <Link to={`/patients/${p.id}`} className="font-medium hover:text-accent" onClick={(e) => e.stopPropagation()}>
                        {p.fullName}
                      </Link>
                    </Td>
                    {refresh ? (
                      <>
                        {st}
                        {email}
                        {dob}
                      </>
                    ) : (
                      <>
                        {email}
                        {dob}
                        {st}
                      </>
                    )}
                    <Td className="text-right text-subtle">
                      <Chevron className="ml-auto h-4 w-4" />
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}

        {data && data.totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-hairline px-4 py-3 text-[13px] text-muted">
            <span>
              Page {data.page} of {data.totalPages}
            </span>
            <div className="flex gap-1.5">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => update({ page: String(page - 1) })}>
                <ChevronLeft className="h-3.5 w-3.5" /> Previous
              </Button>
              <Button variant="outline" size="sm" disabled={page >= data.totalPages} onClick={() => update({ page: String(page + 1) })}>
                Next <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
