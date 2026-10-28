import { useState, type FormEvent } from "react";
import { Button, Field, Input, Select, Textarea, cn } from "@ui/ui";
import { ApiError, GENDERS, STATUSES, runtime, type PatientInput } from "../api";

const empty: PatientInput = { fullName: "", email: "", phone: "", dateOfBirth: "", gender: "", status: "Active", notes: "" };

/** Client-side checks for required fields; the server performs full validation. */
function validate(v: PatientInput) {
  const e: Partial<Record<keyof PatientInput, string>> = {};
  if (!v.fullName.trim()) e.fullName = "Full name is required.";
  if (!v.email.trim()) e.email = "Email is required.";
  if (!v.dateOfBirth) e.dateOfBirth = "Date of birth is required.";
  if (!v.gender) e.gender = "Gender is required.";
  return e;
}

export function PatientForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
  pending,
  compact,
}: {
  initial?: PatientInput;
  submitLabel: string;
  onSubmit: (v: PatientInput) => Promise<unknown>;
  onCancel: () => void;
  pending: boolean;
  compact?: boolean;
}) {
  const [values, setValues] = useState<PatientInput>(initial ?? empty);
  const [errors, setErrors] = useState<Partial<Record<keyof PatientInput, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const set = (k: keyof PatientInput) => (e: { target: { value: string } }) => {
    setValues((v) => ({ ...v, [k]: e.target.value }));
    if (errors[k]) setErrors((x) => ({ ...x, [k]: undefined }));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (runtime.submitGuard && pending) return;
    const v = validate(values);
    setErrors(v);
    setFormError(null);
    if (Object.keys(v).length) {
      setFormError("Please fill in the required fields.");
      return;
    }
    try {
      await onSubmit(values);
    } catch (err) {
      if (err instanceof ApiError) {
        setFormError(err.message);
        if (err.fieldErrors) setErrors(err.fieldErrors as any);
      } else setFormError("Something went wrong. Please try again.");
    }
  };

  const busy = runtime.submitGuard && pending;
  const err = (k: keyof PatientInput) => ({ "aria-invalid": !!errors[k] || undefined, "aria-describedby": errors[k] ? `${k}-error` : undefined });

  return (
    <form onSubmit={submit} noValidate className="space-y-5">
      <div className={cn("grid gap-4", compact ? "sm:grid-cols-2" : "md:grid-cols-2")}>
        <Field label="Full Name" htmlFor="fullName" required error={errors.fullName} className="sm:col-span-2 md:col-span-2">
          <Input id="fullName" value={values.fullName} onChange={set("fullName")} placeholder="Jane Appleseed" autoComplete="off" {...err("fullName")} />
        </Field>
        <Field label="Email" htmlFor="email" required error={errors.email}>
          <Input id="email" type="text" inputMode="email" value={values.email} onChange={set("email")} placeholder="jane@example.com" autoComplete="off" {...err("email")} />
        </Field>
        <Field label="Phone Number" htmlFor="phone" error={errors.phone} hint="Optional">
          <Input id="phone" type="tel" value={values.phone} onChange={set("phone")} placeholder="+1 415 555 0100" {...err("phone")} />
        </Field>
        <Field label="Date of Birth" htmlFor="dateOfBirth" required error={errors.dateOfBirth}>
          <Input id="dateOfBirth" type="date" value={values.dateOfBirth} onChange={set("dateOfBirth")} max={new Date().toISOString().slice(0, 10)} {...err("dateOfBirth")} />
        </Field>
        <Field label="Gender" htmlFor="gender" required error={errors.gender}>
          <Select id="gender" value={values.gender} onChange={set("gender")} {...err("gender")}>
            <option value="">Select…</option>
            {GENDERS.map((g) => (
              <option key={g}>{g}</option>
            ))}
          </Select>
        </Field>
        <Field label="Patient Status" htmlFor="status" required error={errors.status}>
          <Select id="status" value={values.status} onChange={set("status")} {...err("status")}>
            {STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </Select>
        </Field>
        <Field label="Notes" htmlFor="notes" error={errors.notes} className="sm:col-span-2 md:col-span-2">
          <Textarea id="notes" value={values.notes} onChange={set("notes")} placeholder="Treatment goals, referral source, preferences…" {...err("notes")} />
        </Field>
      </div>
      {formError && (
        <p role="alert" className="rounded-[10px] bg-danger/8 px-3 py-2 text-[13px] text-danger animate-fade-in">
          {formError}
        </p>
      )}
      <div className="flex items-center justify-end gap-2 border-t border-hairline pt-4">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={busy} disabled={busy}>
          {busy ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
