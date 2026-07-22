# Home Operational Launchpad Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the obsolete Growth Suite business dashboard with a location-scoped Home feature that exposes seven simplified destinations and only aggregate operational workflow data.

**Architecture:** A pure `home-domain.ts` module defines the immutable Home module records and builds a review-free projection from the already-scoped business, requests, and selected location. `HomeView.tsx` renders that projection, applies existing role routing with explicit support-session state, and owns the Home UI; `App.tsx` supplies only scoped inputs and callbacks and no longer imports or passes review records to Home.

**Tech Stack:** React 19, TypeScript 7, `lucide-react`, Node's built-in test runner, React server rendering, Vite.

## Global Constraints

- Google review records live only inside Google Profile. Home must not receive or render review bodies, reviewer names, per-review ratings, review dates, or reply state.
- Home may show only existing location-scoped completed-job, request-delivery, unique-click, automation, and request-count aggregates.
- Preserve selected business/location context, the completed-job action, its configuration permission, read-only disclosure, and existing role routing.
- Preserve agency support-session authorization when Home is rendered directly.
- Billing-only users continue to enter Billing rather than Home.
- Home exposes exactly Google Profile, Reviews, Requests & QR, Content, Reports, Connections, and Billing, using canonical scoped routes.
- Remove `src/growth/GrowthSuite.tsx` and all `GrowthSuite`/review-data wiring from the Home path.
- Aggregate and module grids must retain the existing narrow-width wrapping behavior without horizontal overflow.
- Do not add provider writes, publishing, uploads, provider calls, API/server changes, persistence, database/migrations, Storage, Stripe changes, moderation, GPU, or MobileWAN work.
- Do not imply Google or social publication capability is active, and do not claim live browser, provider, or production readiness.

## File Structure

- `src/features/home/home-domain.ts`: immutable Home module records and pure location/request aggregate projection.
- `src/features/home/HomeView.tsx`: complete business Home presentation and permission-aware navigation.
- `src/App.tsx`: scoped Home composition only; remove `GrowthSuite` import and review prop wiring.
- `src/growth/GrowthSuite.tsx`: delete after all references move into the Home feature.
- `tests/home-domain.test.ts`: module-route and scoped projection tests.
- `tests/home-view.test.ts`: server-rendered privacy, aggregate, billing/support authorization, composition, and removal tests.
- `tests/workspace-routing.test.ts`: point the existing Home module route assertions at the new domain owner and update consolidated card names.

---

### Task 1: Define the Review-Free Home Domain Projection

**Files:**
- Create: `src/features/home/home-domain.ts`
- Create: `tests/home-domain.test.ts`

**Interfaces:**
- Consumes: `BusinessAccount`, `RequestRecord[]`, optional selected location ID, `AppView`, and `WorkspaceRouteContext`.
- Produces: `HOME_MODULES`, `HomeModule`, `HomeProjection`, and `buildHomeProjection(business, requests, selectedLocationId)` for Task 2.

- [ ] **Step 1: Write the failing domain tests**

