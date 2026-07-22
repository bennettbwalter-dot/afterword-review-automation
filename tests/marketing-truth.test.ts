import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const marketingStart = appSource.indexOf("function MarketingNav");
const marketingEnd = appSource.indexOf("function AppSidebar");

assert.ok(marketingStart >= 0, "MarketingNav source boundary is missing");
assert.ok(marketingEnd > marketingStart, "AppSidebar source boundary is missing");

const marketingSource = appSource.slice(marketingStart, marketingEnd);

function count(source: string, text: string): number {
  return source.split(text).length - 1;
}

test("public hero describes the proven Google-first product", () => {
  for (const copy of [
    "Google review requests, kept honest",
    "Make every review request honest and easy to track.",
    "Review Anchor gives local businesses one workspace for Google Profile, neutral review requests and QR, selected-location reporting, and connection readiness.",
    "No review gating",
    "Three-touch maximum",
    "Location-scoped records",
  ]) assert.ok(marketingSource.includes(copy), `missing approved hero copy: ${copy}`);
});

test("workspace calls to action retain callbacks and derive labels from demo mode", () => {
  assert.equal(count(marketingSource, '{IS_DEMO_MODE ? "Product demo" : "Workspace"}'), 1);
  assert.equal(count(marketingSource, '{IS_DEMO_MODE ? "Preview workspace" : "Open workspace"}'), 2);
  assert.ok(marketingSource.includes('className="nav-demo-link" onClick={onOpenDemo}'));
  assert.ok(marketingSource.includes('<Button onClick={onStartSetup}>'));
  assert.ok(marketingSource.includes('<Button variant="secondary" onClick={onOpenDemo}>'));
  assert.ok(marketingSource.includes('{IS_DEMO_MODE ? "Open product" : "Sign in"}'));
  assert.ok(marketingSource.includes('onOpenDemo(); }}>Preview the workspace</Button>'));
  assert.ok(marketingSource.includes('{IS_DEMO_MODE ? "Open demo" : "Sign in"}'));
});

test("demo journey states are labelled as sample data", () => {
  assert.ok(marketingSource.includes("Demo workspace"));
  assert.ok(marketingSource.includes("Sample workflow"));
  assert.ok(marketingSource.includes("Sample data"));
  assert.ok(marketingSource.includes('<StatusPill tone="success"><span className="live-dot" /> Sample</StatusPill>'));
  assert.equal(marketingSource.includes("Automation live"), false);
  assert.equal(marketingSource.includes('<span className="live-dot" /> Live'), false);
});

test("oversight copy names only current operational surfaces", () => {
  for (const copy of [
    "Review Anchor dashboard",
    "Monitor reputation outcomes and exceptions.",
    "Use Google Profile, Reports, and Connections to inspect request delivery, opt-outs, cached reviews, and service status.",
    "Completed-job workflow status",
    "Request delivery, click, and opt-out totals",
    "Google review data inside Google Profile",
    "Printable location-scoped operational reports",
  ]) assert.ok(marketingSource.includes(copy), `missing approved oversight copy: ${copy}`);
});

test("footer uses Google-first operational positioning for both runtime modes", () => {
  assert.ok(marketingSource.includes("Honest Google review requests, clearly tracked."));
  assert.ok(marketingSource.includes('{IS_DEMO_MODE ? "Google-first reputation operations - Seeded product demo" : "Google-first reputation operations - Protected business workspace"}'));
});

test("retired and unsupported public claims are absent", () => {
  for (const retired of [
    "Growth Suite",
    "Get more reviews. Win more customers.",
    "Business growth, starting with reviews",
    "Exception alerts",
  ]) assert.equal(appSource.includes(retired), false, `retired claim remains: ${retired}`);

  assert.doesNotMatch(
    marketingSource,
    /social publishing|automatic social post(?:ing|s)?|upload (?:your )?(?:image|video|media)|AI (?:content|video) generation|generate (?:a )?(?:social post|video)|publish (?:to|on) Google|reply to (?:Google )?reviews?/iu,
  );
});

test("honesty guardrails and Google access caveat remain", () => {
  assert.ok(marketingSource.includes("Every eligible customer gets the same neutral route."));
  assert.ok(marketingSource.includes("STOP cancels pending messages and blocks future enrolment."));
  assert.ok(marketingSource.includes("We do not guarantee review counts, ratings, search rankings, enquiries or revenue."));
  assert.ok(marketingSource.includes("Availability still depends on approved Google Business Profile API access."));
});
