import assert from "node:assert/strict";
import test from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
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
