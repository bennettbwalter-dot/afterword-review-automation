import { useEffect, useState, type ReactNode } from "react";
import type { GoogleProfileTab } from "../../routing";
import { platformApi, type GoogleProfileSnapshot } from "../../platform/api";
import { googleProfileSnapshotState, googleProfileTabsForSelection, type GoogleProfileSnapshotError } from "./google-profile-domain";

export { googleProfileSnapshotState, type GoogleProfileSnapshotError, type GoogleProfileSnapshotState } from "./google-profile-domain";

export function GoogleProfileSnapshotContent({ snapshot, snapshotError, children }: { snapshot: GoogleProfileSnapshot | null; snapshotError: string; children: (snapshot: GoogleProfileSnapshot) => ReactNode }) {
  if (snapshotError) return <section className="panel empty-state" role="alert"><h2>Location data unavailable.</h2><p>{snapshotError}</p></section>;
  if (!snapshot) return <section className="panel empty-state" role="status" aria-busy="true"><h2>Loading location data…</h2><p>Loading the selected location’s Google Profile records.</p></section>;
  return <>{children(snapshot)}</>;
}

export function GoogleProfileView({ businessId, locationId, tab, onTabChange, children }: { businessId: string; locationId?: string; tab: GoogleProfileTab; onTabChange: (tab: GoogleProfileTab) => void; children: (snapshot: GoogleProfileSnapshot) => ReactNode }) {
  const [snapshot, setSnapshot] = useState<GoogleProfileSnapshot | null>(null);
  const [snapshotError, setSnapshotError] = useState<GoogleProfileSnapshotError | null>(null);

  useEffect(() => {
    let current = true;
    setSnapshot(null);
    setSnapshotError(null);
    if (!locationId) {
      setSnapshotError({ businessId, locationId, message: "Select a location to load its Google Profile data." });
      return () => { current = false; };
    }
    void platformApi.getGoogleProfileSnapshot(businessId, locationId)
      .then((next) => { if (current) setSnapshot(next); })
      .catch(() => { if (current) setSnapshotError({ businessId, locationId, message: "The latest Google Profile data could not be loaded." }); });
    return () => { current = false; };
  }, [businessId, locationId]);

  const snapshotState = googleProfileSnapshotState({ businessId, locationId, snapshot, snapshotError });
  const currentSnapshot = snapshotState.snapshot;
  const currentSnapshotError = snapshotState.error;
  const connectionLabel = currentSnapshot?.connection.state === "connected"
    ? "Location data connected"
    : currentSnapshot?.connection.state === "disconnected"
      ? "Google connection unavailable"
      : currentSnapshot ? "Google connection needs attention" : currentSnapshotError || "Loading location data…";

  return <div className="product-feature"><div className={`google-profile-source ${currentSnapshot?.connection.state ? `is-${currentSnapshot.connection.state}` : currentSnapshotError ? "is-error" : ""}`} role="status"><span>{connectionLabel}</span>{currentSnapshot?.connection.lastSyncedAt && <small>Last synced {currentSnapshot.connection.lastSyncedAt}</small>}</div><nav className="product-tabs" aria-label="Google Profile sections">{googleProfileTabsForSelection(tab).map((item) => <button type="button" key={item.id} className={item.selected ? "is-active" : undefined} aria-current={item.selected ? "page" : undefined} onClick={() => onTabChange(item.id)}>{item.label}</button>)}</nav><GoogleProfileSnapshotContent snapshot={currentSnapshot} snapshotError={currentSnapshotError}>{children}</GoogleProfileSnapshotContent></div>;
}
