import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { RunStoreProvider } from "@/lib/store";
import SetupPage from "@/pages/SetupPage";
import LiveRunPage from "@/pages/LiveRunPage";
import ResultsPage from "@/pages/ResultsPage";
import HistoryPage from "@/pages/HistoryPage";
import NotFoundPage from "@/pages/NotFoundPage";

export default function App() {
  return (
    <BrowserRouter>
      <RunStoreProvider>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<SetupPage />} />
            <Route path="run" element={<LiveRunPage />} />
            {/* `/results/:runId?` — two entries cover the optional param. */}
            <Route path="results" element={<ResultsPage />} />
            <Route path="results/:runId" element={<ResultsPage />} />
            <Route path="history" element={<HistoryPage />} />
            <Route path="404" element={<NotFoundPage />} />
            <Route path="*" element={<Navigate to="/404" replace />} />
          </Route>
        </Routes>
      </RunStoreProvider>
    </BrowserRouter>
  );
}
