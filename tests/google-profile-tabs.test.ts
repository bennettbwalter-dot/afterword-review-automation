import assert from "node:assert/strict";
import test from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  GOOGLE_PROFILE_CAPABILITIES,
  GOOGLE_PROFILE_TABS,
  googleProfileSnapshotState,
  googleProfileTabsForSelection,
  googleProfileWriteCapabilityLedger,
  requestDataForGoogleProfileSnapshot,
} from "../src/features/google-profile/google-profile-domain.js";
import { openContentForGoogleProfileSnapshot } from "../src/features/google-profile/PostsMediaTab.js";
import type { GoogleProfileSnapshot } from "../src/platform/api.js";
import type { BusinessAccount, LocationWorkflowSummary, QrCodeRecord, RequestRecord, ReviewRecord } from "../src/platform/domain.js";

(globalThis as typeof globalThis & { React: typeof React }).React = React;
const { ProfileTab } = await import("../src/features/google-profile/ProfileTab.js");
const { ReviewsTab, reviewsForGoogleProfileSnapshot } = await import("../src/features/google-profile/ReviewsTab.js");
const { RequestsQrTab } = await import("../src/features/google-profile/RequestsQrTab.js");

const business: BusinessAccount = {
  id: "business-a",
  locationId: "location-a",
  agencyId: "agency-a",
  name: "Scoped Plumbing",
  locationName: "Scoped Branch",
  initials: "SP",
  country: "GB",
  timezone: "Europe/London",
  health: "Healthy",
  healthTone: "success",
  automationState: "Live",
  integrationSummary: "All scoped services ready",
  lastSuccess: "Now",
  affectedCount: 0,
  plan: "Reputation Pro",
  seedRequestCount: 1,
  metrics: { completedJobs: 1, eligibleCustomers: 1, delivered: 1, uniqueClicks: 1, reviewsDetected: 1, rating: 5, totalReviews: 1 },
  teamMembers: [],
  integrations: {
    google: { tone: "success", status: "Connected", lastEvent: "Now" },
    messaging: { tone: "success", status: "Connected", lastEvent: "Now" },
    jobIntake: { tone: "success", status: "Connected", lastEvent: "Now" },
  },
};

const scopedReview: ReviewRecord = { id: "review-scoped", businessId: "business-a", locationId: "location-a", name: "Scoped Reviewer", rating: 5, date: "Today", body: "Scoped review body marker", replied: false };
const decoyReview: ReviewRecord = { id: "review-decoy", businessId: "business-a", locationId: "location-decoy", name: "Decoy Reviewer", rating: 1, date: "Yesterday", body: "Business-wide decoy review body", replied: false };
const businessWideReviews = [scopedReview, decoyReview];

const scopedRequest: RequestRecord = { id: "REQ-SCOPED", businessId: "business-a", locationId: "location-a", customer: "Scoped Customer", job: "Scoped boiler repair", channel: "SMS", destination: "•••• 0101", status: "Delivered", createdAt: "Today", consentBasis: "Booking form", consentStatus: "Verified", consentReference: "CONSENT-SCOPED", consentCapturedAt: "2026-07-22T09:00:00.000Z", consentWordingVersion: "review_request_v2" };
const decoyRequest: RequestRecord = { ...scopedRequest, id: "REQ-DECOY", locationId: "location-decoy", customer: "Decoy Customer", job: "Business-wide decoy job" };
const businessWideRequests = [scopedRequest, decoyRequest];

const scopedWorkflow: LocationWorkflowSummary = {
  businessId: "business-a",
  locationId: "location-a",
  channels: [{ channel: "sms", enabled: true, timezone: "Europe/London", allowedWeekdays: [1, 2, 3, 4, 5], sendWindowStart: "09:00", sendWindowEnd: "17:00", maxMessages: 2, minimumGapSeconds: 86_400, ruleVersion: "scoped-workflow-v9", template: { id: "template-scoped", key: "review_request", version: 9, body: "Scoped workflow marker for {{first_name}} at {{business_name}}: {{review_link}}. Reply STOP to opt out.", includesBusinessIdentity: true, includesUnsubscribe: true, approvedAt: "2026-07-22" } }],
  reviewDestination: { runtimeUrl: "https://g.page/r/scoped", qrUrl: "https://g.page/r/scoped", verifiedAt: "2026-07-22", connectionHealth: "connected", matchesRuntime: true },
};

const scopedQr: QrCodeRecord = { businessId: "business-a", locationId: "location-a", publicToken: "scoped-qr-token", destinationUrl: "https://g.page/r/scoped", destinationVerified: true, artworkRevision: 7, generatedAt: "Today", totalScans: 3, uniqueScans: 2, reviewConversions: 1, lastScanAt: "Today", placements: [{ label: "Scoped counter card", scans: 3 }] };
const decoyQr: QrCodeRecord = { ...scopedQr, locationId: "location-decoy", publicToken: "decoy-qr-token", destinationUrl: "https://g.page/r/decoy" };

