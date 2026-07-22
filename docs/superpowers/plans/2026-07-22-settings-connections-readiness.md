# Settings Connections Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the existing operational Connections UI into the Settings feature and add a separate, read-only, fail-closed publication-readiness ledger for five destinations.

**Architecture:** A pure `connection-readiness.ts` module owns immutable publication capability records and never reads runtime provider state. `ConnectionsView.tsx` owns the existing operational presentation plus the static ledger, while `App.tsx` remains the composition root and injects only the scoped business, protected service projection, demo/configuration state, the existing Google setup callback, and shared presentation components.

**Tech Stack:** React 19, TypeScript 7, `lucide-react`, Node's built-in test runner, React server rendering, Vite.

## Global Constraints

- Preserve operational Google Business Profile review-sync/setup, messaging-provider, completed-job intake, protected service availability, and integration-event behavior.
- A healthy operational connection must never imply publication capability.
- Google posts and media, Facebook Page, Instagram professional account, LinkedIn organisation, and YouTube channel are each always `unavailable` in this slice.
- Do not add social connection buttons, OAuth, destination enumeration, publishing or scheduling controls, provider calls, persistence, API/server changes, database/migrations, Storage, Stripe, moderation, GPU, or MobileWAN work.
- Preserve billing-only access: users without Connections access must not see the Connections tab or its content.
- Preserve the existing Google setup rules: authenticated non-demo runtime, configured Google service, completed service loading, configuration permission, and no support-session restriction as already decided by the caller.
- Static unavailable entries use visible text, not disabled buttons or colour alone, and must wrap without introducing horizontal overflow.
- Do not claim live browser, provider, or production readiness from this slice.

## File Structure

- `src/features/settings/connection-readiness.ts`: typed, immutable, fail-closed publication capability records only.
- `src/features/settings/ConnectionsView.tsx`: operational connection cards, protected service availability, event log, and static publication ledger.
- `src/App.tsx`: import and compose `ConnectionsView`; remove only the former inline `IntegrationsView` and icons no longer used elsewhere.
- `tests/settings-connection-readiness.test.ts`: executed domain tests for exact capability coverage and prerequisites.
- `tests/settings-connections-view.test.ts`: server-rendered behavior, security-boundary, and composition tests.
- `tests/workspace-routing.test.ts`: retain the existing billing-only Connections access regression without broad routing changes.

---

### Task 1: Define the Fail-Closed Publication Readiness Model

**Files:**
- Create: `src/features/settings/connection-readiness.ts`
- Create: `tests/settings-connection-readiness.test.ts`

**Interfaces:**
- Consumes: no runtime state, environment variables, evidence documents, or provider records.
- Produces: `PublicationCapabilityId`, `PublicationCapability`, and `PUBLICATION_CAPABILITIES: readonly PublicationCapability[]` for Task 2.

- [ ] **Step 1: Write the failing domain test**

Create `tests/settings-connection-readiness.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the domain test and verify the missing-module failure**

Run: `node --import tsx --test tests/settings-connection-readiness.test.ts`

Expected: FAIL because `src/features/settings/connection-readiness.ts` does not exist.

- [ ] **Step 3: Add the immutable readiness model**

Create `src/features/settings/connection-readiness.ts`:

```ts
export type PublicationCapabilityId =
  | "google-posts-media"
  | "facebook-page"
  | "instagram-professional"
  | "linkedin-organisation"
  | "youtube-channel";

export interface PublicationCapability {
  readonly id: PublicationCapabilityId;
  readonly label: string;
  readonly status: "unavailable";
  readonly prerequisites: string;
}

