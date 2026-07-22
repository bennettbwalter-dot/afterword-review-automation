# Read-only Reports Consolidation Design

**Date:** 2026-07-22

**Status:** Approved for implementation planning

## Purpose

Move the existing location-scoped printable report out of `App.tsx` into the Reports feature and extend it with honest readiness states for publishing outcomes and MobileWAN usage. Preserve the current proven report behavior while keeping future outcome areas unavailable until authoritative records exist.

This is provider-independent, read-only UI and calculation work. It is not Task 14's dashboard, notification, email-report, content-outcome, agency-portfolio, or worker implementation.

## Product contract

- Preserve the current selected-location report.
- Preserve the optional all-locations report when more than one location summary exists.
- Preserve print behavior, report identity, request metrics, Google rating snapshot, operational checks, location table, and the review-attribution disclaimer.
- Keep the report under the business and location selected by the canonical workspace route.
- Show publishing outcomes as unavailable until reconciled publication records exist.
- Show MobileWAN usage as unavailable until the commercial account and append-only credit ledger exist.
- Unavailable future outcomes are not displayed as zero because zero would imply a real authoritative query.
- Never render review bodies, prompts, signed URLs, provider receipts, customer destinations, OAuth state, or internal audit reasons.
- Do not add controls for content creation, upload, approval, publication, generation, billing, or provider connection.

## Architecture

Create a focused Reports domain module for pure report projection. It receives the already-scoped `business` and `selectedBusiness` workspace records and calculates either the selected-location metrics or a combined projection. Weighted Google rating uses total review counts; no-review combined data returns a zero rating without division by zero.

Move the current report component into `src/features/reports/ReportsView.tsx`. `App.tsx` remains the composition root and passes only `business` and `selectedBusiness`. The existing URL and `WorkspaceContextBar` continue to own tenant and location selection; Reports does not select a fallback tenant.

The feature uses only existing workspace data. It does not call an API, read evidence Markdown, infer provider readiness, or invent publishing/video records.

## Report sections

### Existing sections to preserve

- Report toolbar with current report date or demo month.
- Selected location and all-locations scope toggle when applicable.
- Print report action.
- Business/location report identity and live-versus-demo disclosure.
- Operational summary and health state.
- Completed jobs, delivered requests, unique link clicks, and detected/cached review count.
- Current Google rating and total-review snapshot.
- Explicit statement that review detection is not exact job-level attribution.
- Combined location table with jobs, delivery, clicks, detected reviews, rating, and SMS segments.
- Existing integration/operational checks.
- Existing authenticated-versus-sample footer.

### New readiness sections

- **Publishing outcomes:** Unavailable. Explain that only independently reconciled destination receipts will appear after a destination passes its approval, enumeration, retry/reconciliation, and controlled-pilot gate.
- **MobileWAN usage:** Unavailable. Explain that usage requires the managed-GPU benchmark, legal and moderation clearance, private Storage, commercial-account projection, credit ledger, and approved pricing.

These sections contain no counts, charts, success state, usage balance, or activity rows.

## Component boundaries

- `reports-domain.ts` owns pure combined-metric and scope projection functions.
- `ReportsView.tsx` owns report state, print behavior, and semantic rendering.
- `App.tsx` removes its inline `ReportsView` implementation and renders the feature component directly.
- Existing shared `Brand`, `Button`, `DemoNotice`, `Stars`, and icon dependencies may remain injected as explicit component props if moving them would create circular imports. The Reports feature must not import from `App.tsx`.
- Prefer small explicit dependency props over relocating unrelated shared components during this slice.

## State and error handling

- Changing the selected location resets combined mode to selected-location mode.
- The combined option appears only when at least two location summaries exist.
- Missing `locationReports` is treated as an empty list.
- Combined metrics sum jobs, deliveries, clicks, detected reviews, and total reviews.
- Combined rating is weighted by each location's total-review count; when total reviews equal zero, rating is `0`.
- The selected-location report continues using `selectedBusiness.metrics` exactly.
- No loading or error state is added because this feature consumes the existing resolved workspace projection.

## Accessibility and responsive behavior

- Preserve the report-scope accessible name and clear selected-state styling.
- Preserve semantic table roles for the combined-location table.
- Future readiness sections use visible text status; colour is not the only signal.
- Preserve logical heading order and printable semantics.
- Existing responsive and print styles remain authoritative. Add narrowly scoped CSS only if the extracted component reveals a concrete layout regression.

## Testing

Add executed unit and server-rendered tests that verify:

- selected-location metrics remain unchanged;
- combined sums and weighted rating are correct;
- combined zero-review data produces rating `0`;
- changing selected location resets combined mode through an exported pure state decision or an executed component seam;
- combined scope is unavailable for zero or one location;
- all existing report sections and print control render;
- publishing and MobileWAN sections render `Unavailable` with prerequisites and no fabricated counts;
- review bodies, prompts, signed URLs, provider receipts, customer destinations, OAuth state, and internal audit reasons are absent;
- `App.tsx` passes only scoped report inputs and no raw review array;
- existing Google Profile review-boundary tests continue to pass after the inline component is removed.

Run the focused tests, workspace-routing and Google Profile policy regressions, secret scan, typecheck, full test suite, production build, demo build, and diff hygiene. Perform independent task and whole-slice review before pushing.

## Explicit exclusions

- No dashboard, action inbox, agency portfolio, notification, or monthly email report.
- No publishing or generation metrics API.
- No report persistence, export file, scheduled delivery, or database query.
- No content, publication, commercial-account, credit, or MobileWAN migration.
- No live provider, Storage, Stripe, database, GPU, browser, or screen-reader claim.
- No removal of current request/reputation reporting behavior.

## Completion criteria

The slice is complete when the current printable report and scope behavior live wholly inside the Reports feature, `App.tsx` is only the composition root, future publishing/video outcomes are explicitly unavailable rather than fabricated, sensitive content boundaries remain enforced, all local gates pass, and independent review has no open critical or important findings.