Create `tests/home-domain.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { HOME_MODULES, buildHomeProjection } from "../src/features/home/home-domain.js";
import { workspaceRoute } from "../src/routing.js";
import type { BusinessAccount, RequestRecord } from "../src/platform/domain.js";

const business: BusinessAccount = {
  id: "business-1",
  locationId: "location-a",
  agencyId: "agency-1",
  name: "Harbour & Hearth",
  locationName: "Bristol",
  initials: "HH",
  country: "GB",
  timezone: "Europe/London",
  health: "Healthy",
  healthTone: "success",
  automationState: "Live",
  integrationSummary: "Operational",
  lastSuccess: "Last completed-job trigger · 4 min ago",
  affectedCount: 0,
  plan: "Reputation Multi",
  seedRequestCount: 0,
  metrics: { completedJobs: 20, eligibleCustomers: 18, delivered: 16, uniqueClicks: 5, reviewsDetected: 99, rating: 4.9, totalReviews: 999 },
  teamMembers: [],
  integrations: {
    google: { status: "Healthy", tone: "success", lastEvent: "Synced" },
    messaging: { status: "Healthy", tone: "success", lastEvent: "Delivered" },
    jobIntake: { status: "Healthy", tone: "success", lastEvent: "Received" },
  },
  locationReports: [
    { id: "location-a", name: "Bristol", completedJobs: 12, delivered: 10, uniqueClicks: 3, reviewsDetected: 77, rating: 4.8, totalReviews: 700, smsSegments: 8 },
    { id: "location-b", name: "Bath", completedJobs: 8, delivered: 6, uniqueClicks: 2, reviewsDetected: 22, rating: 4.7, totalReviews: 299, smsSegments: 4 },
  ],
};

const requests: RequestRecord[] = [
  { id: "request-a", businessId: "business-1", locationId: "location-a", customer: "PRIVATE_A", job: "PRIVATE_JOB_A", channel: "SMS", destination: "PRIVATE_DEST_A", status: "Delivered", createdAt: "2026-07-20T10:00:00Z", consentBasis: "Booking form consent", consentStatus: "Verified", consentReference: "consent-a", consentCapturedAt: "2026-07-20T09:00:00Z", consentWordingVersion: "review_request_v2" },
  { id: "request-b", businessId: "business-1", locationId: "location-b", customer: "PRIVATE_B", job: "PRIVATE_JOB_B", channel: "Email", destination: "PRIVATE_DEST_B", status: "Delivered", createdAt: "2026-07-20T11:00:00Z", consentBasis: "Booking form consent", consentStatus: "Verified", consentReference: "consent-b", consentCapturedAt: "2026-07-20T09:30:00Z", consentWordingVersion: "review_request_v2" },
  { id: "foreign-request", businessId: "business-2", locationId: "location-b", customer: "PRIVATE_FOREIGN", job: "PRIVATE_FOREIGN_JOB", channel: "SMS", destination: "PRIVATE_FOREIGN_DEST", status: "Delivered", createdAt: "2026-07-20T12:00:00Z", consentBasis: "Booking form consent", consentStatus: "Verified", consentReference: "consent-c", consentCapturedAt: "2026-07-20T10:00:00Z", consentWordingVersion: "review_request_v2" },
];

test("Home modules are exact, consolidated, and use canonical scoped destinations", () => {
  assert.deepEqual(HOME_MODULES.map(({ id, title }) => [id, title]), [
    ["google-profile", "Google Profile"],
    ["reviews", "Reviews"],
    ["requests-qr", "Requests & QR"],
    ["content", "Content"],
    ["reports", "Reports"],
    ["connections", "Connections"],
    ["billing", "Billing"],
  ]);
  assert.deepEqual(HOME_MODULES.map((module) => workspaceRoute(module.view, module.routeContext)), [
    "/app/google-profile",
    "/app/google-profile/reviews",
    "/app/google-profile/requests-qr",
    "/app/content",
    "/app/reports",
    "/app/settings-billing/connections",
    "/app/settings-billing/billing",
  ]);
});

test("Home projection returns only selected-location operational aggregates", () => {
  assert.deepEqual(buildHomeProjection(business, requests, "location-b"), {
    locations: [{ id: "location-a", name: "Bristol" }, { id: "location-b", name: "Bath" }],
    activeLocation: { id: "location-b", name: "Bath", completedJobs: 8, delivered: 6, uniqueClicks: 2 },
    requestCount: 1,
  });
});

test("invalid location selection fails closed to the first scoped location", () => {
  const projection = buildHomeProjection(business, requests, "location-from-another-business");
  assert.deepEqual(projection.activeLocation, { id: "location-a", name: "Bristol", completedJobs: 12, delivered: 10, uniqueClicks: 3 });
  assert.equal(projection.requestCount, 1);
  assert.deepEqual(Object.keys(projection.activeLocation), ["id", "name", "completedJobs", "delivered", "uniqueClicks"]);
});
```

- [ ] **Step 2: Run the domain tests and verify the missing-module failure**

Run: `node --import tsx --test tests/home-domain.test.ts`

Expected: FAIL because `src/features/home/home-domain.ts` does not exist.

- [ ] **Step 3: Add the immutable modules and pure projection**

Create `src/features/home/home-domain.ts`:

