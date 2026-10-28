import { useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import { Button, Field, Input } from "@ui/ui";
import { useAuth } from "../auth";

export function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state ?? {}) as { from?: string; expired?: boolean };
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(state.expired ? "Your session has expired. Please sign in again." : null);
  const [pending, setPending] = useState(false);

  if (user) return <Navigate to={state.from ?? "/patients"} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      await login(email.trim(), password);
      navigate(state.from ?? "/patients", { replace: true });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-[380px] animate-fade-in">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-[16px] bg-accent text-white shadow-[0_8px_24px_rgba(0,122,255,0.35)]">
            <Plus className="h-7 w-7" strokeWidth={3} />
          </div>
          <h1 className="text-[26px] font-semibold tracking-[-0.022em]">Sign in to Clinic</h1>
          <p className="mt-1.5 text-[14px] text-muted">Manage patients and treatment information.</p>
        </div>
        <form onSubmit={submit} className="space-y-4 rounded-2xl bg-surface p-6 shadow-card" noValidate>
          <Field label="Email" htmlFor="email">
            <Input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@clinic.com" />
          </Field>
          <Field label="Password" htmlFor="password">
            <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
          </Field>
          {error && (
            <p role="alert" className="rounded-[10px] bg-danger/8 px-3 py-2 text-[13px] text-danger">
              {error}
            </p>
          )}
          <Button type="submit" size="lg" className="w-full" loading={pending} disabled={pending}>
            {pending ? "Signing in…" : "Sign in"}
          </Button>
        </form>
        <p className="mt-6 text-center text-[12px] text-subtle">Demo environment · seeded test data</p>
      </div>
    </div>
  );
}
