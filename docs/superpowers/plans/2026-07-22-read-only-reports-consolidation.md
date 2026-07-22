# Read-only Reports Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the existing scoped printable report from `App.tsx` into the Reports feature and add explicitly unavailable publishing and MobileWAN outcome sections without introducing backend or provider work.

**Architecture:** A pure `reports-domain.ts` module calculates selected or combined report projections from existing scoped workspace records. `ReportsView.tsx` owns scope state and report rendering, while `App.tsx` remains a composition root that supplies the scoped business records and existing shared presentation components through explicit props.

**Tech Stack:** React 19, TypeScript 7, React DOM server rendering, Node test runner, existing workspace domain types and CSS.

## Global Constraints

- Preserve the current selected-location report and optional all-locations report.
- Preserve print behavior, identity, request metrics, Google rating snapshot, operational checks, location table, and attribution disclaimer.
- Keep canonical business/location scope; never select a fallback tenant.
- Publishing outcomes and MobileWAN usage are `Unavailable`, never fabricated zeroes.
- Never render review bodies, prompts, signed URLs, provider receipts, customer destinations, OAuth state, or internal audit reasons.
- Do not add content, upload, approval, publication, generation, billing, or connection controls.
- Do not add APIs, repositories, migrations, database queries, workers, secrets, Storage, Stripe, or provider code.
- The feature must not import from `App.tsx`; shared presentation dependencies are explicit component props.
- Keep current responsive and print CSS unless a concrete extraction regression requires a narrow change.
- Use red-green-refactor and commit only each task's named files.

---

## File map

- Create `src/features/reports/reports-domain.ts`: pure report scope and combined-metric projection.
- Replace `src/features/reports/ReportsView.tsx`: full extracted report and future-outcome readiness sections.
- Modify `src/App.tsx`: remove inline report and compose the feature directly.
- Create `tests/reports-domain.test.ts`: projection, weighting, scope, and reset behavior.
- Create `tests/reports-view.test.ts`: rendered report contract.
- Modify `tests/google-profile-policy.test.ts`: read the extracted Reports feature for the review-body boundary.

## Task 1: Add pure scoped report projection

**Files:**

- Create: `src/features/reports/reports-domain.ts`
- Create: `tests/reports-domain.test.ts`

**Interfaces:**

- Consumes `BusinessAccount`, `LocationReportSummary`, and `TenantMetrics` from `src/platform/domain.ts`.
- Produces `combinedReportMetrics(business): TenantMetrics`, `buildReportProjection(business, selectedBusiness, combined): ReportProjection`, `canCombineReportLocations(business): boolean`, and `combinedScopeAfterLocationSelection(): false`.

- [ ] **Step 1: Write failing domain tests**

Create `tests/reports-domain.test.ts` with fixtures for one selected location and two location summaries. Assert:

```ts
assert.equal(canCombineReportLocations(multiLocationBusiness), true);
assert.equal(canCombineReportLocations({ ...multiLocationBusiness, locationReports: [locationA] }), false);
assert.deepEqual(buildReportProjection(multiLocationBusiness, selectedLocation, false).metrics, selectedLocation.metrics);

const combined = buildReportProjection(multiLocationBusiness, selectedLocation, true);
assert.equal(combined.isCombinedReport, true);
assert.equal(combined.metrics.completedJobs, 18);
assert.equal(combined.metrics.delivered, 14);
assert.equal(combined.metrics.uniqueClicks, 9);
assert.equal(combined.metrics.reviewsDetected, 4);
assert.equal(combined.metrics.totalReviews, 30);
assert.equal(combined.metrics.rating, 4.5);
assert.equal(combinedScopeAfterLocationSelection(), false);
```

Use location A with `rating: 5, totalReviews: 15` and location B with `rating: 4, totalReviews: 15`; choose remaining metric values that sum to the exact assertions.

Add a zero-review case:

```ts
const zeroReviewBusiness = {
  ...multiLocationBusiness,
  locationReports: [
    { ...locationA, rating: 0, totalReviews: 0 },
    { ...locationB, rating: 0, totalReviews: 0 },
  ],
};
assert.equal(combinedReportMetrics(zeroReviewBusiness).rating, 0);
assert.equal(combinedReportMetrics(zeroReviewBusiness).totalReviews, 0);
```

- [ ] **Step 2: Run RED**

Run `node --import tsx --test tests/reports-domain.test.ts`.

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `reports-domain.js`.

- [ ] **Step 3: Implement `reports-domain.ts`**

