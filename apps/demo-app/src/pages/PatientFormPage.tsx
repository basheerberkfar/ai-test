import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, PageHeader, Skeleton } from "@ui/ui";
import { api, type Patient, type PatientInput } from "../api";
import { PatientForm } from "../components/PatientForm";
import { useCreatePatient } from "../hooks";

export function PatientFormPage({ mode }: { mode: "create" | "edit" }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const create = useCreatePatient();
  const existing = useQuery({ queryKey: ["patient", id], queryFn: () => api<Patient>(`/patients/${id}`), enabled: mode === "edit" });
  const update = useMutation({
    mutationFn: (v: PatientInput) => api<Patient>(`/patients/${id}`, { method: "PUT", body: JSON.stringify(v) }),
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: ["patients"] });
      qc.setQueryData(["patient", id], p);
      toast.success("Changes saved");
      navigate(`/patients/${p.id}`);
    },
  });

  const back = mode === "edit" ? `/patients/${id}` : "/patients";

  return (
    <div className="mx-auto max-w-3xl animate-fade-in">
      <Link to={back} className="mb-4 inline-flex items-center gap-1 text-[13px] font-medium text-accent hover:underline">
        <ChevronLeft className="h-4 w-4" /> {mode === "edit" ? "Back to patient" : "Patients"}
      </Link>
      <PageHeader title={mode === "edit" ? "Edit Patient" : "Add Patient"} subtitle={mode === "create" ? "Fields marked * are required." : undefined} />
      <Card>
        <CardContent className="p-6">
          {mode === "edit" && !existing.data ? (
            existing.isError ? (
              <p role="alert" className="text-[14px] text-danger">{(existing.error as Error).message}</p>
            ) : (
              <div className="space-y-4">
                <Skeleton className="h-9" />
                <Skeleton className="h-9" />
                <Skeleton className="h-24" />
              </div>
            )
          ) : (
            <PatientForm
              initial={existing.data ? { ...existing.data } : undefined}
              submitLabel={mode === "edit" ? "Save changes" : "Save patient"}
              pending={mode === "edit" ? update.isPending : create.isPending}
              onSubmit={(v) => (mode === "edit" ? update.mutateAsync(v) : create.mutateAsync(v))}
              onCancel={() => navigate(back)}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
