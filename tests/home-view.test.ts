import assert from "node:assert/strict";
import test from "node:test";
import React, { createElement } from "react";
import { existsSync, readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import type { BusinessAccount, RequestRecord, SessionContext } from "../src/platform/domain.js";
import type { HomeViewProps } from "../src/features/home/HomeView.js";

(globalThis as typeof globalThis & { React: typeof React }).React = React;
const { HomeView } = await import("../src/features/home/HomeView.js");

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
  lastSuccess: "Last completed-job trigger · 4 min ago",
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
  { id: "request-a", businessId: "business-1", locationId: "location-a", customer: "PRIVATE_CUSTOMER_A", job: "PRIVATE_JOB_A", channel: "SMS", destination: "PRIVATE_DESTINATION_A", status: "Delivered", createdAt: "2026-07-20T10:00:00Z", consentBasis: "Booking form consent", consentStatus: "Verified", consentReference: "consent-a", consentCapturedAt: "2026-07-20T09:00:00Z", consentWordingVersion: "review_request_v2" },
  { id: "request-b", businessId: "business-1", locationId: "location-b", customer: "PRIVATE_CUSTOMER_B", job: "PRIVATE_JOB_B", channel: "Email", destination: "PRIVATE_DESTINATION_B", status: "Delivered", createdAt: "2026-07-20T11:00:00Z", consentBasis: "Booking form consent", consentStatus: "Verified", consentReference: "consent-b", consentCapturedAt: "2026-07-20T09:30:00Z", consentWordingVersion: "review_request_v2" },
];
const session: SessionContext = {
  userId: "user-1",
  userName: "Alex Morgan",
  role: "business_owner",
  productRole: "owner",
  businessRole: "owner",
  businessId: "business-1",
  mfaVerified: true,
};

function render(overrides: Partial<HomeViewProps> = {}) {
  return renderToStaticMarkup(createElement(HomeView, {
    business,
    requests,
    session,
    canConfigure: true,
    canManageBilling: true,
    selectedLocationId: "location-b",
    onSelectLocation: () => undefined,
    onNavigate: () => undefined,
    onAddJob: () => undefined,
    ...overrides,
  }));
}

test("renders selected-location operational aggregates and seven launch destinations", () => {
  const markup = render();
  for (const [label, value] of [["Completed jobs", "8"], ["Requests delivered", "6"], ["Unique link clicks", "2"]]) {
    assert.match(markup, new RegExp(`<span>${label}</span><strong>${value}</strong>`));
  }
  assert.match(markup, /<span>Automation<\/span><strong>Live<\/strong>/);
  for (const title of ["Google Profile", "Reviews", "Requests &amp; QR", "Content", "Reports", "Connections", "Billing"]) assert.ok(markup.includes(title));
  assert.match(markup, /1 request in the selected location context\./);
});

test("invalid selection falls back inside the scoped business", () => {
  const markup = render({ selectedLocationId: "foreign-location" });
  assert.match(markup, /<option value="location-a" selected="">Bristol<\/option>/);
  assert.match(markup, /<span>Completed jobs<\/span><strong>12<\/strong>/);
});

test("Home excludes review records and private request fields", () => {
  const markup = render();
  for (const marker of ["PRIVATE_CUSTOMER_A", "PRIVATE_CUSTOMER_B", "PRIVATE_JOB_A", "PRIVATE_JOB_B", "PRIVATE_DESTINATION_A", "PRIVATE_DESTINATION_B"]) {
    assert.equal(markup.includes(marker), false, `must not render ${marker}`);
  }
  assert.doesNotMatch(markup, /Google rating|Reviews detected|Awaiting owner reply/i);
  const visibleText = markup.replace(/<svg[\s\S]*?<\/svg>/gu, "");
  assert.equal(visibleText.includes("4.9"), false);
  assert.equal(visibleText.includes("999"), false);
});

test("completed-job action follows configuration permission", () => {
  assert.match(render(), /Add completed job<\/button>/);
  const readOnly = render({ canConfigure: false, canManageBilling: false });
  assert.doesNotMatch(readOnly, />Add completed job<\/button>/);
  assert.match(readOnly, /You have read-only access/);
});

test("billing-only sessions expose Billing without Connections", () => {
  const markup = render({
    session: { ...session, businessRole: "billing" },
    canConfigure: false,
    canManageBilling: true,
  });
  assert.match(markup, /<h4>Billing<\/h4>/);
  assert.doesNotMatch(markup, /<h4>Connections<\/h4>/);
});

test("App composes Home without review data and Growth Suite is retired", () => {
  const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const homeSource = readFileSync(new URL("../src/features/home/HomeView.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(appSource, /GrowthSuite/u);
  const call = appSource.match(/<HomeView\b[\s\S]*?\/>/u)?.[0] ?? "";
  for (const prop of ["business={business}", "requests={requests}", "session={session}", "canConfigure={canConfigure}", "canManageBilling={canManageTenantBilling}", "selectedLocationId={selectedLocationId}"]) assert.ok(call.includes(prop), `missing ${prop}`);
  assert.doesNotMatch(call, /reviews=|businesses=|agencyMode=|oauth|token|secret|destination|readiness/iu);
  assert.doesNotMatch(homeSource, /ReviewRecord|reviews\s*:\s*ReviewRecord/u);
  assert.equal(existsSync(new URL("../src/growth/GrowthSuite.tsx", import.meta.url)), false);
});