```ts
import type { BusinessAccount, RequestRecord } from "../../platform/domain";
import type { AppView, WorkspaceRouteContext } from "../../routing";

export type HomeModuleId = "google-profile" | "reviews" | "requests-qr" | "content" | "reports" | "connections" | "billing";
export type HomeModuleIcon = "profile" | "reviews" | "requests" | "content" | "reports" | "connections" | "billing";

export interface HomeModule {
  readonly id: HomeModuleId;
  readonly view: AppView;
  readonly title: string;
  readonly detail: string;
  readonly action: string;
  readonly icon: HomeModuleIcon;
  readonly routeContext?: WorkspaceRouteContext;
}

export interface HomeLocationAggregate {
  readonly id: string;
  readonly name: string;
  readonly completedJobs: number;
  readonly delivered: number;
  readonly uniqueClicks: number;
}

export interface HomeProjection {
  readonly locations: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  readonly activeLocation: HomeLocationAggregate;
  readonly requestCount: number;
}

export const HOME_MODULES = [
  { id: "google-profile", view: "google-profile", title: "Google Profile", detail: "Open the selected location's Google Profile workspace.", action: "Open Profile", icon: "profile", routeContext: { googleProfileTab: "profile" } },
  { id: "reviews", view: "google-profile", title: "Reviews", detail: "Read Google review records inside their protected profile boundary.", action: "Open Reviews", icon: "reviews", routeContext: { googleProfileTab: "reviews" } },
  { id: "requests-qr", view: "google-profile", title: "Requests & QR", detail: "Manage neutral review requests, workflow state, and QR access.", action: "Open Requests & QR", icon: "requests", routeContext: { googleProfileTab: "requests-qr" } },
  { id: "content", view: "content", title: "Content", detail: "Open the manual-first content workspace and readiness journey.", action: "Open Content", icon: "content", routeContext: { contentTab: "create" } },
  { id: "reports", view: "reports", title: "Reports", detail: "Review location-scoped operational performance and proof of value.", action: "Open Reports", icon: "reports" },
  { id: "connections", view: "settings-billing", title: "Connections", detail: "Check operational services and publication readiness separately.", action: "Open Connections", icon: "connections", routeContext: { settingsBillingTab: "connections" } },
  { id: "billing", view: "settings-billing", title: "Billing", detail: "Open the authorised account, plan, team, and SMS allowance view.", action: "Open Billing", icon: "billing", routeContext: { settingsBillingTab: "billing" } },
] as const satisfies readonly HomeModule[];

export function buildHomeProjection(business: BusinessAccount, requests: readonly RequestRecord[], selectedLocationId?: string): HomeProjection {
  const sourceLocations = business.locationReports?.length
    ? business.locationReports
    : [{ id: business.locationId ?? business.id, name: business.locationName, completedJobs: business.metrics.completedJobs, delivered: business.metrics.delivered, uniqueClicks: business.metrics.uniqueClicks }];
  const projectedLocations = sourceLocations.map(({ id, name, completedJobs, delivered, uniqueClicks }) => ({ id, name, completedJobs, delivered, uniqueClicks }));
  const activeLocation = projectedLocations.find(({ id }) => id === selectedLocationId) ?? projectedLocations[0];
  if (!activeLocation) throw new Error("Scoped business must expose at least one Home location.");
  return {
    locations: projectedLocations.map(({ id, name }) => ({ id, name })),
    activeLocation,
    requestCount: requests.filter(({ businessId, locationId }) => businessId === business.id && locationId === activeLocation.id).length,
  };
}
```

- [ ] **Step 4: Run the focused domain tests**

Run: `node --import tsx --test tests/home-domain.test.ts`

Expected: PASS with 3 tests and no skipped tests.

- [ ] **Step 5: Commit the domain increment**

```bash
git add src/features/home/home-domain.ts tests/home-domain.test.ts
git commit -m "feat: project review-free Home data"
```

### Task 2: Consolidate the Home UI and Remove Growth Suite

**Files:**
- Modify: `src/features/home/HomeView.tsx`
- Modify: `src/App.tsx`
- Delete: `src/growth/GrowthSuite.tsx`
- Create: `tests/home-view.test.ts`
- Modify: `tests/workspace-routing.test.ts`

