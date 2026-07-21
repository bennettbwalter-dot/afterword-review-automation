import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isGoogleReviewDestinationDispatchable } from "../server/repository/postgres.js";

const baseEvidence = {
  runtimeReviewUri: "https://g.page/r/example/review",
  runtimeReviewUriAllowed: true,
  connectionDisabledAt: null,
};

test("Google review destination readiness mirrors dispatch-allowed connection health", () => {
  for (const connectionHealth of [
    "connected",
    "healthy",
    "delayed",
    "rate_limited",
    "provider_unavailable",
    "failing",
  ]) {
    assert.equal(isGoogleReviewDestinationDispatchable({ ...baseEvidence, connectionHealth }), true, connectionHealth);
  }

  for (const connectionHealth of ["authentication_required", "permission_revoked", "disabled"]) {
    assert.equal(isGoogleReviewDestinationDispatchable({ ...baseEvidence, connectionHealth }), false, connectionHealth);
  }
});

test("Google review destination readiness fails closed on missing, invalid or disabled evidence", () => {
  assert.equal(isGoogleReviewDestinationDispatchable({ ...baseEvidence, connectionHealth: null }), false);
  assert.equal(isGoogleReviewDestinationDispatchable({ ...baseEvidence, connectionHealth: "healthy", runtimeReviewUri: null }), false);
  assert.equal(isGoogleReviewDestinationDispatchable({ ...baseEvidence, connectionHealth: "healthy", runtimeReviewUriAllowed: false }), false);
  assert.equal(isGoogleReviewDestinationDispatchable({ ...baseEvidence, connectionHealth: "healthy", connectionDisabledAt: new Date() }), false);
});

test("the shipped product source does not advertise retired product surfaces", () => {
  const productSource = [
    "src/App.tsx",
    "src/growth/GrowthSuite.tsx",
    "src/features/home/HomeView.tsx",
    "src/features/google-profile/GoogleProfileView.tsx",
    "src/features/content/ContentView.tsx",
    "src/features/reports/ReportsView.tsx",
    "src/features/settings/SettingsBillingView.tsx",
    "src/features/agency/AgencyView.tsx",
  ].map((path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")).join("\n").toLowerCase();

  for (const retiredClaim of [
    "heatmap", "keyword tracking", "ai ranking audit", "citation", "directory", "website widget",
    "white label", "geotagging", "image dripping", "autonomous strategy", "custom permission builder",
    "companycam", "zapier", "professional editor",
  ]) {
    assert.equal(productSource.includes(retiredClaim), false, `must not advertise ${retiredClaim}`);
  }
});
