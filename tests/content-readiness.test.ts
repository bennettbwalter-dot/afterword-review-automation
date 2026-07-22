import assert from "node:assert/strict";
import test from "node:test";
import {
  CONTENT_READINESS_CAPABILITIES,
  CONTENT_SOURCE_GUIDANCE,
  CONTENT_STAGE_STATES,
} from "../src/features/content/content-readiness.js";

test("Content readiness is explicit, complete, and fail closed", () => {
  assert.deepEqual(CONTENT_SOURCE_GUIDANCE.map((source) => [source.id, source.label]), [
    ["service", "Service"],
    ["offer", "Offer"],
    ["social_idea", "Campaign or post idea"],
  ]);
  assert.deepEqual(CONTENT_READINESS_CAPABILITIES.map((capability) => capability.id), [
    "manual-media", "google-business-profile", "facebook", "instagram", "linkedin", "youtube", "mobilewan",
  ]);
  assert.ok(CONTENT_READINESS_CAPABILITIES.every((capability) => capability.status === "unavailable"));
  assert.ok(CONTENT_READINESS_CAPABILITIES.every((capability) => capability.reason.trim().length > 0));
  assert.notEqual(
    CONTENT_READINESS_CAPABILITIES.find((capability) => capability.id === "manual-media")?.reason,
    CONTENT_READINESS_CAPABILITIES.find((capability) => capability.id === "mobilewan")?.reason,
  );
  assert.deepEqual(Object.keys(CONTENT_STAGE_STATES), ["uploads", "approvals", "scheduled", "published", "failed"]);
});
