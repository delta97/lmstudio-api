import { useMemo, useState, type ReactNode } from "react";
import {
  RunStoreContext,
  type RunStoreValue,
} from "@/lib/store";
import type { CompareUrlsRequest, StoredRun } from "@/lib/types";

/** Provides the cross-screen run store (see @/lib/store). */
export function RunStoreProvider({ children }: { children: ReactNode }) {
  const [pendingConfig, setPendingConfig] =
    useState<CompareUrlsRequest | null>(null);
  const [lastRun, setLastRun] = useState<StoredRun | null>(null);

  const value = useMemo<RunStoreValue>(
    () => ({ pendingConfig, setPendingConfig, lastRun, setLastRun }),
    [pendingConfig, lastRun],
  );

  return (
    <RunStoreContext.Provider value={value}>
      {children}
    </RunStoreContext.Provider>
  );
}
