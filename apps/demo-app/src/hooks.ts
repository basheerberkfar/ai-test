import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { api, type Patient, type PatientInput } from "./api";

export function useCreatePatient(onDone?: () => void) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: (v: PatientInput) => api<Patient>("/patients", { method: "POST", body: JSON.stringify(v) }),
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: ["patients"] });
      toast.success("Patient created", { description: `${p.fullName} was added to your patients.` });
      onDone?.();
      navigate(`/patients/${p.id}`);
    },
  });
}