export const PUBLICATION_CAPABILITIES = [
  {
    id: "google-posts-media",
    label: "Google posts and media",
    status: "unavailable",
    prerequisites: "Requires approved write scopes, exact location capability, destination reconciliation, and a controlled pilot.",
  },
  {
    id: "facebook-page",
    label: "Facebook Page",
    status: "unavailable",
    prerequisites: "Requires Meta app approval, required Page scopes, exact Page enumeration, reconciliation, and a controlled pilot.",
  },
  {
    id: "instagram-professional",
    label: "Instagram professional account",
    status: "unavailable",
    prerequisites: "Requires Meta app approval, professional-account linkage and enumeration, required scopes, reconciliation, and a controlled pilot.",
  },
  {
    id: "linkedin-organisation",
    label: "LinkedIn organisation",
    status: "unavailable",
    prerequisites: "Requires LinkedIn app approval, an authorised organisation or Page role, organisation enumeration, reconciliation, and a controlled pilot.",
  },
  {
    id: "youtube-channel",
    label: "YouTube channel",
    status: "unavailable",
    prerequisites: "Requires an approved API project, required scopes, exact channel enumeration, upload reconciliation, and a controlled pilot.",
  },
] as const satisfies readonly PublicationCapability[];
```

- [ ] **Step 4: Run the focused model test**

Run: `node --import tsx --test tests/settings-connection-readiness.test.ts`

Expected: PASS with 1 test and no skipped tests.

- [ ] **Step 5: Commit the model increment**

```bash
git add src/features/settings/connection-readiness.ts tests/settings-connection-readiness.test.ts
git commit -m "feat: define publication readiness states"
```

### Task 2: Extract and Render the Connections Feature

**Files:**
- Create: `src/features/settings/ConnectionsView.tsx`
- Create: `tests/settings-connections-view.test.ts`
- Modify: `src/App.tsx`
- Verify unchanged policy: `tests/workspace-routing.test.ts`

**Interfaces:**
- Consumes: `PUBLICATION_CAPABILITIES` from Task 1; `BusinessAccount`; `ServiceStatus[]`; `demoMode`; `canConfigure`; `servicesLoading`; `onConnect`; injected `ButtonComponent`, `StatusPillComponent`, and `DemoNoticeComponent`.
- Produces: `ConnectionsView(props: ConnectionsViewProps): ReactElement`, imported once by `App.tsx`.

- [ ] **Step 1: Write the failing server-rendered feature tests**

Create `tests/settings-connections-view.test.ts` with a safe fixture derived from `BUSINESSES[0]`, three small injected presentation components, and these executed cases:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import React, { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { BUSINESSES, type BusinessAccount } from "../src/platform/domain.js";
import type { ServiceStatus } from "../src/platform/api.js";
import type { ConnectionsViewProps } from "../src/features/settings/ConnectionsView.js";

(globalThis as typeof globalThis & { React: typeof React }).React = React;
const { ConnectionsView } = await import("../src/features/settings/ConnectionsView.js");

const seededBusiness = BUSINESSES[0];
assert.ok(seededBusiness);
const business: BusinessAccount = {
  ...seededBusiness,
  integrations: {
    google: { status: "Healthy", tone: "success", lastEvent: "Google sync completed" },
    messaging: { status: "Attention", tone: "warning", lastEvent: "Messaging configuration checked" },
    jobIntake: { status: "Healthy", tone: "success", lastEvent: "Completed job received" },
  },
};
const configuredServices: ServiceStatus[] = [
  { key: "google", label: "Google Business Profile", configured: true, requires: [], detail: "Configured for review sync." },
  { key: "messaging", label: "Messaging", configured: false, requires: ["provider credentials"], detail: "Not configured." },
];
const Button = ({ children, disabled }: { children: ReactNode; disabled?: boolean }) => createElement("button", { type: "button", disabled }, children);
const StatusPill = ({ children }: { children: ReactNode }) => createElement("span", null, children);
const DemoNotice = () => createElement("aside", null, "Sample data");

function render(overrides: Partial<ConnectionsViewProps> = {}) {
  return renderToStaticMarkup(createElement(ConnectionsView, {
    business,
    onConnect: () => undefined,
    canConfigure: true,
    services: configuredServices,
    servicesLoading: false,
    demoMode: false,
    ButtonComponent: Button,
    StatusPillComponent: StatusPill,
    DemoNoticeComponent: DemoNotice,
    ...overrides,
  }));
}

test("preserves scoped operational status, service availability, and event summaries", () => {
  const markup = render();
  for (const text of [
    "Google Business Profile", "Review sync and direct review destination", "Google sync completed",
    "Messaging provider", "SMS and email delivery events", "Messaging configuration checked",
    "Completed-job intake", "Receives genuine customer job completions", "Completed job received",
    "Service availability", "1/2 configured", "Needs: provider credentials", "Integration event log",
    business.name,
  ]) assert.ok(markup.includes(text), `missing ${text}`);
});

test("keeps publication readiness separate and unavailable despite healthy Google operations", () => {
  const markup = render();
  assert.match(markup, /Publication readiness/);
  assert.equal((markup.match(/>Unavailable</g) ?? []).length, 5);
  for (const label of ["Google posts and media", "Facebook Page", "Instagram professional account", "LinkedIn organisation", "YouTube channel"]) {
    assert.ok(markup.includes(label), `missing ${label}`);
  }
  const ledger = markup.match(/<section[^>]*aria-labelledby="publication-readiness-title"[\s\S]*?<\/section>/u)?.[0] ?? "";
  assert.doesNotMatch(ledger, /<button|<a\b|<input|<select|<form/u);
  assert.doesNotMatch(ledger, /oauth|token|secret|page id|channel id|connected|healthy|publish now|schedule/i);
});

test("Google setup follows configured, loading, authorization, and demo rules", () => {
  assert.match(render(), />Review setup<\/button>/);
  assert.doesNotMatch(render(), /<button[^>]*disabled=""[^>]*>Review setup<\/button>/);
  assert.match(render({ canConfigure: false }), /<button[^>]*disabled=""[^>]*>Review setup<\/button>/);
  assert.match(render({ servicesLoading: true }), /<button[^>]*disabled=""[^>]*>Checking availability…<\/button>/);
  assert.match(render({ services: [] }), /<button[^>]*disabled=""[^>]*>Unavailable<\/button>/);
  const demo = render({ demoMode: true });
  assert.match(demo, /Connection setup requires an authenticated deployment/);
  assert.doesNotMatch(demo, />Review setup<\/button>/);
});

test("App composes the extracted view without social callbacks or readiness injection", () => {
  const source = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /function IntegrationsView/u);
  const call = source.match(/<ConnectionsView\b[^>]*\/>/su)?.[0] ?? "";
  assert.match(call, /business=\{contextBusiness\}/u);
  assert.match(call, /onConnect=\{\(\) => void beginGoogleConnection\(\)\}/u);
  assert.match(call, /canConfigure=\{canConfigure && !supportSession\}/u);
  assert.match(call, /services=\{services\}/u);
  assert.match(call, /servicesLoading=\{servicesLoading\}/u);
  assert.match(call, /demoMode=\{IS_DEMO_MODE\}/u);
  assert.doesNotMatch(call, /meta|facebook|instagram|linkedin|youtube|oauth|token|secret|destination|readiness/iu);
});
```