```ts
import type { BusinessAccount, LocationReportSummary, TenantMetrics } from "../../platform/domain";

export interface ReportProjection {
  locationReports: readonly LocationReportSummary[];
  isCombinedReport: boolean;
  reportBusiness: BusinessAccount;
  metrics: TenantMetrics;
}

export function canCombineReportLocations(business: BusinessAccount): boolean {
  return (business.locationReports?.length ?? 0) > 1;
}

export function combinedScopeAfterLocationSelection(): false {
  return false;
}

export function combinedReportMetrics(business: BusinessAccount): TenantMetrics {
  const locations = business.locationReports ?? [];
  const totalReviews = locations.reduce((sum, location) => sum + location.totalReviews, 0);
  const rating = totalReviews === 0
    ? 0
    : locations.reduce((sum, location) => sum + (location.rating * location.totalReviews), 0) / totalReviews;
  return {
    ...business.metrics,
    completedJobs: locations.reduce((sum, location) => sum + location.completedJobs, 0),
    delivered: locations.reduce((sum, location) => sum + location.delivered, 0),
    uniqueClicks: locations.reduce((sum, location) => sum + location.uniqueClicks, 0),
    reviewsDetected: locations.reduce((sum, location) => sum + location.reviewsDetected, 0),
    rating,
    totalReviews,
  };
}

export function buildReportProjection(
  business: BusinessAccount,
  selectedBusiness: BusinessAccount,
  combined: boolean,
): ReportProjection {
  const locationReports = business.locationReports ?? [];
  const isCombinedReport = combined && locationReports.length > 1;
  const reportBusiness = isCombinedReport
    ? { ...business, metrics: combinedReportMetrics(business) }
    : selectedBusiness;
  return { locationReports, isCombinedReport, reportBusiness, metrics: reportBusiness.metrics };
}
```

- [ ] **Step 4: Run GREEN and typecheck**

```powershell
node --import tsx --test tests/reports-domain.test.ts
npm.cmd run typecheck
git diff --check
```

Expected: domain tests and both checks pass.

- [ ] **Step 5: Commit Task 1**

```powershell
git add src/features/reports/reports-domain.ts tests/reports-domain.test.ts
git diff --cached --check
git commit -m "feat: project scoped report metrics"
```

Expected: exactly the two named files are committed.

## Task 2: Extract and harden the printable Reports feature

**Files:**

- Replace: `src/features/reports/ReportsView.tsx`
- Modify: `src/App.tsx`
- Create: `tests/reports-view.test.ts`
- Modify: `tests/google-profile-policy.test.ts`

**Interfaces:**

- Consumes Task 1's four domain exports.
- `ReportsViewProps` contains `business`, `selectedBusiness`, `demoMode`, `BrandComponent`, `ButtonComponent`, `DemoNoticeComponent`, `StarsComponent`, and optional `onPrint`.
- `onPrint` defaults to `() => window.print()` in browser execution; tests inject a no-op.
- App passes only scoped business records, display mode, and shared presentation dependencies. It passes no review array or provider/readiness data.

- [ ] **Step 1: Write failing rendered tests**

Create `tests/reports-view.test.ts`. Import React, `renderToStaticMarkup`, `ReportsView`, and the same business fixtures/helpers as Task 1 or a small local fixture factory. Provide stub components:

```tsx
const BrandStub = () => createElement("span", null, "Review Anchor");
const DemoNoticeStub = () => createElement("aside", null, "Sample data");
const StarsStub = ({ rating }: { rating: number }) => createElement("output", { "data-rating": rating }, String(rating));
const ButtonStub = ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => createElement("button", { type: "button", onClick }, children);
```

Render selected scope with `onPrint: () => {}` and assert:

- operational snapshot/monthly report identity;
- Completed jobs, Requests delivered, Unique link clicks, reviews cached/detected, Google rating, Operational checks, and Print report;
- `Review detection is not exact job-level attribution`;
- Publishing outcomes and MobileWAN usage each contain visible `Unavailable`;
- publishing copy mentions reconciled destination receipts and controlled pilot;
- MobileWAN copy mentions managed GPU, legal, moderation, private Storage, credit ledger, and approved pricing;
- no numeric value appears inside either unavailable section;
- no `review.body` fixture marker, prompt marker, signed URL, provider receipt, customer destination, OAuth state, or audit reason appears.

Add a source-composition test in `tests/google-profile-policy.test.ts` that reads the future extracted `ReportsView.tsx` and asserts no `review.body`. Replace its old App substring assertion with the extracted file assertion while retaining the attribution disclaimer assertion.

Add an App composition assertion that the reports route renders a self-closing `ReportsView` with `business={business}` and `selectedBusiness={contextBusiness}`, and does not pass `reviews`, provider readiness, OAuth, prompts, receipts, or children.

- [ ] **Step 2: Run RED**

Run:

```powershell
node --import tsx --test tests/reports-view.test.ts tests/google-profile-policy.test.ts
```

