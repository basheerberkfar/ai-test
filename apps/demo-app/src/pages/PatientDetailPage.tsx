import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button, Card, CardContent, Dialog, DialogClose, DialogContent, Skeleton } from "@ui/ui";
import { api, type Patient } from "../api";
import { useAuth } from "../auth";
import { StatusBadge } from "../components/StatusBadge";

const fmtDate = (d: string) => new Date(d + "T00:00:00").toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
const age = (d: string) => {
  const b = new Date(d + "T00:00:00");
  const n = new Date();
  return n.getFullYear() - b.getFullYear() - (n < new Date(n.getFullYear(), b.getMonth(), b.getDate()) ? 1 : 0);
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-4 border-t border-hairline py-3.5 first:border-t-0">
      <dt className="text-[13px] text-muted">{label}</dt>
      <dd className="col-span-2 text-[14px]">{children}</dd>
    </div>
  );
}

export function PatientDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const { data: p, isError, error } = useQuery({ queryKey: ["patient", id], queryFn: () => api<Patient>(`/patients/${id}`) });
  const del = useMutation({
    mutationFn: () => api(`/patients/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["patients"] });
      toast.success("Patient deleted");
      navigate("/patients");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="mx-auto max-w-3xl animate-fade-in">
      <Link to="/patients" className="mb-4 inline-flex items-center gap-1 text-[13px] font-medium text-accent hover:underline">
        <ChevronLeft className="h-4 w-4" /> Patients
      </Link>

      {isError ? (
        <Card>
          <CardContent>
            <p role="alert" className="text-[14px]">{(error as Error).message}</p>
          </CardContent>
        </Card>
      ) : !p ? (
        <Card>
          <CardContent className="space-y-4">
            <Skeleton className="h-8 w-1/2" />
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-40" />
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="mb-6 flex flex-wrap items-center gap-4">
            <div className="grid h-14 w-14 place-items-center rounded-full bg-gradient-to-br from-[#e5e5ea] to-[#d1d1d6] text-[18px] font-semibold text-muted">
              {p.fullName.split(" ").map((x) => x[0]).slice(0, 2).join("")}
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="break-words text-[26px] font-semibold tracking-[-0.022em]">{p.fullName}</h1>
              <div className="mt-1 flex items-center gap-2 text-[13px] text-muted">
                <StatusBadge status={p.status} /> <span>Patient #{p.id}</span>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" asChild>
                <Link to={`/patients/${p.id}/edit`}>
                  <Pencil className="h-3.5 w-3.5" /> Edit
                </Link>
              </Button>
              {user?.role === "admin" && (
                <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
                  <Button variant="danger-ghost" onClick={() => setConfirmOpen(true)}>
                    <Trash2 className="h-3.5 w-3.5" /> Delete
                  </Button>
                  <DialogContent title={`Delete ${p.fullName}?`} description="This permanently removes the patient and their information. This cannot be undone.">
                    <div className="flex justify-end gap-2">
                      <DialogClose asChild>
                        <Button variant="secondary">Cancel</Button>
                      </DialogClose>
                      <Button variant="danger" loading={del.isPending} disabled={del.isPending} onClick={() => del.mutate()}>
                        Delete patient
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>
              )}
            </div>
          </div>

          <Card>
            <CardContent className="py-2">
              <dl>
                <Row label="Full Name">{p.fullName}</Row>
                <Row label="Email">{p.email}</Row>
                <Row label="Phone Number">{p.phone || <span className="text-subtle">—</span>}</Row>
                <Row label="Date of Birth">
                  {fmtDate(p.dateOfBirth)} <span className="text-muted">· {age(p.dateOfBirth)} years</span>
                </Row>
                <Row label="Gender">{p.gender}</Row>
                <Row label="Status">
                  <StatusBadge status={p.status} />
                </Row>
                <Row label="Notes">{p.notes ? <p className="whitespace-pre-wrap break-words">{p.notes}</p> : <span className="text-subtle">No notes</span>}</Row>
              </dl>
            </CardContent>
          </Card>
          <p className="mt-3 text-[12px] text-subtle">
            Created {new Date(p.createdAt).toLocaleString()} · Updated {new Date(p.updatedAt).toLocaleString()}
          </p>
        </>
      )}
    </div>
  );
}
