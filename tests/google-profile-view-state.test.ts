import assert from "node:assert/strict";
import test from "node:test";
import {
  googleProfileSnapshotState,
  type GoogleProfileSnapshotError,
} from "../src/features/google-profile/GoogleProfileView.js";
import type { GoogleProfileSnapshot } from "../src/platform/api.js";
import type {
  BusinessAccount,
  LocationWorkflowSummary,
  QrCodeRecord,
  RequestRecord,
  ReviewRecord,
} from "../src/platform/domain.js";

const googleProfileDomain: Record<string, unknown> = await import("../src/features/google-profile/google-profile-domain.js");

const firstSnapshot = {
  businessId: "business-a",
  locationId: "location-a",
} as GoogleProfileSnapshot;

const secondSnapshot = {
  businessId: "business-b",
  locationId: "location-b",
} as GoogleProfileSnapshot;

test("Google Profile snapshot state fails closed through loading, errors, and selection races", () => {
  const initial = googleProfileSnapshotState({ businessId: "business-a", locationId: "location-a", snapshot: null, snapshotError: null });
  assert.equal(initial.phase, "loading");
  assert.equal(initial.snapshot, null);

  const failed: GoogleProfileSnapshotError = {
    businessId: "business-a",
    locationId: "location-a",
    message: "The latest Google Profile data could not be loaded.",
  };
  const rejected = googleProfileSnapshotState({ businessId: "business-a", locationId: "location-a", snapshot: null, snapshotError: failed });
  assert.equal(rejected.phase, "error");
  assert.equal(rejected.snapshot, null);

  const switched = googleProfileSnapshotState({ businessId: "business-b", locationId: "location-b", snapshot: firstSnapshot, snapshotError: failed });
  assert.equal(switched.phase, "loading");
  assert.equal(switched.snapshot, null);

  const oldRequestResolved = googleProfileSnapshotState({ businessId: "business-b", locationId: "location-b", snapshot: firstSnapshot, snapshotError: null });
  assert.equal(oldRequestResolved.phase, "loading");
  assert.equal(oldRequestResolved.snapshot, null);

  const currentRequestResolved = googleProfileSnapshotState({ businessId: "business-b", locationId: "location-b", snapshot: secondSnapshot, snapshotError: null });
  assert.equal(currentRequestResolved.phase, "ready");
  assert.equal(currentRequestResolved.snapshot, secondSnapshot);
});

test("demo Google Profile snapshots are explicitly provided and location scoped without a network loader", async () => {
  const buildDemoGoogleProfileSnapshot = googleProfileDomain.buildDemoGoogleProfileSnapshot;
  const resolveGoogleProfileSnapshotSource = googleProfileDomain.resolveGoogleProfileSnapshotSource;
  assert.equal(typeof buildDemoGoogleProfileSnapshot, "function");
  assert.equal(typeof resolveGoogleProfileSnapshotSource, "function");
  if (typeof buildDemoGoogleProfileSnapshot !== "function" || typeof resolveGoogleProfileSnapshotSource !== "function") return;

  const business = {
    id: "business-a",
    locationId: "location-a",
    integrations: {
      google: { status: "Connected", tone: "success", lastEvent: "Sample sync" },
    },
  } as BusinessAccount;
  const selectedRequest = { id: "request-a", businessId: "business-a", locationId: "location-a" } as RequestRecord;
  const decoyRequest = { id: "request-b", businessId: "business-a", locationId: "location-b" } as RequestRecord;
  const selectedReview = { id: "review-a", businessId: "business-a", locationId: "location-a" } as ReviewRecord;
  const decoyReview = { id: "review-b", businessId: "business-a", locationId: "location-b" } as ReviewRecord;
  const qr = { businessId: "business-a", locationId: "location-a" } as QrCodeRecord;
  const workflow = { businessId: "business-a", locationId: "location-a" } as LocationWorkflowSummary;
  const snapshot = (buildDemoGoogleProfileSnapshot as (input: unknown) => GoogleProfileSnapshot)({
    business,
    locationId: "location-a",
    requests: [selectedRequest, decoyRequest],
    reviews: [selectedReview, decoyReview],
    qr,
    workflow,
  });
  assert.deepEqual(snapshot.requests, [selectedRequest]);
  assert.deepEqual(snapshot.reviews, [selectedReview]);
  assert.equal(snapshot.qr, qr);
  assert.equal(snapshot.workflow, workflow);

  let networkCalls = 0;
  const resolved = await (resolveGoogleProfileSnapshotSource as (source: unknown, businessId: string, locationId: string) => Promise<GoogleProfileSnapshot>)({
    kind: "demo",
    snapshot,
    load: async () => {
      networkCalls += 1;
      return secondSnapshot;
    },
  }, "business-a", "location-a");
  assert.equal(resolved, snapshot);
  assert.equal(networkCalls, 0);
});
