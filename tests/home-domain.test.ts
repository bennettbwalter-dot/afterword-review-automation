import assert from "node:assert/strict";
import test from "node:test";
import { HOME_MODULES, buildHomeProjection } from "../src/features/home/home-domain.js";
import { workspaceRoute } from "../src/routing.js";
import type { BusinessAccount, RequestRecord } from "../src/platform/domain.js";

const business: BusinessAccount = {
  id: "business-1",
  locationId: "location-a",
  agencyId: "agency-1",
  name: "Harbour & Hearth",
  locationName: "Bristol",
  initials: "HH",
  country: "GB",
  timezone: "Europe/London",
  health: "Healthy",
  healthTone: "success",
  automationState: "Live",
  integrationSummary: "Operational",
  lastSuccess: "Last completed-job trigger Â· 4 min ago",
  affectedCount: 0,
  plan: "Reputation Multi",
  seedRequestCount: 0,
  metrics: { completedJobs: 20, eligibleCustomers: 18, delivered: 16, uniqueClicks: 5, reviewsDetected: 99, rating: 4.9, totalReviews: 999 },
  teamMembers: [],
  integrations: {
    google: { status: "Healthy", tone: "success", lastEvent: "Synced" },
    messaging: { status: "Healthy", tone: "success", lastEvent: "Delivered" },
    jobIntake: { status: "Healthy", tone: "success", lastEvent: "Received" },
  },
  locationReports: [
    { id: "location-a", name: "Bristol", completedJobs: 12, delivered: 10, uniqueClicks: 3, reviewsDetected: 77, rating: 4.8, totalReviews: 700, smsSegments: 8 },
    { id: "location-b", name: "Bath", completedJobs: 8, delivered: 6, uniqueClicks: 2, reviewsDetected: 22, rating: 4.7, totalReviews: 299, smsSegments: 4 },
  ],
};

const requests: RequestRecord[] = [
  { id: "request-a", businessId: "business-1", locationId: "location-a", customer: "PRIVATE_A", job: "PRIVATE_JOB_A", channel: "SMS", destination: "PRIVATE_DEST_A", status: "Delivered", createdAt: "2026-07-20T10:00:00Z", consentBasis: "Booking form consent", consentStatus: "Verified", consentReference: "consent-a", consentCapturedAt: "2026-07-20T09:00:00Z", consentWordingVersion: "review_request_v2" },
  { id: "request-b", businessId: "business-1", locationId: "location-b", customer: "PRIVATE_B", job: "PRIVATE_JOB_B", channel: "Email", destination: "PRIVATE_DEST_B", status: "Delivered", createdAt: "2026-07-20T11:00:00Z", consentBasis: "Booking form consent", consentStatus: "Verified", consentReference: "consent-b", consentCapturedAt: "2026-07-20T09:30:00Z", consentWordingVersion: "review_request_v2" },
  { id: "foreign-request", businessId: "business-2", locationId: "location-b", customer: "PRIVATE_FOREIGN", job: "PRIVATE_FOREIGN_JOB", channel: "SMS", destination: "PRIVATE_FOREIGN_DEST", status: "Delivered", createdAt: "2026-07-20T12:00:00Z", consentBasis: "Booking form consent", consentStatus: "Verified", consentReference: "consent-c", consentCapturedAt: "2026-07-20T10:00:00Z", consentWordingVersion: "review_request_v2" },
];

test("Home modules are exact, consolidated, and use canonical scoped destinations", () => {
  assert.deepEqual(HOME_MODULES.map(({ id, title }) => [id, title]), [
    ["google-profile", "Google Profile"],
    ["reviews", "Reviews"],
    ["requests-qr", "Requests & QR"],
    ["content", "Content"],
    ["reports", "Reports"],
    ["connections", "Connections"],
    ["billing", "Billing"],
  ]);
  assert.deepEqual(HOME_MODULES.map((module) => workspaceRoute(module.view, module.routeContext)), [
    "/app/google-profile",
    "/app/google-profile/reviews",
    "/app/google-profile/requests-qr",
    "/app/content",
    "/app/reports",
    "/app/settings-billing/connections",
    "/app/settings-billing/billing",
  ]);
});

test("Home projection returns only selected-location operational aggregates", () => {
  assert.deepEqual(buildHomeProjection(business, requests, "location-b"), {
    locations: [{ id: "location-a", name: "Bristol" }, { id: "location-b", name: "Bath" }],
    activeLocation: { id: "location-b", name: "Bath", completedJobs: 8, delivered: 6, uniqueClicks: 2 },
    requestCount: 1,
  });
});

test("invalid location selection fails closed to the first scoped location", () => {
  const projection = buildHomeProjection(business, requests, "location-from-another-business");
  assert.deepEqual(projection.activeLocation, { id: "location-a", name: "Bristol", completedJobs: 12, delivered: 10, uniqueClicks: 3 });
  assert.equal(projection.requestCount, 1);
  assert.deepEqual(Object.keys(projection.activeLocation), ["id", "name", "completedJobs", "delivered", "uniqueClicks"]);
});
