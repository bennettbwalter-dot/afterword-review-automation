import { useEffect, useState, type ReactNode } from "react";
import type { GoogleProfileTab } from "../../routing";
import { platformApi, type GoogleProfileSnapshot } from "../../platform/api";

const tabs: Array<{ id: GoogleProfileTab; label: string }> = [
  { id: "profile", label: "Profile" },
  { id: "reviews", label: "Reviews" },
  { id: "requests-qr", label: "Requests & QR" },
  { id: "posts-media", label: "Posts & media" },
];

const capabilityLabels: Array<[keyof GoogleProfileSnapshot["capabilities"], string]> = [
  ["profileFields", "Profile fields"],
  ["services", "Services"],
  ["attributes", "Attributes"],
  ["reviewReplies", "Review replies"],
  ["posts", "Local posts"],
  ["images", "Location images"],
  ["videos", "Location videos"],
];

export function GoogleProfileSnapshotContent({ snapshot, snapshotError, children }: { snapshot: GoogleProfileSnapshot | null; snapshotError: string; children: (snapshot: GoogleProfileSnapshot) => ReactNode }) {
  if (snapshotError) return <section className="panel empty-state" role="alert"><h2>Location data unavailable.</h2><p>{snapshotError}</p></section>;
  if (!snapshot) return <section className="panel empty-state" role="status" aria-busy="true"><h2>Loading location data…</h2><p>Loading the selected location’s Google Profile records.</p></section>;
  return <>{children(snapshot)}</>;
}

export interface GoogleProfileSnapshotError {
  businessId: string;
  locationId?: string;
  message: string;
}

export type GoogleProfileSnapshotState =
  | { phase: "loading"; snapshot: null; error: "" }
  | { phase: "error"; snapshot: null; error: string }
  | { phase: "ready"; snapshot: GoogleProfileSnapshot; error: "" };

export function googleProfileSnapshotState({ businessId, locationId, snapshot, snapshotError }: { businessId: string; locationId?: string; snapshot: GoogleProfileSnapshot | null; snapshotError: GoogleProfileSnapshotError | null }): GoogleProfileSnapshotState {
  if (!locationId) return { phase: "error", snapshot: null, error: "Select a location to load its Google Profile data." };
  if (snapshotError?.businessId === businessId && snapshotError.locationId === locationId) return { phase: "error", snapshot: null, error: snapshotError.message };
  if (snapshot?.businessId !== businessId || snapshot.locationId !== locationId) return { phase: "loading", snapshot: null, error: "" };
  return { phase: "ready", snapshot, error: "" };
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

  return <div className="product-feature"><div className={`google-profile-source ${currentSnapshot?.connection.state ? `is-${currentSnapshot.connection.state}` : currentSnapshotError ? "is-error" : ""}`} role="status"><span>{connectionLabel}</span>{currentSnapshot?.connection.lastSyncedAt && <small>Last synced {currentSnapshot.connection.lastSyncedAt}</small>}</div><nav className="product-tabs" aria-label="Google Profile sections">{tabs.map((item) => <button type="button" key={item.id} className={tab === item.id ? "is-active" : undefined} aria-current={tab === item.id ? "page" : undefined} onClick={() => onTabChange(item.id)}>{item.label}</button>)}</nav>{tab === "profile" && currentSnapshot && <section className="google-capability-ledger" aria-label="Google write capabilities"><header><span>Write capabilities</span><small>Each action is enabled only after its own approval and controlled pilot.</small></header><div>{capabilityLabels.map(([key, label]) => <article key={key}><div><strong>{label}</strong><small>{currentSnapshot.capabilities[key].reason}</small></div><span>Unavailable</span></article>)}</div></section>}<GoogleProfileSnapshotContent snapshot={currentSnapshot} snapshotError={currentSnapshotError}>{children}</GoogleProfileSnapshotContent></div>;
}
