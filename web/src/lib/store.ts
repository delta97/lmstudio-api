/**
 * Lightweight in-memory store that carries state across screens without a
 * round-trip to the backend:
 *
 *   Setup    --pendingConfig-->  Live Run
 *   Live Run --lastRun-------->  Results
 *
 * It lives above the router <Outlet> (see RunStoreProvider), so values survive
 * client-side navigation. Direct deep-links (e.g. opening /results/:id) don't
 * rely on it — those screens fall back to fetching from the API.
 *
 * The History "re-run" flow prefills Setup via router navigation state rather
 * than this store (see HistoryPage / SetupPage).
 */

import { createContext, useContext } from "react";
import type { CompareUrlsRequest, StoredRun } from "@/lib/types";

export interface RunStoreValue {
  /** Run config handed from Setup to the Live Run screen. */
  pendingConfig: CompareUrlsRequest | null;
  setPendingConfig: (config: CompareUrlsRequest | null) => void;
  /** The most recently finished run, handed from Live Run to Results. */
  lastRun: StoredRun | null;
  setLastRun: (run: StoredRun | null) => void;
}

export const RunStoreContext = createContext<RunStoreValue | null>(null);

export function useRunStore(): RunStoreValue {
  const ctx = useContext(RunStoreContext);
  if (!ctx) {
    throw new Error("useRunStore must be used within a RunStoreProvider");
  }
  return ctx;
}
