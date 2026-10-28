import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import "./index.css";
import { Shell } from "./Shell";
import { OverviewPage } from "./pages/OverviewPage";
import { StoriesPage } from "./pages/StoriesPage";
import { StoryDetailPage } from "./pages/StoryDetailPage";
import { RunsPage } from "./pages/RunsPage";
import { RunViewerPage } from "./pages/RunViewerPage";
import { RegressionPage } from "./pages/RegressionPage";
import { BenchmarkPage } from "./pages/BenchmarkPage";

const queryClient = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } } });

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route element={<Shell />}>
            <Route path="/" element={<OverviewPage />} />
            <Route path="/stories" element={<StoriesPage />} />
            <Route path="/stories/:id" element={<StoryDetailPage />} />
            <Route path="/runs" element={<RunsPage />} />
            <Route path="/runs/:id" element={<RunViewerPage />} />
            <Route path="/regression" element={<RegressionPage />} />
            <Route path="/benchmark" element={<BenchmarkPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      <Toaster position="top-center" toastOptions={{ className: "!rounded-2xl !shadow-pop !text-[13.5px] !font-sans" }} />
    </QueryClientProvider>
  </React.StrictMode>,
);
