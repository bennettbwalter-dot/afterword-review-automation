import assert from "node:assert/strict";
import test from "node:test";
import { projectGoogleProfileSnapshot } from "../server/routes/google-profile.js";
import type { WorkspacePayload } from "../server/types.js";

const workspace = {
  businesses: [{
    id: "00000000-0000-4000-8000-000000000001",
    locationId: "00000000-0000-4000-8000-000000000011",
    name: "Harbour & Hearth",
    integrations: { google: { status: "Connected", tone: "success", lastEvent: "Last sync now" } },
    locationReports: [
      { id: "00000000-0000-4000-8000-000000000011", name: "Bristol" },
      { id: "00000000-0000-4000-8000-000000000012", name: "Bath" },
    ],
  }],
  reviewsByBusiness: {
    "00000000-0000-4000-8000-000000000001": [
      { id: "review-a", locationId: "00000000-0000-4000-8000-000000000011", body: "Visible review" },
      { id: "review-b", locationId: "00000000-0000-4000-8000-000000000012", body: "Other location" },
    ],
  },
  requestsByBusiness: {
    "00000000-0000-4000-8000-000000000001": [
      { id: "request-a", locationId: "00000000-0000-4000-8000-000000000011" },
      { id: "request-b", locationId: "00000000-0000-4000-8000-000000000012" },
    ],
  },
  qrCodesByBusiness: {
    "00000000-0000-4000-8000-000000000001": { locationId: "00000000-0000-4000-8000-000000000011", publicToken: "public-token" },
  },
  workflowsByLocation: {
    "00000000-0000-4000-8000-000000000011": { locationId: "00000000-0000-4000-8000-000000000011", reviewDestination: { runtimeUrl: "https://g.page/review", matchesRuntime: true } },
  },
  access: { businessId: "00000000-0000-4000-8000-000000000001", locationId: "00000000-0000-4000-8000-000000000011", canReadTenant: true },
} as unknown as WorkspacePayload;

test("Google Profile read projection is business and location scoped", () => {
  const snapshot = projectGoogleProfileSnapshot(
    workspace,
    "00000000-0000-4000-8000-000000000001",
    "00000000-0000-4000-8000-000000000011",
  );

  assert.equal(snapshot.businessId, "00000000-0000-4000-8000-000000000001");
  assert.equal(snapshot.locationId, "00000000-0000-4000-8000-000000000011");
  assert.deepEqual(snapshot.reviews.map((review) => review.id), ["review-a"]);
  assert.deepEqual(snapshot.requests.map((request) => request.id), ["request-a"]);
  assert.equal(snapshot.qr?.publicToken, "public-token");
  assert.equal(snapshot.connection.state, "connected");
});

test("Google Profile read projection excludes a QR code from another location", () => {
  const snapshot = projectGoogleProfileSnapshot(
    workspace,
    "00000000-0000-4000-8000-000000000001",
    "00000000-0000-4000-8000-000000000012",
  );

  assert.equal(snapshot.qr, null);
  assert.equal(snapshot.reviews.length, 1);
  assert.equal(snapshot.reviews[0]?.id, "review-b");
});
