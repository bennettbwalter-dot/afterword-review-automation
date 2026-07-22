import assert from "node:assert/strict";
import test from "node:test";
import type { BusinessAccount, LocationReportSummary } from "../src/platform/domain";
import {
  buildReportProjection,
  canCombineReportLocations,
  reportScopeAfterLocationSelection,
} from "../src/features/reports/reports-domain";

const locationA: LocationReportSummary = {
  id: "location-a",
  name: "Location A",
  completedJobs: 10,
  delivered: 8,
  uniqueClicks: 5,
  reviewsDetected: 2,
  rating: 5,
  totalReviews: 15,
  smsSegments: 0,
};

const locationB: LocationReportSummary = {
  id: "location-b",
  name: "Location B",
  completedJobs: 8,
  delivered: 6,
  uniqueClicks: 4,
  reviewsDetected: 2,
  rating: 4,
  totalReviews: 15,
  smsSegments: 0,
};

const multiLocationBusiness: BusinessAccount = {
  id: "business-multi",
  locationId: "location-a",
  agencyId: "agency-1",
  name: "Multi Location Business",
  locationName: "Location A",
  initials: "M",
  country: "GB",
  timezone: "Europe/London",
  health: "Healthy",
  healthTone: "success",
  automationState: "Live",
  integrationSummary: "Healthy",
  lastSuccess: "Now",
  affectedCount: 0,
  plan: "Reputation Multi",
  locationReports: [locationA, locationB],
  seedRequestCount: 0,
  metrics: { completedJobs: 0, eligibleCustomers: 20, delivered: 0, uniqueClicks: 0, reviewsDetected: 0, rating: 0, totalReviews: 0 },
  teamMembers: [],
  integrations: {
    google: { status: "Healthy", tone: "success", lastEvent: "Now" },
    messaging: { status: "Healthy", tone: "success", lastEvent: "Now" },
    jobIntake: { status: "Healthy", tone: "success", lastEvent: "Now" },
  },
};

const selectedLocation: BusinessAccount = {
  ...multiLocationBusiness,
  id: "business-location-a",
  metrics: { ...multiLocationBusiness.metrics, completedJobs: locationA.completedJobs, delivered: locationA.delivered, uniqueClicks: locationA.uniqueClicks, reviewsDetected: locationA.reviewsDetected, rating: locationA.rating, totalReviews: locationA.totalReviews },
};

test("projects selected and combined location report metrics", () => {
  assert.equal(canCombineReportLocations(multiLocationBusiness), true);
  assert.equal(canCombineReportLocations({ ...multiLocationBusiness, locationReports: [locationA] }), false);
  assert.deepEqual(buildReportProjection(multiLocationBusiness, selectedLocation, false).metrics, selectedLocation.metrics);

  const combined = buildReportProjection(multiLocationBusiness, selectedLocation, true);
  assert.equal(combined.isCombinedReport, true);
  assert.equal(combined.metrics.completedJobs, 18);
  assert.equal(combined.metrics.delivered, 14);
  assert.equal(combined.metrics.uniqueClicks, 9);
  assert.equal(combined.metrics.reviewsDetected, 4);
  assert.equal(combined.metrics.totalReviews, 30);
  assert.equal(combined.metrics.rating, 4.5);
  assert.equal(reportScopeAfterLocationSelection("location-a", "location-b", true), false);
  assert.equal(reportScopeAfterLocationSelection("location-a", "location-a", true), true);
});

test("returns zero rating and reviews for a zero-review combined report", () => {
  const zeroReviewBusiness = {
    ...multiLocationBusiness,
    locationReports: [
      { ...locationA, rating: 0, totalReviews: 0 },
      { ...locationB, rating: 0, totalReviews: 0 },
    ],
  };

  const combined = buildReportProjection(zeroReviewBusiness, selectedLocation, true);
  assert.equal(combined.metrics.rating, 0);
  assert.equal(combined.metrics.totalReviews, 0);
});
