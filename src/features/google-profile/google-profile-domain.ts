import type { GoogleProfileTab } from "../../routing";
import type { GoogleProfileSnapshot } from "../../platform/api";

export const GOOGLE_PROFILE_TABS: ReadonlyArray<{ id: GoogleProfileTab; label: string }> = [
  { id: "profile", label: "Profile" },
  { id: "reviews", label: "Reviews" },
  { id: "requests-qr", label: "Requests & QR" },
  { id: "posts-media", label: "Posts & media" },
];

export function googleProfileTabsForSelection(selectedTab: GoogleProfileTab) {
  return GOOGLE_PROFILE_TABS.map((tab) => ({ ...tab, selected: tab.id === selectedTab }));
}

export const GOOGLE_PROFILE_CAPABILITIES: ReadonlyArray<{ key: keyof GoogleProfileSnapshot["capabilities"]; label: string }> = [
  { key: "profileFields", label: "Profile fields" },
  { key: "services", label: "Services" },
  { key: "attributes", label: "Attributes" },
  { key: "reviewReplies", label: "Review replies" },
  { key: "posts", label: "Local posts" },
  { key: "images", label: "Location images" },
  { key: "videos", label: "Location videos" },
];

export type GoogleProfileSnapshotError = {
  businessId: string;
  locationId?: string;
  message: string;
};

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

export function googleProfileWriteCapabilityLedger(snapshot: GoogleProfileSnapshot) {
  return GOOGLE_PROFILE_CAPABILITIES.map(({ key, label }) => ({
    key,
    label,
    reason: snapshot.capabilities[key].reason,
    status: "Unavailable" as const,
  }));
}

export function requestDataForGoogleProfileSnapshot(snapshot: GoogleProfileSnapshot) {
  return { requests: snapshot.requests, workflow: snapshot.workflow, qr: snapshot.qr };
}
