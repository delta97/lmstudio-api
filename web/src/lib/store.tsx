/**
 * Lightweight in-memory store that carries state across screens without a
 * round-trip to the backend:
 *
 *   Setup    --pendingConfig-->  Live Run
 *   Live Run --lastRun-------->  Results
 *   History  --setupPrefill--->  Setup   (the "re-run" flow)
 *
 * It lives above the router <Outlet>, so values survive client-side navigation.
 * Direct deep-links (e.g. opening /results/:id) don't rely on it — those screens
 * fall back to fetching from the API.
 */

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { CompareUrlsRequest, StoredRun } from "@/lib/types";

interface RunStoreValue {
  /** Run config handed from Setup to the Live Run screen. */
  pendingConfig: CompareUrlsRequest | null;
  setPendingConfig: (config: CompareUrlsRequest | null) => void;
  /** The most recently finished run, handed from Live Run to Results. */
  lastRun: StoredRun | null;
  setLastRun: (run: StoredRun | null) => void;
  /** Config used to prefill the Setup form (History "re-run"). */
  setupPrefill: CompareUrlsRequest | null;
  setSetupPrefill: (config: CompareUrlsRequest | null) => void;
}

const RunStoreContext = createContext<RunStoreValue | null>(null);

export function RunStoreProvider({ children }: { children: ReactNode }) {
  const [pendingConfig, setPendingConfig] =
    useState<CompareUrlsRequest | null>(null);
  const [lastRun, setLastRun] = useState<StoredRun | null>(null);
  const [setupPrefill, setSetupPrefill] =
    useState<CompareUrlsRequest | null>(null);

  const value = useMemo<RunStoreValue>(
    () => ({
      pendingConfig,
      setPendingConfig,
      lastRun,
      setLastRun,
      setupPrefill,
      setSetupPrefill,
    }),
    [pendingConfig, lastRun, setupPrefill],
  );

  return (
    <RunStoreContext.Provider value={value}>
      {children}
    </RunStoreContext.Provider>
  );
}

export function useRunStore(): RunStoreValue {
  const ctx = useContext(RunStoreContext);
  if (!ctx) {
    throw new Error("useRunStore must be used within a RunStoreProvider");
  }
  return ctx;
}