Expected: FAIL because the feature still accepts only `children` and the report remains inline in `App.tsx`.

- [ ] **Step 3: Replace the Reports feature**

In `src/features/reports/ReportsView.tsx`:

1. Import React hooks/types, `AlertTriangle`, `CheckCircle2`, and `Printer` from `lucide-react`.
2. Import `BusinessAccount` and the Task 1 functions.
3. Define component dependency prop types compatible with the existing `Brand`, `Button`, `DemoNotice`, and `Stars` functions.
4. Move the entire existing report JSX and operational-copy branches from the inline `App.tsx` `ReportsView` into the feature.
5. Replace inline combined calculations with `buildReportProjection`.
6. Initialize `combined` to `false`; on `selectedBusiness.locationId` change call `setCombined(combinedScopeAfterLocationSelection())`.
7. Show the scope toggle only when `canCombineReportLocations(business)`.
8. Use `onPrint ?? (() => window.print())` for the existing Print report control.

Use this exact public signature:

```ts
export interface ReportsViewProps {
  business: BusinessAccount;
  selectedBusiness: BusinessAccount;
  demoMode: boolean;
  BrandComponent: ComponentType<{ compact?: boolean }>;
  ButtonComponent: ComponentType<{
    children: ReactNode;
    variant?: "primary" | "secondary" | "quiet" | "danger";
    onClick?: () => void;
  }>;
  DemoNoticeComponent: ComponentType;
  StarsComponent: ComponentType<{ rating: number; size?: number }>;
  onPrint?: () => void;
}
```

After Operational checks and before the report footer, add static sections with unique classes:

```tsx
<section className="report-unavailable-outcome" aria-labelledby="publishing-outcomes-title">
  <div><h2 id="publishing-outcomes-title">Publishing outcomes</h2><span>Unavailable</span></div>
  <p>Only independently reconciled destination receipts will appear after a destination passes approval, enumeration, retry and reconciliation, and a controlled pilot.</p>
</section>
<section className="report-unavailable-outcome" aria-labelledby="mobilewan-usage-title">
  <div><h2 id="mobilewan-usage-title">MobileWAN usage</h2><span>Unavailable</span></div>
  <p>Usage requires a managed GPU benchmark, legal and moderation clearance, private Storage, a commercial account and credit ledger, and approved pricing.</p>
</section>
```

The sections must contain no values, counters, charts, or success styling. Reuse existing panel/report CSS classes where possible; add no CSS unless a test or concrete static inspection shows a regression.

- [ ] **Step 4: Update App composition**

In `src/App.tsx`:

- Change the import from `ReportsView as ProductReportsView` to `ReportsView`.
- Delete the inline `function ReportsView` completely.
- Replace the reports route with:

```tsx
<ReportsView
  business={business}
  selectedBusiness={contextBusiness}
  demoMode={IS_DEMO_MODE}
  BrandComponent={Brand}
  ButtonComponent={Button}
  DemoNoticeComponent={DemoNotice}
  StarsComponent={Stars}
/>
```

Do not pass `reviews`, requests, service status, provider state, OAuth state, or children.

- [ ] **Step 5: Run focused GREEN**

```powershell
node --import tsx --test tests/reports-domain.test.ts tests/reports-view.test.ts tests/google-profile-policy.test.ts tests/workspace-routing.test.ts
```

Expected: all focused projection, rendered, review-boundary, and routing tests pass.

- [ ] **Step 6: Run complete local gates**

```powershell
npm.cmd run check
npm.cmd run build:demo
git diff --check
git status --short
```

Expected: secret scan, typecheck, full tests, production build, demo build, and diff hygiene pass. Status contains only the four Task 2 files.

- [ ] **Step 7: Independently review and fix findings**

Review against `docs/superpowers/specs/2026-07-22-read-only-reports-consolidation-design.md`. Reject any lost report behavior, changed metrics, fallback tenant selection, review-body leakage, fabricated publishing/video values, new mutation control, backend/provider work, circular import, accessibility regression, or unrelated refactor. Fix every critical or important finding and repeat Step 6.

- [ ] **Step 8: Commit Task 2**

```powershell
git add src/features/reports/ReportsView.tsx src/App.tsx tests/reports-view.test.ts tests/google-profile-policy.test.ts
git diff --cached --check
git commit -m "refactor: consolidate read-only reports"
```

Expected: exactly the four named files are committed.

## Final handoff

- Record both implementation commits and independent review results in `.superpowers/sdd/review-anchor-simplified-progress.md` without staging the ignored ledger.
- Run fresh verification on final HEAD before pushing.
- Report that responsive/print behavior was validated structurally unless a live browser pass actually occurs.
- Do not claim provider, Storage, Stripe, database, GPU, migration, publishing, or MobileWAN readiness.
