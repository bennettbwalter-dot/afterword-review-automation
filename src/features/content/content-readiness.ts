import type { ContentTab } from "../../routing";

export interface ContentSourceGuidance {
  id: "service" | "offer" | "social_idea";
  label: string;
  description: string;
}

export type ContentCapabilityKey = "manual-media" | "google-business-profile" | "facebook" | "instagram" | "linkedin" | "youtube" | "mobilewan";

export interface ContentReadinessCapability {
  id: ContentCapabilityKey;
  label: string;
  category: "manual" | "destination" | "generation";
  status: "unavailable";
  reason: string;
}

export interface ContentStageState { title: string; description: string; }

export const CONTENT_SOURCE_GUIDANCE = [
  { id: "service", label: "Service", description: "Explain a service and the customer need it solves." },
  { id: "offer", label: "Offer", description: "Describe a time-bound offer with accurate terms." },
  { id: "social_idea", label: "Campaign or post idea", description: "Start from an original campaign or post brief." },
] as const satisfies readonly ContentSourceGuidance[];

export const CONTENT_READINESS_CAPABILITIES = [
  { id: "manual-media", label: "Manual image and video", category: "manual", status: "unavailable", reason: "Private media Storage, resumable path isolation, validation, and moderation must be proven first." },
  { id: "google-business-profile", label: "Google Business Profile", category: "destination", status: "unavailable", reason: "Publishing scopes, exact destination selection, reconciliation, and a controlled pilot are not yet proven." },
  { id: "facebook", label: "Facebook Page", category: "destination", status: "unavailable", reason: "Meta approval, Page enumeration, required scopes, reconciliation, and a controlled pilot are not yet proven." },
  { id: "instagram", label: "Instagram professional account", category: "destination", status: "unavailable", reason: "Meta approval, professional-account enumeration, required scopes, reconciliation, and a controlled pilot are not yet proven." },
  { id: "linkedin", label: "LinkedIn organisation", category: "destination", status: "unavailable", reason: "LinkedIn approval, organisation enumeration, required scopes, reconciliation, and a controlled pilot are not yet proven." },
  { id: "youtube", label: "YouTube channel", category: "destination", status: "unavailable", reason: "YouTube project approval, channel enumeration, required scopes, reconciliation, and a controlled pilot are not yet proven." },
  { id: "mobilewan", label: "MobileWAN short video", category: "generation", status: "unavailable", reason: "Managed GPU benchmarks, legal clearance, moderation, private Storage, and approved prices are still required." },
] as const satisfies readonly ContentReadinessCapability[];

type QueueContentTab = Exclude<ContentTab, "create">;

export const CONTENT_STAGE_STATES: Readonly<Record<QueueContentTab, ContentStageState>> = {
  uploads: { title: "No validated uploads yet", description: "Media upload remains unavailable until private Storage and validation are proven." },
  approvals: { title: "No revisions awaiting approval", description: "Immutable content revisions and approval commands are not enabled." },
  scheduled: { title: "No approved content is scheduled", description: "Scheduling remains unavailable until its entitlement and destination workflows are proven." },
  published: { title: "No verified publications yet", description: "Only reconciled provider receipts will appear here after a destination passes its release gate." },
  failed: { title: "No failed content attempts", description: "Failed generation and destination attempts will remain independent when those workflows are enabled." },
};
