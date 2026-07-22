import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import {
  appViewFromPath,
  beginPublicReviewTrackingLoad,
  canRecordPublicReviewContinue,
  defaultAppView,
  defaultWorkspaceRoute,
  isAppViewAllowed,
  legacyRedirectDecision,
  parseWorkspaceRoute,
  isPublicReviewPreview,
  publicReviewPreviewUrl,
  workspaceBusinessForSession,
  workspaceContextFromSearch,
  workspaceLocationForBusiness,
  workspaceRoute,
} from "../src/routing.js";

test("legacy routes resolve to the simplified product destinations", () => {
  assert.equal(appViewFromPath("/app"), "home");
  assert.equal(appViewFromPath("/app/growth/"), "home");
  assert.equal(appViewFromPath("/workspace"), "home");
  assert.equal(appViewFromPath("/app/reviews"), "google-profile");
  assert.equal(appViewFromPath("/APP/REQUESTS"), "google-profile");
  assert.equal(appViewFromPath("/app/automation"), "google-profile");
  assert.equal(appViewFromPath("/app/qr-codes"), "google-profile");
  assert.equal(appViewFromPath("/app/integrations"), "settings-billing");
  assert.equal(appViewFromPath("/app/team-billing"), "settings-billing");
  assert.equal(appViewFromPath("/app/portfolio"), "agency");
  assert.equal(appViewFromPath("/app/clients"), "agency");
  assert.equal(appViewFromPath("/app/exceptions"), "operations-exceptions");
  assert.equal(appViewFromPath("/app/audit"), "operations-audit");
  assert.equal(appViewFromPath("/app/not-a-module"), undefined);
});

