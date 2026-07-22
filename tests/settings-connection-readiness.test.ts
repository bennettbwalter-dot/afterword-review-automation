import assert from "node:assert/strict";
import test from "node:test";
import { PUBLICATION_CAPABILITIES } from "../src/features/settings/connection-readiness.js";

test("publication capabilities are exact, platform-specific, and fail closed", () => {
  assert.deepEqual(PUBLICATION_CAPABILITIES.map(({ id, label, status }) => ({ id, label, status })), [
    { id: "google-posts-media", label: "Google posts and media", status: "unavailable" },
    { id: "facebook-page", label: "Facebook Page", status: "unavailable" },
    { id: "instagram-professional", label: "Instagram professional account", status: "unavailable" },
    { id: "linkedin-organisation", label: "LinkedIn organisation", status: "unavailable" },
    { id: "youtube-channel", label: "YouTube channel", status: "unavailable" },
  ]);

  assert.ok(PUBLICATION_CAPABILITIES.every(({ prerequisites }) => prerequisites.trim().length > 30));
  assert.equal(new Set(PUBLICATION_CAPABILITIES.map(({ prerequisites }) => prerequisites)).size, 5);
  for (const capability of PUBLICATION_CAPABILITIES) {
    assert.match(capability.prerequisites, /controlled pilot/i);
    assert.match(capability.prerequisites, /reconciliation/i);
  }
});

test("publication prerequisites remain attached to their exact destination", () => {
  assert.deepEqual(Object.fromEntries(PUBLICATION_CAPABILITIES.map(({ id, prerequisites }) => [id, prerequisites])), {
    "google-posts-media": "Requires approved write scopes, exact location capability, destination reconciliation, and a controlled pilot.",
    "facebook-page": "Requires Meta app approval, required Page scopes, exact Page enumeration, reconciliation, and a controlled pilot.",
    "instagram-professional": "Requires Meta app approval, professional-account linkage and enumeration, required scopes, reconciliation, and a controlled pilot.",
    "linkedin-organisation": "Requires LinkedIn app approval, an authorised organisation or Page role, organisation enumeration, reconciliation, and a controlled pilot.",
    "youtube-channel": "Requires an approved API project, required scopes, exact channel enumeration, upload reconciliation, and a controlled pilot.",
  });
});
