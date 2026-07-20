import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import {
  appViewFromPath,
  defaultAppView,
  isAppViewAllowed,
  isPublicReviewPreview,
  publicReviewPreviewUrl,
  workspaceBusinessForSession,
  workspaceContextFromSearch,
  workspaceLocationForBusiness,
  workspaceRoute,
} from "../src/routing.js";

test("Growth Suite tabs have stable direct routes", () => {
  assert.equal(appViewFromPath("/app"), "growth");
  assert.equal(appViewFromPath("/app/growth/"), "growth");
  assert.equal(appViewFromPath("/app/reviews"), "reviews");
  assert.equal(appViewFromPath("/APP/REQUESTS"), "requests");
  assert.equal(appViewFromPath("/app/team-billing"), "team-billing");
  assert.equal(appViewFromPath("/app/not-a-module"), undefined);
});

test("workspace routes preserve one canonical business and location context", () => {
  assert.equal(
    workspaceRoute("reviews", { businessId: "business-1", locationId: "location-2" }),
    "/app/reviews?business=business-1&location=location-2",
  );
  assert.deepEqual(
    workspaceContextFromSearch("?location=location-2&business=business-1&ignored=yes"),
    { businessId: "business-1", locationId: "location-2" },
  );
  assert.deepEqual(workspaceContextFromSearch("?business=%20&location="), {});
});

test("business switching never reuses a location from another business", () => {
  const current = { businessId: "business-1", locationId: "location-1" };
  assert.equal(
    workspaceLocationForBusiness(current, "business-1", undefined, "location-default"),
    "location-1",
  );
  assert.equal(
    workspaceLocationForBusiness(current, "business-2", undefined, "location-2"),
    "location-2",
  );
  assert.equal(
    workspaceLocationForBusiness(current, "business-2", "location-explicit", "location-2"),
    "location-explicit",
  );
});

test("business-owner deep links select the routed membership before the initial session default", () => {
  const routeContext = { businessId: "business-2", locationId: "location-2" };
  assert.equal(
    workspaceBusinessForSession(routeContext, "business_owner", "business-1"),
    "business-2",
  );
  assert.equal(
    workspaceBusinessForSession({}, "business_owner", "business-1"),
    "business-1",
  );
  assert.equal(
    workspaceBusinessForSession(routeContext, "agency_admin", undefined, "business-support"),
    "business-support",
  );
});

test("role routing keeps agency portfolio and tenant modules separated", () => {
  assert.equal(defaultAppView("business_owner"), "growth");
  assert.equal(defaultAppView("business_owner", false, "billing"), "team-billing");
  assert.equal(defaultAppView("agency_admin"), "agency-overview");
  assert.equal(defaultAppView("agency_admin", true), "growth");
  assert.equal(isAppViewAllowed("reviews", "business_owner"), true);
  assert.equal(isAppViewAllowed("agency-overview", "business_owner"), false);
  assert.equal(isAppViewAllowed("reviews", "agency_admin", false), false);
  assert.equal(isAppViewAllowed("growth", "agency_admin", false), true);
  assert.equal(isAppViewAllowed("reviews", "agency_admin", true), true);
  assert.equal(isAppViewAllowed("agency-overview", "agency_admin", true), false);
  assert.equal(isAppViewAllowed("team-billing", "business_owner", false, "operator"), false);
  assert.equal(isAppViewAllowed("reviews", "business_owner", false, "billing"), false);
  assert.equal(isAppViewAllowed("team-billing", "business_owner", false, "billing"), true);
});

test("QR test links use a non-recording preview context", () => {
  assert.equal(publicReviewPreviewUrl("https://reviews.example/r/abc"), "https://reviews.example/r/abc?preview=1");
  assert.equal(publicReviewPreviewUrl("https://reviews.example/r/abc?placement=card"), "https://reviews.example/r/abc?placement=card&preview=1");
  assert.equal(isPublicReviewPreview("?preview=1"), true);
  assert.equal(isPublicReviewPreview("?preview=0"), false);
});

test("static hosting falls back to the SPA for workspace and public review routes", () => {
  const redirects = readFileSync(new URL("../public/_redirects", import.meta.url), "utf8")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);

  assert.deepEqual(redirects, [
    "/app/* /index.html 200",
    "/workspace /index.html 200",
    "/r/* /index.html 200",
  ]);
});

test("team member visibility is wired to tenant management capability", () => {
  const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const teamBillingCall = appSource.match(/<TeamBillingView\b[^>]*\/>/su)?.[0];

  assert.ok(teamBillingCall, "TeamBillingView call site should exist");
  assert.match(teamBillingCall, /canViewTeamMembers=\{canConfigure\}/u);
  assert.doesNotMatch(teamBillingCall, /canViewTeamMembers=\{canManageTenantBilling\}/u);
});

test("canonical workspace routing compares the React Router location rather than browser history", () => {
  const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(appSource, /window\.location\.pathname/u);
  assert.match(appSource, /`\$\{location\.pathname\}\$\{location\.search\}` !== canonicalRoute/u);
  assert.match(appSource, /previousDemoRoleRef/u);
  assert.match(appSource, /previousRole === session\.role/u);
});

test("billing-only rendering hides every team member name, role and initial", async (t) => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const vite = await createServer({
    appType: "custom",
    configFile: false,
    logLevel: "silent",
    root,
    server: { middlewareMode: true },
  });
  t.after(() => vite.close());

  const [{ TeamBillingView }, { BUSINESSES }] = await Promise.all([
    vite.ssrLoadModule("/src/platform/AgencyViews.tsx"),
    vite.ssrLoadModule("/src/platform/domain.ts"),
  ]);
  const business = BUSINESSES[0];
  assert.ok(business?.teamMembers.length, "Seed business should include team members");

  const renderTeamBilling = (canViewTeamMembers: boolean) => renderToStaticMarkup(createElement(TeamBillingView, {
    business,
    canConfigure: true,
    canManageStripe: true,
    canViewTeamMembers,
    onOpenBillingPortal: async () => undefined,
    onSaveSmsPolicy: async () => undefined,
    onStartCheckout: async () => undefined,
    stripeCheckoutEnabled: false,
    stripePortalEnabled: false,
  }));

  const billingOnlyMarkup = renderTeamBilling(false);
  assert.match(billingOnlyMarkup, /Member directory unavailable\./u);
  for (const member of business.teamMembers) {
    assert.equal(billingOnlyMarkup.includes(member.name), false, `must hide name ${member.name}`);
    assert.equal(billingOnlyMarkup.includes(member.role), false, `must hide role ${member.role}`);
    assert.equal(billingOnlyMarkup.includes(member.initials), false, `must hide initials ${member.initials}`);
  }

  const tenantManagerMarkup = renderTeamBilling(true);
  for (const member of business.teamMembers) {
    assert.equal(tenantManagerMarkup.includes(member.name), true, `must show name ${member.name}`);
    assert.equal(tenantManagerMarkup.includes(member.role), true, `must show role ${member.role}`);
    assert.equal(tenantManagerMarkup.includes(member.initials), true, `must show initials ${member.initials}`);
  }
});