test("routing aliases domain-owned product and tab unions", () => {
  const routingSource = readFileSync(new URL("../src/routing.ts", import.meta.url), "utf8");
  assert.match(routingSource, /from "\.\/platform\/domain"/u);
  assert.match(routingSource, /ProductView/u);
  assert.match(routingSource, /GoogleProfileTab as DomainGoogleProfileTab/u);
  assert.match(routingSource, /ContentTab as DomainContentTab/u);
  assert.match(routingSource, /export type AppView = ProductView;/u);
  assert.match(routingSource, /export type GoogleProfileTab = DomainGoogleProfileTab;/u);
  assert.match(routingSource, /export type ContentTab = DomainContentTab;/u);
  assert.doesNotMatch(routingSource, /export type AppView\s*=\s*\|/u);
  assert.doesNotMatch(routingSource, /export type GoogleProfileTab\s*=\s*["']/u);
  assert.doesNotMatch(routingSource, /export type ContentTab\s*=\s*["']/u);
});

test("workspace routes preserve one canonical business and location context", () => {
  assert.equal(
    workspaceRoute("google-profile", { businessId: "business-1", locationId: "location-2" }),
    "/app/google-profile?business=business-1&location=location-2",
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

test("role routing keeps Agency, operations, and tenant modules separated", () => {
  assert.equal(defaultAppView("business_owner"), "home");
  assert.equal(defaultAppView("business_owner", false, "billing"), "settings-billing");
  assert.equal(defaultAppView("agency_admin"), "agency");
  assert.equal(defaultAppView("agency_admin", true), "home");
  assert.equal(isAppViewAllowed("google-profile", "business_owner"), true);
  assert.equal(isAppViewAllowed("agency", "business_owner"), false);
  assert.equal(isAppViewAllowed("google-profile", "agency_admin", false), false);
  assert.equal(isAppViewAllowed("agency", "agency_admin", false), true);
  assert.equal(isAppViewAllowed("google-profile", "agency_admin", true), true);
  assert.equal(isAppViewAllowed("agency", "agency_admin", true), false);
  assert.equal(isAppViewAllowed("settings-billing", "business_owner", false, "operator"), false);
  assert.equal(isAppViewAllowed("google-profile", "business_owner", false, "billing"), false);
  assert.equal(isAppViewAllowed("settings-billing", "business_owner", false, "billing"), true);
  assert.equal(defaultWorkspaceRoute("business_owner", false, "billing"), "/app/settings-billing/billing");
});

test("onboarding completion navigates with canonical workspace query keys", () => {
  const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.match(appSource, /workspaceRoute\("settings-billing",\s*\{[\s\S]{0,240}businessId:\s*result\.businessId[\s\S]{0,240}locationId:\s*result\.locationId[\s\S]{0,240}settingsBillingTab:\s*"connections"/u);
  assert.doesNotMatch(appSource, /settings-billing\/connections\?businessId=/u);
});

test("every legacy redirect retains context, replaces history, and cannot loop", () => {
  const cases = [
    ["/app", "/app/home"],
    ["/app/growth", "/app/home"],
    ["/workspace", "/app/home"],
    ["/app/reviews", "/app/google-profile/reviews"],
    ["/app/requests", "/app/google-profile/requests-qr"],
    ["/app/automation", "/app/google-profile/requests-qr"],
    ["/app/qr-codes", "/app/google-profile/requests-qr"],
    ["/app/integrations", "/app/settings-billing/connections"],
    ["/app/team-billing", "/app/settings-billing/billing"],
    ["/app/portfolio", "/app/agency"],
    ["/app/clients", "/app/agency"],
    ["/app/exceptions", "/app/operations/exceptions"],
    ["/app/audit", "/app/operations/audit"],
  ] as const;
  const search = "?business=business-1&location=location-2&source=bookmark";

  for (const [legacyPath, canonicalPath] of cases) {
    const decision = legacyRedirectDecision(legacyPath, search);
    assert.ok(decision, `${legacyPath} should be a redirect`);
    assert.equal(decision.replace, true, `${legacyPath} must replace history`);
    const canonical = decision.to;
    assert.equal(canonical, `${canonicalPath}${search}`);
    assert.equal(parseWorkspaceRoute(canonicalPath, search)?.legacy, false, `${canonicalPath} must not redirect again`);
  }
  assert.equal(appViewFromPath("/r/public-review-token"), undefined);
});

test("Home module cards retain their exact nested destinations", async (t) => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const vite = await createServer({ appType: "custom", configFile: false, logLevel: "silent", root, server: { middlewareMode: true } });
  t.after(() => vite.close());
  const { HOME_MODULES } = await vite.ssrLoadModule("/src/features/home/home-domain.ts");
  const routeFor = (title: string) => {
    const card = HOME_MODULES.find((candidate) => candidate.title === title);
    assert.ok(card, `missing ${title} card`);
    return workspaceRoute(card.view, card.routeContext);
  };
  assert.equal(routeFor("Google Profile"), "/app/google-profile");
  assert.equal(routeFor("Reviews"), "/app/google-profile/reviews");
  assert.equal(routeFor("Requests & QR"), "/app/google-profile/requests-qr");
  assert.equal(routeFor("Content"), "/app/content");
  assert.equal(routeFor("Reports"), "/app/reports");
  assert.equal(routeFor("Connections"), "/app/settings-billing/connections");
  assert.equal(routeFor("Billing"), "/app/settings-billing/billing");
});

test("module tab navigation preserves the current business and location context", () => {
  const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.match(appSource, /const businessId = destinationContext\.businessId \?\? currentBusinessId;/u);
  assert.match(appSource, /workspaceLocationForBusiness\(\s*routeContext,\s*businessId,\s*destinationContext\.locationId,/u);
  assert.match(appSource, /navigate\(workspaceRoute\(nextView, \{ \.\.\.destinationContext, businessId, locationId \}, location\.search\)/u);
});

test("billing tabs expose selected state and omit inaccessible Connections", () => {
  const settingsSource = readFileSync(new URL("../src/features/settings/SettingsBillingView.tsx", import.meta.url), "utf8");
  assert.match(settingsSource, /aria-current=\{tab === "connections" \? "page" : undefined\}/u);
  assert.match(settingsSource, /canAccessConnections/u);
});

test("QR test links use a non-recording preview context", () => {
  assert.equal(publicReviewPreviewUrl("https://reviews.example/r/abc"), "https://reviews.example/r/abc?preview=1");
  assert.equal(publicReviewPreviewUrl("https://reviews.example/r/abc?placement=card"), "https://reviews.example/r/abc?placement=card&preview=1");
  assert.equal(isPublicReviewPreview("?preview=1"), true);
  assert.equal(isPublicReviewPreview("?preview=0"), false);
});

test("live-to-preview review tracking clears stale scan state and records neither scan nor continue", () => {
  const live = beginPublicReviewTrackingLoad(false, undefined);
  assert.deepEqual(live, { scanId: undefined, shouldRecordScan: true });
  assert.equal(canRecordPublicReviewContinue(false, "live-scan-id"), true);

  const preview = beginPublicReviewTrackingLoad(true, "live-scan-id");
  assert.deepEqual(preview, { scanId: undefined, shouldRecordScan: false });
  assert.equal(canRecordPublicReviewContinue(true, "live-scan-id"), false);
  assert.equal(canRecordPublicReviewContinue(true, preview.scanId), false);
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

  const [{ TeamBillingView }, { SettingsBillingView }, { BUSINESSES }] = await Promise.all([
    vite.ssrLoadModule("/src/platform/AgencyViews.tsx"),
    vite.ssrLoadModule("/src/features/settings/SettingsBillingView.tsx"),
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

  const billingOnlyTabs = renderToStaticMarkup(createElement(SettingsBillingView, {
    tab: "billing",
    canAccessConnections: false,
    onTabChange: () => undefined,
  }, createElement("p", null, "Billing panel")));
  assert.equal(billingOnlyTabs.includes("Connections"), false);
  assert.match(billingOnlyTabs, /aria-current="page"/u);
});
