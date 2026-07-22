import assert from "node:assert/strict";
import test from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  GOOGLE_PROFILE_CAPABILITIES,
  GOOGLE_PROFILE_TABS,
  googleProfileSnapshotState,
  googleProfileTabsForSelection,
  googleProfileWriteCapabilityLedger,
  requestDataForGoogleProfileSnapshot,
} from "../src/features/google-profile/google-profile-domain.js";
import { reviewsForGoogleProfileSnapshot } from "../src/features/google-profile/ReviewsTab.js";
import { openContentForGoogleProfileSnapshot } from "../src/features/google-profile/PostsMediaTab.js";
import type { GoogleProfileSnapshot } from "../src/platform/api.js";
import type { BusinessAccount } from "../src/platform/domain.js";

(globalThis as typeof globalThis & { React: typeof React }).React = React;
const { ProfileTab } = await import("../src/features/google-profile/ProfileTab.js");

const snapshot = {
  businessId: "business-a",
  locationId: "location-a",
  connection: { state: "connected" },
  reviews: [{ id: "review-a" }],
  requests: [{ id: "request-a" }],
  qr: { id: "qr-a" },
  workflow: { id: "workflow-a" },
  capabilities: Object.fromEntries([
    ["profileFields", { reason: "Profile fields require an approved pilot." }],
    ["services", { reason: "Services require an approved pilot." }],
    ["attributes", { reason: "Attributes require an approved pilot." }],
    ["reviewReplies", { reason: "Review replies require an approved pilot." }],
    ["posts", { reason: "Local posts require an approved pilot." }],
    ["images", { reason: "Location images require an approved pilot." }],
    ["videos", { reason: "Location videos require an approved pilot." }],
  ]),
} as unknown as GoogleProfileSnapshot;

test("Google Profile tabs expose selected identity and individually fail-closed capabilities", () => {
  assert.deepEqual(GOOGLE_PROFILE_TABS.map((tab) => [tab.id, tab.label]), [
    ["profile", "Profile"],
    ["reviews", "Reviews"],
    ["requests-qr", "Requests & QR"],
    ["posts-media", "Posts & media"],
  ]);
  assert.deepEqual(
    googleProfileTabsForSelection("requests-qr").filter((tab) => tab.selected).map((tab) => tab.id),
    ["requests-qr"],
  );
  assert.deepEqual(GOOGLE_PROFILE_CAPABILITIES.map((capability) => [capability.key, capability.label]), [
    ["profileFields", "Profile fields"],
    ["services", "Services"],
    ["attributes", "Attributes"],
    ["reviewReplies", "Review replies"],
    ["posts", "Local posts"],
    ["images", "Location images"],
    ["videos", "Location videos"],
  ]);
  assert.deepEqual(googleProfileWriteCapabilityLedger(snapshot).map((capability) => capability.status), Array(7).fill("Unavailable"));

  const markup = renderToStaticMarkup(createElement(ProfileTab, {
    business: {
      name: "Example Plumbing",
      integrations: {
        google: { tone: "success", status: "Connected", lastEvent: "Now" },
        messaging: { tone: "success", status: "Connected", lastEvent: "Now" },
        jobIntake: { tone: "success", status: "Connected", lastEvent: "Now" },
      },
    } as BusinessAccount,
    snapshot,
    onConnect: () => {},
    canConfigure: false,
    services: [],
    servicesLoading: false,
  }));
  assert.match(markup, /Write capabilities/u);
  assert.match(markup, /Profile fields/u);
  assert.match(markup, /Unavailable/u);
  assert.ok(markup.indexOf("google-capability-ledger") < markup.indexOf("integration-grid"));
});

test("Google Profile tab contracts retain only the selected snapshot records and Content context", () => {
  assert.equal(reviewsForGoogleProfileSnapshot(snapshot), snapshot.reviews);
  assert.deepEqual(requestDataForGoogleProfileSnapshot(snapshot), {
    requests: snapshot.requests,
    workflow: snapshot.workflow,
    qr: snapshot.qr,
  });

  let opened: { businessId: string; locationId: string } | undefined;
  openContentForGoogleProfileSnapshot(snapshot, (context) => { opened = context; });
  assert.deepEqual(opened, { businessId: "business-a", locationId: "location-a" });

  const stale = googleProfileSnapshotState({ businessId: "business-b", locationId: "location-b", snapshot, snapshotError: null });
  assert.deepEqual(stale, { phase: "loading", snapshot: null, error: "" });
});
