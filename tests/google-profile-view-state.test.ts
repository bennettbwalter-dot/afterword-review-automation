import assert from "node:assert/strict";
import test from "node:test";
import {
  googleProfileSnapshotState,
  type GoogleProfileSnapshotError,
} from "../src/features/google-profile/GoogleProfileView.js";
import type { GoogleProfileSnapshot } from "../src/platform/api.js";

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