- [ ] **Step 2: Run the view tests and verify the missing-module failure**

Run: `node --import tsx --test tests/settings-connections-view.test.ts`

Expected: FAIL because `src/features/settings/ConnectionsView.tsx` does not exist.

- [ ] **Step 3: Extract the operational view and add the static ledger**

Create `src/features/settings/ConnectionsView.tsx` with these exact exported prop contracts:

```ts
import type { ComponentType, ReactNode } from "react";
import { AlertTriangle, CheckCircle2, MapPin, Send, Webhook } from "lucide-react";
import type { ServiceStatus } from "../../platform/api";
import type { BusinessAccount } from "../../platform/domain";
import { PUBLICATION_CAPABILITIES } from "./connection-readiness";

type ButtonProps = {
  children: ReactNode;
  variant?: "primary" | "secondary" | "quiet" | "danger";
  onClick?: () => void;
  disabled?: boolean;
};
type StatusPillProps = { tone?: string; children: ReactNode };

export interface ConnectionsViewProps {
  business: BusinessAccount;
  onConnect: () => void;
  canConfigure: boolean;
  services: ServiceStatus[];
  servicesLoading: boolean;
  demoMode: boolean;
  ButtonComponent: ComponentType<ButtonProps>;
  StatusPillComponent: ComponentType<StatusPillProps>;
  DemoNoticeComponent: ComponentType;
}
```

Implement the body by moving the existing `IntegrationsView` operational records and JSX without changing their labels, details, tones, last events, attention count, service requirements, or Google blocking logic, except replace `IS_DEMO_MODE`, `Button`, `StatusPill`, and `DemoNotice` with the injected props. Between the operational grid and service availability, render this separate static section:

