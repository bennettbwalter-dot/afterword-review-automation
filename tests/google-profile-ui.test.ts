import assert from "node:assert/strict";
import test from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { createCompletedJobAndRefreshWorkspace } from "../src/features/google-profile/completed-job-refresh.js";
import type { GoogleProfileSnapshot } from "../src/platform/api.js";

(globalThis as typeof globalThis & { React: typeof React }).React = React;
const { GoogleProfileSnapshotContent } = await import("../src/features/google-profile/GoogleProfileView.js");

test("Google Profile snapshot content remains fail-closed until the selected location snapshot is ready", () => {
  const loading = renderToStaticMarkup(createElement(GoogleProfileSnapshotContent, {
    snapshot: null,
    snapshotError: "",
    children: () => createElement("p", null, "should not render"),
  }));
  assert.match(loading, /Loading location data/u);
  assert.match(loading, /aria-busy="true"/u);
  assert.doesNotMatch(loading, /should not render/u);

  const error = renderToStaticMarkup(createElement(GoogleProfileSnapshotContent, {
    snapshot: null,
    snapshotError: "The latest Google Profile data could not be loaded.",
    children: () => createElement("p", null, "should not render"),
  }));
  assert.match(error, /Location data unavailable/u);
  assert.match(error, /role="alert"/u);
  assert.doesNotMatch(error, /should not render/u);

  const snapshot = { businessId: "business-a", locationId: "location-a" } as GoogleProfileSnapshot;
  const ready = renderToStaticMarkup(createElement(GoogleProfileSnapshotContent, {
    snapshot,
    snapshotError: "",
    children: (selected: GoogleProfileSnapshot) => createElement("p", null, `${selected.businessId}/${selected.locationId}`),
  }));
  assert.match(ready, /business-a\/location-a/u);
});

test("App supplies an explicit demo or live snapshot source and invalidates it after completed-job creation", () => {
  const source = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.match(source, /<GoogleProfileView\b[\s\S]{0,600}source=\{googleProfileSnapshotSource\}/u);
  assert.match(source, /kind:\s*"demo",[\s\S]{0,120}revision:\s*googleProfileRevision/u);
  assert.match(source, /kind:\s*"live"/u);
  assert.match(source, /createCompletedJobAndRefreshWorkspace/u);
});

test("completed-job creation invalidates Google Profile before a secondary workspace refresh and does not invite duplicate submission", async () => {
  const events: string[] = [];
  let refreshError = "";
  await createCompletedJobAndRefreshWorkspace({
    create: async () => { events.push("created"); },
    invalidateSnapshot: () => { events.push("invalidated"); },
    refreshWorkspace: async () => {
      events.push("refresh");
      throw new Error("refresh offline");
    },
    applyWorkspace: () => { events.push("applied"); },
    reportRefreshError: (message) => {
      events.push("reported");
      refreshError = message;
    },
  });
  assert.deepEqual(events, ["created", "invalidated", "refresh", "reported"]);
  assert.match(refreshError, /completed job was saved/i);
  assert.match(refreshError, /refresh offline/i);
});

test("completed-job creation applies a successful secondary workspace refresh", async () => {
  const events: string[] = [];
  const workspace = { id: "workspace-a" };
  await createCompletedJobAndRefreshWorkspace({
    create: async () => { events.push("created"); },
    invalidateSnapshot: () => { events.push("invalidated"); },
    refreshWorkspace: async () => {
      events.push("refresh");
      return workspace;
    },
    applyWorkspace: (loaded) => {
      assert.equal(loaded, workspace);
      events.push("applied");
    },
    reportRefreshError: () => { events.push("reported"); },
  });
  assert.deepEqual(events, ["created", "invalidated", "refresh", "applied"]);
});
