// React hook form of the quiet sync-status feed.
import { useEffect, useState } from "react";
import { getSyncStatus, onSyncStatus, type SyncStatus } from "./autoSync";

export function useSyncStatus(): SyncStatus {
  const [s, setS] = useState<SyncStatus>(() => getSyncStatus());
  useEffect(() => onSyncStatus(setS), []);
  return s;
}

/** True while a fresh device is still downloading (or retrying) its data. */
export function useInitialDownloadActive(): boolean {
  const s = useSyncStatus();
  return s.phase === "initial" || s.initialPending;
}