**Interfaces:**
- Consumes: `HOME_MODULES` and `buildHomeProjection` from Task 1, plus the exact approved `HomeViewProps` below.
- Produces: one complete `HomeView` feature; `App.tsx` no longer imports `GrowthSuite` or passes `reviews`, `businesses`, or `agencyMode` to Home.

- [ ] **Step 1: Write the failing server-rendered Home tests**

Create `tests/home-view.test.ts`. Use the same safe business/request fixtures from `tests/home-domain.test.ts`, add marker strings only to fields that Home must not render, and cover these cases:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import React, { createElement } from "react";
import { existsSync, readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import type { BusinessAccount, RequestRecord, SessionContext } from "../src/platform/domain.js";
import type { HomeViewProps } from "../src/features/home/HomeView.js";

(globalThis as typeof globalThis & { React: typeof React }).React = React;
const { HomeView } = await import("../src/features/home/HomeView.js");

const business: BusinessAccount = {
  id: "business-1",
  locationId: "location-a",
  agencyId: "agency-1",
  name: "Harbour & Hearth",
  locationName: "Bristol",
  initials: "HH",
  country: "GB",
  timezone: "Europe/London",
  health: "Healthy",
  healthTone: "success",
  automationState: "Live",
  integrationSummary: "Operational",
  lastSuccess: "Last completed-job trigger · 4 min ago",
  affectedCount: 0,
  plan: "Reputation Multi",
  seedRequestCount: 0,
  metrics: { completedJobs: 20, eligibleCustomers: 18, delivered: 16, uniqueClicks: 5, reviewsDetected: 99, rating: 4.9, totalReviews: 999 },
  teamMembers: [],
  integrations: {
    google: { status: "Healthy", tone: "success", lastEvent: "Synced" },
    messaging: { status: "Healthy", tone: "success", lastEvent: "Delivered" },
    jobIntake: { status: "Healthy", tone: "success", lastEvent: "Received" },
  },
  locationReports: [
    { id: "location-a", name: "Bristol", completedJobs: 12, delivered: 10, uniqueClicks: 3, reviewsDetected: 77, rating: 4.8, totalReviews: 700, smsSegments: 8 },
    { id: "location-b", name: "Bath", completedJobs: 8, delivered: 6, uniqueClicks: 2, reviewsDetected: 22, rating: 4.7, totalReviews: 299, smsSegments: 4 },
  ],
};
const requests: RequestRecord[] = [
  { id: "request-a", businessId: "business-1", locationId: "location-a", customer: "PRIVATE_CUSTOMER_A", job: "PRIVATE_JOB_A", channel: "SMS", destination: "PRIVATE_DESTINATION_A", status: "Delivered", createdAt: "2026-07-20T10:00:00Z", consentBasis: "Booking form consent", consentStatus: "Verified", consentReference: "consent-a", consentCapturedAt: "2026-07-20T09:00:00Z", consentWordingVersion: "review_request_v2" },
  { id: "request-b", businessId: "business-1", locationId: "location-b", customer: "PRIVATE_CUSTOMER_B", job: "PRIVATE_JOB_B", channel: "Email", destination: "PRIVATE_DESTINATION_B", status: "Delivered", createdAt: "2026-07-20T11:00:00Z", consentBasis: "Booking form consent", consentStatus: "Verified", consentReference: "consent-b", consentCapturedAt: "2026-07-20T09:30:00Z", consentWordingVersion: "review_request_v2" },
];
const session: SessionContext = {
  userId: "user-1",
  userName: "Alex Morgan",
  role: "business_owner",
  productRole: "owner",
  businessRole: "owner",
  businessId: "business-1",
  mfaVerified: true,
};

function render(overrides: Partial<HomeViewProps> = {}) {
  return renderToStaticMarkup(createElement(HomeView, {
    business,
    requests,
    session,
    hasSupportSession: false,
    canConfigure: true,
    canManageBilling: true,
    selectedLocationId: "location-b",
    onSelectLocation: () => undefined,
    onNavigate: () => undefined,
    onAddJob: () => undefined,
    ...overrides,
  }));
}

test("renders selected-location operational aggregates and seven launch destinations", () => {
  const markup = render();
  for (const [label, value] of [["Completed jobs", "8"], ["Requests delivered", "6"], ["Unique link clicks", "2"]]) {
    assert.match(markup, new RegExp(`<span>${label}</span><strong>${value}</strong>`));
  }
  assert.match(markup, /<span>Automation<\/span><strong>Live<\/strong>/);
  for (const title of ["Google Profile", "Reviews", "Requests &amp; QR", "Content", "Reports", "Connections", "Billing"]) assert.ok(markup.includes(title));
  assert.match(markup, /1 request in the selected location context\./);
});

test("invalid selection falls back inside the scoped business", () => {
  const markup = render({ selectedLocationId: "foreign-location" });
  assert.match(markup, /<option value="location-a" selected="">Bristol<\/option>/);
  assert.match(markup, /<span>Completed jobs<\/span><strong>12<\/strong>/);
});

test("Home excludes review records and private request fields", () => {
  const markup = render();
  for (const marker of ["PRIVATE_CUSTOMER_A", "PRIVATE_CUSTOMER_B", "PRIVATE_JOB_A", "PRIVATE_JOB_B", "PRIVATE_DESTINATION_A", "PRIVATE_DESTINATION_B"]) {
    assert.equal(markup.includes(marker), false, `must not render ${marker}`);
  }
  assert.doesNotMatch(markup, /Google rating|Reviews detected|Awaiting owner reply/i);
  const visibleText = markup.replace(/<svg[\s\S]*?<\/svg>/gu, "");
  assert.equal(visibleText.includes("4.9"), false);
  assert.equal(visibleText.includes("999"), false);
});

test("completed-job action follows configuration permission", () => {
  assert.match(render(), />Add completed job<\/button>/);
  const readOnly = render({ canConfigure: false, canManageBilling: false });
  assert.doesNotMatch(readOnly, />Add completed job<\/button>/);
  assert.match(readOnly, /You have read-only access/);
});

test("App composes Home without review data and Growth Suite is retired", () => {
  const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const homeSource = readFileSync(new URL("../src/features/home/HomeView.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(appSource, /GrowthSuite/u);
  const call = appSource.match(/<HomeView\b[\s\S]*?\/>/u)?.[0] ?? "";
  for (const prop of ["business={business}", "requests={requests}", "session={session}", "hasSupportSession={Boolean(supportSession)}", "canConfigure={canConfigure}", "canManageBilling={canManageTenantBilling}", "selectedLocationId={selectedLocationId}"]) assert.ok(call.includes(prop), `missing ${prop}`);
  assert.doesNotMatch(call, /reviews=|businesses=|agencyMode=|oauth|token|secret|destination|readiness/iu);
  assert.doesNotMatch(homeSource, /ReviewRecord|reviews\s*:/u);
  assert.equal(existsSync(new URL("../src/growth/GrowthSuite.tsx", import.meta.url)), false);
});
```

Also render an `agency_admin` session with `hasSupportSession: true` and assert its authorised tenant modules are present; render the same session with `false` and assert tenant modules are absent.

- [ ] **Step 2: Run the Home view tests and verify they fail on the wrapper-only component**

Run: `node --import tsx --test tests/home-view.test.ts`

Expected: FAIL because the current `HomeView` accepts only `children` and does not render the approved launchpad.

- [ ] **Step 3: Replace the wrapper with the complete Home feature**

Replace `src/features/home/HomeView.tsx` with this complete implementation:

```tsx
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Building2,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  Link2,
  MapPin,
  QrCode,
  ShieldCheck,
  Star,
} from "lucide-react";
import type { BusinessAccount, RequestRecord, SessionContext } from "../../platform/domain";
import { isAppViewAllowed, type AppView, type WorkspaceRouteContext } from "../../routing";
import { HOME_MODULES, buildHomeProjection } from "./home-domain";

export interface HomeViewProps {
  business: BusinessAccount;
  requests: RequestRecord[];
  session: SessionContext;
  hasSupportSession: boolean;
  canConfigure: boolean;
  canManageBilling: boolean;
  selectedLocationId?: string;
  onSelectLocation: (locationId: string) => void;
  onNavigate: (view: AppView, context?: WorkspaceRouteContext) => void;
  onAddJob: () => void;
}

const HOME_ICONS = {
  profile: MapPin,
  reviews: Star,
  requests: QrCode,
  content: Activity,
  reports: FileText,
  connections: Link2,
  billing: Building2,
} as const;

export function HomeView({
  business,
  requests,
  session,
  hasSupportSession,
  canConfigure,
  canManageBilling,
  selectedLocationId,
  onSelectLocation,
  onNavigate,
  onAddJob,
}: HomeViewProps) {
  const { locations, activeLocation, requestCount } = buildHomeProjection(business, requests, selectedLocationId);
  const availableModules = HOME_MODULES.filter((module) => (
    isAppViewAllowed(module.view, session.role, hasSupportSession, session.businessRole)
  ));

  return (
    <div className="product-feature product-feature--home">
      <div className="growth-suite" data-testid="home-business">
        <section className="growth-hero">
          <div>
            <span className="eyebrow">Workspace Home · {business.name}</span>
            <h2>Keep customer requests moving from one scoped workspace.</h2>
            <p>Open Google Profile, Content, Reports, Connections, and Billing without moving review records outside their protected feature.</p>
            <div className="growth-hero__actions">
              <button className="button" type="button" onClick={() => onNavigate("google-profile", { googleProfileTab: "profile" })}>
                <Star size={16} /> Open Google Profile
              </button>
              {canConfigure
                ? <button className="button button--secondary" type="button" onClick={onAddJob}><ClipboardCheck size={16} /> Add completed job</button>
                : <small>Your role has read-only access to completed jobs.</small>}
            </div>
          </div>
          <div className="growth-context-card">
            <span><ShieldCheck size={16} /> Signed in as {session.userName}</span>
            <strong>{business.name}</strong>
            <label htmlFor="home-location">Business location</label>
            <select id="home-location" value={activeLocation.id} onChange={(event) => onSelectLocation(event.target.value)}>
              {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
            </select>
            <small><MapPin size={14} /> The selected location is preserved across the workspace.</small>
          </div>
        </section>

        <section className="growth-metrics" aria-label="Selected location operational summary">
          <article><span>Completed jobs</span><strong>{activeLocation.completedJobs}</strong><small>Selected location workflow volume</small></article>
          <article><span>Requests delivered</span><strong>{activeLocation.delivered}</strong><small>Neutral request delivery count</small></article>
          <article><span>Unique link clicks</span><strong>{activeLocation.uniqueClicks}</strong><small>Aggregate request-link activity</small></article>
          <article><span>Automation</span><strong>{business.automationState}</strong><small>{business.lastSuccess}</small></article>
        </section>

        <section className="growth-module-section" aria-labelledby="home-modules-title">
          <div className="growth-section-head">
            <div><span className="eyebrow">Scoped workspace</span><h3 id="home-modules-title">Product areas</h3></div>
            <p>{requestCount} {requestCount === 1 ? "request" : "requests"} in the selected location context.</p>
          </div>
          <div className="growth-module-grid">
            {availableModules.map((module) => {
              const Icon = HOME_ICONS[module.icon];
              return (
                <article key={module.id} className={module.id === "google-profile" ? "is-primary" : undefined}>
                  <span className="growth-module-card__icon"><Icon size={20} /></span>
                  <h4>{module.title}</h4>
                  <p>{module.detail}</p>
                  <button type="button" onClick={() => onNavigate(module.view, module.routeContext)}>{module.action} <ArrowRight size={15} /></button>
                </article>
              );
            })}
          </div>
        </section>

        {!canConfigure && (
          <div className="growth-permission-note" role="status">
            <AlertTriangle size={17} /> {canManageBilling
              ? "Customer and workflow changes are disabled for this role. Account and billing controls remain available."
              : "You have read-only access. Navigation remains available, but configuration and customer actions stay disabled."}
          </div>
        )}
        {canConfigure && business.healthTone === "success" && (
          <div className="growth-permission-note growth-permission-note--success" role="status">
            <CheckCircle2 size={17} /> Home is using the active tenant and location context shown above.
          </div>
        )}
      </div>
    </div>
  );
}
```

Do not port `Stars`, `AgencyGrowthDashboard`, the recent-review panel, review empty state, review metrics, `IS_DEMO_MODE`, or any `ReviewRecord` import.

- [ ] **Step 4: Update App composition and retire Growth Suite**

In `src/App.tsx`, remove the `GrowthSuite` import and replace the nested `<HomeView><GrowthSuite ... /></HomeView>` branch with:

```tsx
{!agencyMode && canReadTenant && view === "home" && <HomeView
  business={business}
  requests={requests}
  session={session}
  hasSupportSession={Boolean(supportSession)}
  canConfigure={canConfigure}
  canManageBilling={canManageTenantBilling}
  selectedLocationId={selectedLocationId}
  onSelectLocation={(locationId) => navigateToView("home", { businessId: business.id, locationId })}
  onNavigate={navigateToView}
  onAddJob={() => setAddJobOpen(true)}
/>}
```

Delete `src/growth/GrowthSuite.tsx` after confirming no source import remains. Update the Home page header description to: `Selected-location completed jobs, request delivery, link activity, and product navigation.`

- [ ] **Step 5: Update the existing canonical Home route regression**

In `tests/workspace-routing.test.ts`, load `HOME_MODULES` from `/src/features/home/home-domain.ts` and assert the seven exact titles and routes:

```ts
assert.equal(routeFor("Google Profile"), "/app/google-profile");
assert.equal(routeFor("Reviews"), "/app/google-profile/reviews");
assert.equal(routeFor("Requests & QR"), "/app/google-profile/requests-qr");
assert.equal(routeFor("Content"), "/app/content");
assert.equal(routeFor("Reports"), "/app/reports");
assert.equal(routeFor("Connections"), "/app/settings-billing/connections");
assert.equal(routeFor("Billing"), "/app/settings-billing/billing");
```

Remove the old assertions for separate Customer requests, Review workflow, and Review QR codes cards.

- [ ] **Step 6: Run focused Home, routing, and security tests**

Run:

```bash
node --import tsx --test tests/home-domain.test.ts tests/home-view.test.ts tests/workspace-routing.test.ts tests/google-profile-policy.test.ts tests/platform-security.test.ts tests/backend-security.test.ts
```

Expected: PASS with no failures or skipped tests. The existing billing-only routing and render assertions must remain green.

- [ ] **Step 7: Run type and diff hygiene checks**

Run:

```bash
npm.cmd run typecheck
git diff --check
```

Expected: both commands exit 0 with no TypeScript or whitespace errors.

- [ ] **Step 8: Commit the consolidated Home feature**

```bash
git add src/App.tsx src/features/home/HomeView.tsx src/features/home/home-domain.ts tests/home-view.test.ts tests/workspace-routing.test.ts
git add -u src/growth/GrowthSuite.tsx
git commit -m "refactor: consolidate review-free Home"
```

Task 1's `home-domain.ts` is already committed; staging it again is harmless but should produce no new diff.

### Task 3: Whole-Slice Verification and Review

**Files:**
- Verify: all files changed from stable slice base `0febc08` through `HEAD`.
- Do not modify external integration, migration, provider, storage, billing, or MobileWAN files.

**Interfaces:**
- Consumes: the committed review-free Home projection and consolidated Home UI.
- Produces: a reviewed, locally verified branch increment with no open critical or important findings.

- [ ] **Step 1: Inspect the complete slice from its stable base**

Run: `git diff 0febc08..HEAD`

Expected: only the Home spec/plan, Home feature/domain, App composition, obsolete Growth Suite deletion, and tests appear.

- [ ] **Step 2: Run the full local validation gates**

Run:

```bash
npm.cmd run check
npm.cmd run build:demo
git diff --check
```

Expected: secret scan, typecheck, full tests, production build, demo build, and diff hygiene all exit 0.

- [ ] **Step 3: Complete independent whole-slice review**

Review against `docs/superpowers/specs/2026-07-22-home-operational-launchpad-design.md`, specifically checking review-record exclusion, exact module destinations, scoped fallback behavior, permission preservation, billing-only routing, responsive markup, obsolete Growth Suite removal, and absence of external scope.

Expected: no open critical or important findings. If review finds a defect, add an executed regression test, apply the smallest scoped fix, commit it separately, rerun Step 2, and repeat review.

- [ ] **Step 4: Push the reviewed branch increment**

Run: `git push origin codex/simplified-product`

Expected: `origin/codex/simplified-product` advances to the locally reviewed HEAD. Keep the worktree and do not create a misleading pull request against the known-stale base branch.
