import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { api, session, type User } from "./api";

type AuthState = { user: User | null; login: (email: string, password: string) => Promise<void>; logout: () => Promise<void> };
const AuthContext = createContext<AuthState>(null!);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => session.get()?.user ?? null);
  const navigate = useNavigate();
  const qc = useQueryClient();

  useEffect(() => {
    const onExpired = () => {
      setUser(null);
      qc.clear();
      navigate("/login", { replace: true, state: { expired: true } });
    };
    window.addEventListener("session-expired", onExpired);
    return () => window.removeEventListener("session-expired", onExpired);
  }, [navigate, qc]);

  const login = async (email: string, password: string) => {
    const res = await api<{ token: string; user: User }>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
    session.set(res);
    setUser(res.user);
  };
  const logout = async () => {
    await api("/auth/logout", { method: "POST" }).catch(() => {});
    session.clear();
    qc.clear();
    setUser(null);
    navigate("/login", { replace: true });
  };
  return <AuthContext.Provider value={{ user, login, logout }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const location = useLocation();
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return <>{children}</>;
}
