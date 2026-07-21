import { useEffect, useState, type ReactNode } from "react";
import type { GoogleProfileTab } from "../../routing";
import { platformApi, type GoogleProfileSnapshot } from "../../platform/api";

const tabs: Array<{ id: GoogleProfileTab; label: string }> = [
  { id: "profile", label: "Profile" },
  { id: "reviews", label: "Reviews" },
  { id: "requests-qr", label: "Requests & QR" },
  { id: "posts-media", label: "Posts & media" },
];

export function GoogleProfileView({ businessId, locationId, tab, onTabChange, children }: { businessId: string; locationId?: string; tab: GoogleProfileTab; onTabChange: (tab: GoogleProfileTab) => void; children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<GoogleProfileSnapshot | null>(null);
  const [snapshotError, setSnapshotError] = useState("");

  useEffect(() => {
    let current = true;
    setSnapshot(null);
    setSnapshotError("");
    if (!locationId) {
      setSnapshotError("Select a location to load its Google Profile data.");
      return () => { current = false; };
    }
    void platformApi.getGoogleProfileSnapshot(businessId, locationId)
      .then((next) => { if (current) setSnapshot(next); })
      .catch(() => { if (current) setSnapshotError("The latest Google Profile data could not be loaded."); });
    return () => { current = false; };
  }, [businessId, locationId]);

  const connectionLabel = snapshot?.connection.state === "connected"
    ? "Location data connected"
    : snapshot?.connection.state === "disconnected"
      ? "Google connection unavailable"
      : snapshot ? "Google connection needs attention" : snapshotError || "Loading location data…";

  return <div className="product-feature"><div className={`google-profile-source ${snapshot?.connection.state ? `is-${snapshot.connection.state}` : snapshotError ? "is-error" : ""}`} role="status"><span>{connectionLabel}</span>{snapshot?.connection.lastSyncedAt && <small>Last synced {snapshot.connection.lastSyncedAt}</small>}</div><nav className="product-tabs" aria-label="Google Profile sections">{tabs.map((item) => <button type="button" key={item.id} className={tab === item.id ? "is-active" : undefined} aria-current={tab === item.id ? "page" : undefined} onClick={() => onTabChange(item.id)}>{item.label}</button>)}</nav>{children}</div>;
}
