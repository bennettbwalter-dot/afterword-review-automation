import assert from "node:assert/strict";
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
