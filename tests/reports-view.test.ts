import assert from "node:assert/strict";
import test from "node:test";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ReportsView } from "../src/features/reports/ReportsView";
import type { BusinessAccount } from "../src/platform/domain";

const markers = [
  "REVIEW_BODY_MARKER",
  "PROMPT_MARKER",
  "SIGNED_URL_MARKER",
  "PROVIDER_RECEIPT_MARKER",
  "CUSTOMER_DESTINATION_MARKER",
  "OAUTH_STATE_MARKER",
  "INTERNAL_AUDIT_REASON_MARKER",
];

const business: BusinessAccount = {
  id: "business-1",
  locationId: "location-a",
  agencyId: "agency-1",
  name: "Harbour & Hearth",
  locationName: "Bristol",
  initials: "H",
  country: "GB",
  timezone: "Europe/London",
  health: "Healthy",
  healthTone: "success",
  automationState: "Live",
  integrationSummary: markers.join(" "),
  lastSuccess: markers.join(" "),
  affectedCount: 0,
  plan: "Reputation Multi",
  locationReports: [
    { id: "location-a", name: "Bristol", completedJobs: 142, delivered: 121, uniqueClicks: 18, reviewsDetected: 11, rating: 4.8, totalReviews: 126, smsSegments: 68 },
    { id: "location-b", name: "Bath", completedJobs: 44, delivered: 37, uniqueClicks: 5, reviewsDetected: 3, rating: 4.6, totalReviews: 24, smsSegments: 40 },
  ],
  seedRequestCount: 0,
  metrics: { completedJobs: 186, eligibleCustomers: 160, delivered: 158, uniqueClicks: 23, reviewsDetected: 14, rating: 4.8, totalReviews: 150 },
  teamMembers: [],
  integrations: {
    google: { status: "Healthy", tone: "success", lastEvent: markers.join(" ") },
    messaging: { status: "Healthy", tone: "success", lastEvent: markers.join(" ") },
    jobIntake: { status: "Healthy", tone: "success", lastEvent: markers.join(" ") },
  },
};

const selectedBusiness: BusinessAccount = {
  ...business,
  metrics: { completedJobs: 142, eligibleCustomers: 133, delivered: 121, uniqueClicks: 18, reviewsDetected: 11, rating: 4.8, totalReviews: 126 },
};

const Brand = () => createElement("span", null, "Review Anchor");
const Button = ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => createElement("button", { type: "button", onClick }, children);
const DemoNotice = () => createElement("aside", null, "Demo data");
const Stars = ({ rating }: { rating: number }) => createElement("span", null, `Stars ${rating}`);

test("renders the selected printable operational report without sensitive records or unavailable metrics", () => {
  const markup = renderToStaticMarkup(createElement(ReportsView, {
    business,
    selectedBusiness,
    demoMode: false,
    BrandComponent: Brand,
    ButtonComponent: Button,
    DemoNoticeComponent: DemoNotice,
    StarsComponent: Stars,
    onPrint: () => undefined,
  }));

  for (const text of [
    "Operational snapshot",
    "Harbour &amp; Hearth",
    "Bristol",
    "Completed jobs",
    "Requests delivered",
    "Unique link clicks",
    "Reviews cached",
    "Google rating",
    "Operational checks",
    "Generated",
    "Authenticated current totals",
    "Authenticated tenant report",
    "Print report",
    "Review detection is not exact job-level attribution",
    "Publishing outcomes",
    "MobileWAN usage",
    "Unavailable",
    "independently reconciled destination receipts",
    "controlled pilot",
    "managed GPU",
    "legal and moderation",
    "private Storage",
    "credit ledger",
    "approved pricing",
  ]) assert.ok(markup.includes(text), `missing ${text}`);

  assert.equal((markup.match(/Unavailable/g) ?? []).length, 2);
  for (const marker of markers) assert.equal(markup.includes(marker), false, `must not render ${marker}`);
  assert.doesNotMatch(markup, />\s*(?:Upload|Publish now|Generate|Billing|Connect)\s*</u);
  const unavailableSections = markup.match(/<section class="report-unavailable-outcome"[\s\S]*?<\/section>/gu) ?? [];
  assert.equal(unavailableSections.length, 2);
  for (const section of unavailableSections) {
    assert.doesNotMatch(section, /<(?:strong|svg|button)\b/iu);
    assert.doesNotMatch(section.replace(/<[^>]*>/gu, ""), /(?:\d|counter|chart|success state)/iu);
  }
});
