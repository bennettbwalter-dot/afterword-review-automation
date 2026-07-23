import type { GoogleProfileTab } from "../../routing";
import type { GoogleProfileSnapshot } from "../../platform/api";
import type {
  BusinessAccount,
  LocationWorkflowSummary,
  QrCodeRecord,
  RequestRecord,
  ReviewRecord,
} from "../../platform/domain";

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

export type GoogleProfileSnapshotSource =
  | { kind: "demo"; revision: number; snapshot: GoogleProfileSnapshot | null }
  | {
    kind: "live";
    revision: number;
    load: (businessId: string, locationId: string) => Promise<GoogleProfileSnapshot>;
  };

const DEMO_CAPABILITY_REASON = "Unavailable in the seeded demo. Production access requires an approved controlled pilot.";

export function buildDemoGoogleProfileSnapshot({
  business,
  locationId,
  requests,
  reviews,
  qr,
  workflow,
}: {
  business: BusinessAccount;
  locationId: string;
  requests: RequestRecord[];
  reviews: ReviewRecord[];
  qr: QrCodeRecord | null;
  workflow: LocationWorkflowSummary | null;
}): GoogleProfileSnapshot {
  return {
    businessId: business.id,
    locationId,
    connection: { state: "connected", lastSyncedAt: "Seeded sample" },
    profile: null,
    reviews: reviews.filter((review) => review.businessId === business.id && review.locationId === locationId),
    requests: requests.filter((request) => request.businessId === business.id && request.locationId === locationId),
    qr: qr?.businessId === business.id && qr.locationId === locationId ? qr : null,
    workflow: workflow?.businessId === business.id && workflow.locationId === locationId ? workflow : null,
    capabilities: Object.fromEntries(
      GOOGLE_PROFILE_CAPABILITIES.map(({ key }) => [key, { available: false, reason: DEMO_CAPABILITY_REASON }]),
    ) as GoogleProfileSnapshot["capabilities"],
  };
}

export async function resolveGoogleProfileSnapshotSource(
  source: GoogleProfileSnapshotSource,
  businessId: string,
  locationId: string,
) {
  if (source.kind === "live") return source.load(businessId, locationId);
  if (source.snapshot?.businessId !== businessId || source.snapshot.locationId !== locationId) {
    throw new Error("The selected demo location snapshot is unavailable.");
  }
  return source.snapshot;
}
