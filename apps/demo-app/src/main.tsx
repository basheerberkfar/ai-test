import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import "./index.css";
import { AuthProvider, RequireAuth } from "./auth";
import { LoginPage } from "./pages/LoginPage";
import { PatientsPage } from "./pages/PatientsPage";
import { PatientDetailPage } from "./pages/PatientDetailPage";
import { PatientFormPage } from "./pages/PatientFormPage";
import { AppShell } from "./components/AppShell";

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } });

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route
              element={
                <RequireAuth>
                  <AppShell />
                </RequireAuth>
              }
            >
              <Route path="/patients" element={<PatientsPage />} />
              <Route path="/patients/new" element={<PatientFormPage mode="create" />} />
              <Route path="/patients/:id" element={<PatientDetailPage />} />
              <Route path="/patients/:id/edit" element={<PatientFormPage mode="edit" />} />
            </Route>
            <Route path="*" element={<Navigate to="/patients" replace />} />
          </Routes>
          <Toaster position="top-center" toastOptions={{ className: "!rounded-2xl !shadow-pop !text-[13.5px] !font-sans" }} />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
