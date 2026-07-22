import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("Google review bodies remain inside the Google Profile review view", async () => {
  const app = await readFile(path.resolve("src", "App.tsx"), "utf8");
  const reviewsTab = await readFile(path.resolve("src", "features", "google-profile", "ReviewsTab.tsx"), "utf8");
  const reportsStart = app.indexOf("function ReportsView(");
  const reportsSource = app.slice(reportsStart, app.indexOf("function GoogleProfileSelectionDialog(", reportsStart));

  assert.match(reviewsTab, /review\.body/);
  assert.doesNotMatch(reportsSource, /review\.body/);
  assert.match(reportsSource, /Review detection is not exact job-level attribution/);
});

test("Content does not offer Google reviews as a creation source and write capabilities fail closed", async () => {
  const contentView = await readFile(path.resolve("src", "features", "content", "ContentView.tsx"), "utf8");
  const contentReadiness = await readFile(path.resolve("src", "features", "content", "content-readiness.ts"), "utf8");
  const content = `${contentView}\n${contentReadiness}`;
  const profileRoute = await readFile(path.resolve("server", "routes", "google-profile.ts"), "utf8");

  assert.doesNotMatch(content, /review source|Google review/i);
  assert.doesNotMatch(content, /fetch\(|apiRequest|<input|type=["']file["']|Publish now|Generate video/);
  assert.match(profileRoute, /available: false as const/);
  assert.match(profileRoute, /Unavailable until the Google capability is approved and proven in a controlled pilot/);
});

test("App keeps the Content readiness surface self-closing and static", async () => {
  const app = await readFile(path.resolve("src", "App.tsx"), "utf8");
  const contentRouteStart = app.indexOf('view === "content"');
  const contentRouteEnd = app.indexOf('{!agencyMode && canReadTenant && view === "reports"', contentRouteStart);
  const contentRoute = app.slice(contentRouteStart, contentRouteEnd);
  const contentView = contentRoute.match(/<ContentView\b[\s\S]*?\/>/)?.[0];

  assert.ok(contentRouteStart >= 0 && contentRouteEnd > contentRouteStart);
  assert.equal(contentView, '<ContentView tab={contentTab} onTabChange={(tab) => navigateToView("content", { contentTab: tab })} />');
  assert.doesNotMatch(contentView, /\b(?:children|provider|review|oauth|demo|readiness|action)\w*\s*=/i);
  assert.doesNotMatch(contentRoute, /<ContentView\b[^>]*>[\s\S]*?<\/ContentView>/);
});