```tsx
<section className="panel" aria-labelledby="publication-readiness-title">
  <header className="panel__head">
    <div>
      <h2 id="publication-readiness-title">Publication readiness</h2>
      <p>Operational connection health does not approve a publishing destination.</p>
    </div>
  </header>
  <div className="integration-grid">
    {PUBLICATION_CAPABILITIES.map((capability) => (
      <article className="integration-card" key={capability.id}>
        <div><h3>{capability.label}</h3><p>{capability.prerequisites}</p></div>
        <span className="status-pill status-pill--warning">Unavailable</span>
      </article>
    ))}
  </div>
</section>
```

Do not add any callback or runtime lookup for publication capabilities.

- [ ] **Step 4: Replace the inline App component with scoped composition**

In `src/App.tsx`:

1. Import `ConnectionsView` from `./features/settings/ConnectionsView`.
2. Delete the complete inline `IntegrationsView` function.
3. Remove `Send` and `Webhook` from the `lucide-react` import because their only JSX use moves; retain `MapPin`, which is still used by the Google location dialog.
4. Replace the existing `<IntegrationsView ... />` call with:

```tsx
<ConnectionsView
  business={contextBusiness}
  onConnect={() => void beginGoogleConnection()}
  canConfigure={canConfigure && !supportSession}
  services={services}
  servicesLoading={servicesLoading}
  demoMode={IS_DEMO_MODE}
  ButtonComponent={Button}
  StatusPillComponent={StatusPill}
  DemoNoticeComponent={DemoNotice}
/>
```

Keep the surrounding `SettingsBillingView`, `canAccessConnections={session.businessRole !== "billing" && canReadTenant}`, billing branch, and access-expired behavior unchanged.

- [ ] **Step 5: Run focused Settings, routing, and security tests**

Run:

```bash
node --import tsx --test tests/settings-connection-readiness.test.ts tests/settings-connections-view.test.ts tests/workspace-routing.test.ts tests/platform-security.test.ts tests/backend-security.test.ts
```

Expected: PASS with no failures or skipped tests. The existing billing-only server-rendered assertion must still prove that `Connections` is absent.

- [ ] **Step 6: Run type and diff hygiene checks**

Run:

```bash
npm.cmd run typecheck
git diff --check
```

Expected: both commands exit 0 with no TypeScript errors or whitespace errors.

- [ ] **Step 7: Commit the extracted Settings feature**

```bash
git add src/App.tsx src/features/settings/ConnectionsView.tsx tests/settings-connections-view.test.ts
git commit -m "feat: show settings connection readiness"
```

### Task 3: Whole-Slice Verification and Review

**Files:**
- Verify: all files changed by Tasks 1 and 2
- Do not modify external integration, migration, provider, storage, billing, or MobileWAN files.

**Interfaces:**
- Consumes: the committed readiness model and extracted Connections UI.
- Produces: a reviewed, locally verified branch increment with no open critical or important findings.

- [ ] **Step 1: Inspect the complete slice against the approved spec**

Run:

```bash
git diff 521b208..HEAD
```

Expected: only provider-independent Settings extraction, static readiness content, tests, and composition changes appear; no external writes or new provider activation path exists.

- [ ] **Step 2: Run the full local validation gates**

Run:

```bash
npm.cmd run check
npm.cmd run build:demo
git diff --check
```

Expected: secret scan, typecheck, full tests, production build, demo build, and diff hygiene all exit 0.

- [ ] **Step 3: Complete independent whole-slice review**

Review against `docs/superpowers/specs/2026-07-22-settings-connections-readiness-design.md`, specifically checking authorization preservation, operational parity, fail-closed publication status, sensitive-data exclusions, responsive semantic markup, and `App.tsx` composition boundaries.

Expected: no open critical or important findings. If review finds a defect, add an executed regression test, apply the smallest scoped fix, commit it separately, rerun Step 2, and repeat review.

- [ ] **Step 4: Push the reviewed branch increment**

```bash
git push origin codex/simplified-product
```

Expected: `origin/codex/simplified-product` advances to the locally reviewed HEAD. Do not create a misleading pull request against the known-stale base branch.
