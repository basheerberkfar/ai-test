export type User = { id: number; email: string; name: string; role: "therapist" | "admin" };
export type Patient = {
  id: number;
  fullName: string;
  email: string;
  phone: string;
  dateOfBirth: string;
  gender: string;
  status: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
};
export type PatientInput = Omit<Patient, "id" | "createdAt" | "updatedAt">;
export type PatientPage = { items: Patient[]; page: number; pageSize: number; total: number; totalPages: number };

export const STATUSES = ["Active", "Inactive", "On Hold", "Discharged"] as const;
export const GENDERS = ["Female", "Male", "Non-binary", "Prefer not to say"] as const;

declare global {
  interface Window {
    __RUNTIME__?: { layout: "classic" | "refresh"; submitGuard: boolean };
  }
}
export const runtime = window.__RUNTIME__ ?? { layout: "classic", submitGuard: true };

const SESSION_KEY = "demo.session";
export const session = {
  get(): { token: string; user: User } | null {
    try {
      return JSON.parse(localStorage.getItem(SESSION_KEY) ?? "null");
    } catch {
      return null;
    }
  },
  set(v: { token: string; user: User }) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(v));
  },
  clear() {
    localStorage.removeItem(SESSION_KEY);
  },
};

export class ApiError extends Error {
  constructor(message: string, public status: number, public fieldErrors?: Record<string, string>) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = session.get()?.token;
  let res: Response;
  try {
    res = await fetch(`/api/demo${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init.headers },
    });
  } catch {
    throw new ApiError("Can't reach the server. Check your connection and try again.", 0);
  }
  if (res.status === 401 && path !== "/auth/login") {
    session.clear();
    window.dispatchEvent(new Event("session-expired"));
  }
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(body.error ?? `Request failed (${res.status})`, res.status, body.fieldErrors);
  return body as T;
}