const snapshot: GoogleProfileSnapshot = {
  businessId: "business-a",
  locationId: "location-a",
  connection: { state: "connected", lastSyncedAt: "Today" },
  profile: null,
  reviews: businessWideReviews.filter((review) => review.locationId === "location-a"),
  requests: businessWideRequests.filter((request) => request.locationId === "location-a"),
  qr: scopedQr.locationId === "location-a" ? scopedQr : decoyQr,
  workflow: scopedWorkflow,
  capabilities: {
    profileFields: { available: false, reason: "Profile fields require an approved pilot." },
    services: { available: false, reason: "Services require an approved pilot." },
    attributes: { available: false, reason: "Attributes require an approved pilot." },
    reviewReplies: { available: false, reason: "Review replies require an approved pilot." },
    posts: { available: false, reason: "Local posts require an approved pilot." },
    images: { available: false, reason: "Location images require an approved pilot." },
    videos: { available: false, reason: "Location videos require an approved pilot." },
  },
};

test("Google Profile tabs expose selected identity and individually fail-closed capabilities", () => {
  assert.deepEqual(GOOGLE_PROFILE_TABS.map((tab) => [tab.id, tab.label]), [
    ["profile", "Profile"],
    ["reviews", "Reviews"],
    ["requests-qr", "Requests & QR"],
    ["posts-media", "Posts & media"],
  ]);
  assert.deepEqual(
    googleProfileTabsForSelection("requests-qr").filter((tab) => tab.selected).map((tab) => tab.id),
    ["requests-qr"],
  );
  assert.deepEqual(GOOGLE_PROFILE_CAPABILITIES.map((capability) => [capability.key, capability.label]), [
    ["profileFields", "Profile fields"],
    ["services", "Services"],
    ["attributes", "Attributes"],
    ["reviewReplies", "Review replies"],
    ["posts", "Local posts"],
    ["images", "Location images"],
    ["videos", "Location videos"],
  ]);
  assert.deepEqual(googleProfileWriteCapabilityLedger(snapshot).map((capability) => capability.status), Array(7).fill("Unavailable"));

  const markup = renderToStaticMarkup(createElement(ProfileTab, {
    business,
    snapshot,
    onConnect: () => {},
    canConfigure: false,
    services: [],
    servicesLoading: false,
  }));
  assert.match(markup, /Write capabilities/u);
  assert.match(markup, /Profile fields/u);
  assert.match(markup, /Unavailable/u);
  assert.ok(markup.indexOf("google-capability-ledger") < markup.indexOf("integration-grid"));
});

test("Google Profile tab contracts retain only the selected snapshot records and Content context", () => {
  assert.equal(reviewsForGoogleProfileSnapshot(snapshot), snapshot.reviews);
  assert.deepEqual(requestDataForGoogleProfileSnapshot(snapshot), {
    requests: snapshot.requests,
    workflow: snapshot.workflow,
    qr: snapshot.qr,
  });

  let opened: { businessId: string; locationId: string } | undefined;
  openContentForGoogleProfileSnapshot(snapshot, (context) => { opened = context; });
  assert.deepEqual(opened, { businessId: "business-a", locationId: "location-a" });

  const stale = googleProfileSnapshotState({ businessId: "business-b", locationId: "location-b", snapshot, snapshotError: null });
  assert.deepEqual(stale, { phase: "loading", snapshot: null, error: "" });
});

test("ReviewsTab renders only the supplied selected-location review snapshot", () => {
  const markup = renderToStaticMarkup(createElement(ReviewsTab, { business, snapshot }));

  assert.match(markup, /Scoped Reviewer/u);
  assert.match(markup, /Scoped review body marker/u);
  assert.doesNotMatch(markup, /Decoy Reviewer|Business-wide decoy review body/u);
});

test("RequestsQrTab renders only the supplied request, workflow, and QR snapshot", () => {
  const ScopedQrRenderer = ({ record }: { business: BusinessAccount; record: QrCodeRecord }) => createElement("output", { "data-qr-token": record.publicToken }, `Selected QR ${record.publicToken}`);
  const markup = renderToStaticMarkup(createElement(RequestsQrTab, {
    business,
    snapshot,
    onAddJob: () => {},
    canConfigure: false,
    onOpenIntegrations: () => {},
    QrRenderer: ScopedQrRenderer,
  }));

  assert.match(markup, /REQ-SCOPED/u);
  assert.match(markup, /Scoped Customer/u);
  assert.match(markup, /Scoped boiler repair/u);
  assert.match(markup, /scoped-workflow-v9/u);
  assert.match(markup, /Scoped workflow marker/u);
  assert.match(markup, /data-qr-token="scoped-qr-token"/u);
  assert.doesNotMatch(markup, /REQ-DECOY|Decoy Customer|Business-wide decoy job|decoy-qr-token/u);
});
