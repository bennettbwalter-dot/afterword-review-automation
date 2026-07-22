import assert from "node:assert/strict";
import test from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ContentTab } from "../src/routing.js";
import {
  CONTENT_READINESS_CAPABILITIES,
  CONTENT_SOURCE_GUIDANCE,
  CONTENT_STAGE_STATES,
} from "../src/features/content/content-readiness.js";

(globalThis as typeof globalThis & { React: typeof React }).React = React;
const { ContentView } = await import("../src/features/content/ContentView.js");

const CONTENT_TAB_LABELS: Record<ContentTab, string> = {
  create: "Create",
  uploads: "Uploads",
  approvals: "Approvals",
  scheduled: "Scheduled",
  published: "Published",
  failed: "Failed",
};

function renderContent(tab: ContentTab) {
  return renderToStaticMarkup(createElement(ContentView, { tab, onTabChange: () => {} }));
}

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

test("Create explains the manual-first sources and every unavailable capability", () => {
  const content = renderContent("create");

  for (const label of [
    "Service",
    "Offer",
    "Campaign or post idea",
    "Manual image and video",
    "Google Business Profile",
    "Facebook Page",
    "Instagram professional account",
    "LinkedIn organisation",
    "YouTube channel",
    "MobileWAN short video",
  ]) assert.match(content, new RegExp(label));
  assert.equal((content.match(/>Unavailable</g) ?? []).length, 7);
});

test("Create remains static and excludes review content", () => {
  const content = renderContent("create");

  assert.doesNotMatch(content, /Google review|review source/i);
  assert.doesNotMatch(content, /<input|<form|type="file"|<a(?:\s|>)/i);
  assert.equal((content.match(/<button/g) ?? []).length, 6);
});

test("each queue tab renders its honest zero state", () => {
  const expected: Array<[Exclude<ContentTab, "create">, string]> = [
    ["uploads", "No validated uploads yet"],
    ["approvals", "No revisions awaiting approval"],
    ["scheduled", "No approved content is scheduled"],
    ["published", "No verified publications yet"],
    ["failed", "No failed content attempts"],
  ];

  for (const [tab, title] of expected) assert.match(renderContent(tab), new RegExp(title));
});

test("each selected tab retains current-page semantics", () => {
  for (const tab of Object.keys(CONTENT_TAB_LABELS) as ContentTab[]) {
    const content = renderContent(tab);
    assert.match(content, new RegExp(`<button[^>]*aria-current="page"[^>]*>${CONTENT_TAB_LABELS[tab]}</button>`));
  }
});
