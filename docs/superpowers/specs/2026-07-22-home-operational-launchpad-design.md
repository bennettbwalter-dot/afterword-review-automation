# Home Operational Launchpad Design

**Date:** 2026-07-22

**Status:** Design direction approved; written-spec review pending

## Purpose

Turn Home into a provider-independent, location-scoped operational launchpad. Home should help an authorised user understand request workflow activity and reach the simplified product modules without rendering Google review records outside Google Profile.

This slice removes obsolete Growth Suite ownership from the business Home path. It does not introduce provider writes, publishing, uploads, billing changes, database records, or external integrations.

## Product contract

- Google review records live only inside Google Profile. Home must not receive or render review bodies, reviewer names, per-review ratings, review dates, or reply state.
- Home may show aggregate operational workflow data already present on the scoped business/location projection.
- Preserve the selected business and location context across every Home navigation action.
- Preserve the existing completed-job action and its current configuration permission.
- Preserve business-role routing: inaccessible modules remain absent and billing-only users continue to enter Billing rather than Home.
- Add a direct Content launch path so the simplified manual-first content area is discoverable from Home.
- Do not imply that any unavailable Google or social publication capability is active.

## Approaches considered

### Recommended: make `HomeView` the feature owner

Move the business dashboard, module definitions, and location-scoped operational summaries into `src/features/home/HomeView.tsx`. Remove the `reviews` input, delete the obsolete `src/growth/GrowthSuite.tsx`, and let `App.tsx` compose Home from existing scoped inputs.

This creates one clear owner for Home, removes the dead agency dashboard branch from the business route, and makes the review-data boundary enforceable through the component interface.

### Rejected: minimally patch `GrowthSuite`

Removing the review panel in place would reduce the immediate diff but preserve obsolete product naming, a wrapper-only `HomeView`, a dead agency branch, and unnecessary review-record wiring. It would leave the feature boundary harder to understand and regress.

### Rejected: navigation-only Home

A card-only page would be safe but less useful. Location-scoped completed-job, delivery, click, and automation aggregates provide operational value without duplicating review content.

## Architecture

`HomeView.tsx` becomes a complete business Home feature. It owns:

- the immutable Home module definitions;
- role-filtered module visibility using the existing routing policy;
- selected-location projection from `BusinessAccount.locationReports` with the current business metrics fallback;
- operational aggregate cards;
- the location selector and existing permission disclosure;
- navigation callbacks supplied by `App.tsx`.

`App.tsx` remains the composition root. It supplies the scoped business, request records, session, permission booleans, selected location, navigation callback, and completed-job callback. It must not pass `reviews`, provider credentials, publication readiness, OAuth data, or destination identity to Home.

The feature continues using existing Home/Growth CSS classes where practical. This slice changes ownership and content boundaries, not the overall visual language. CSS changes are allowed only when required for the consolidated card set or responsive wrapping.

## Home interface

`HomeView` receives:

- `business: BusinessAccount`
- `requests: RequestRecord[]`
- `session: SessionContext`
- `canConfigure: boolean`
- `canManageBilling: boolean`
- `selectedLocationId?: string`
- `onSelectLocation(locationId: string): void`
- `onNavigate(view: AppView, context?: WorkspaceRouteContext): void`
- `onAddJob(): void`

It does not receive `ReviewRecord[]`, all businesses, an agency-mode flag, service provider state, or publication capability data.

## Location and aggregate behavior

Build the available location list from `business.locationReports` when present. Otherwise use one fallback location derived from the scoped business and its aggregate metrics.

Resolve the active location from `selectedLocationId`; if it is absent or invalid, use the first available scoped location. Home must not reuse a location from a different business.

Render these four aggregate cards for the active location:

| Metric | Source | Supporting text |
| --- | --- | --- |
| Completed jobs | `activeLocation.completedJobs` | Selected location workflow volume |
| Requests delivered | `activeLocation.delivered` | Neutral request delivery count |
| Unique link clicks | `activeLocation.uniqueClicks` | Aggregate request-link activity |
| Automation | `business.automationState` | Existing scoped `business.lastSuccess` text |

Do not render Google rating, total review records, reviews detected, or any value derived from `ReviewRecord[]` on Home.

The selected-location request count may remain in the module-section summary because it is computed from already-scoped request records and contains no customer identity or destination.

## Module navigation

Home exposes these exact module cards:

| Card | Destination |
| --- | --- |
| Google Profile | `/app/google-profile` |
| Reviews | `/app/google-profile/reviews` |
| Requests & QR | `/app/google-profile/requests-qr` |
| Content | `/app/content` |
| Reports | `/app/reports` |
| Connections | `/app/settings-billing/connections` |
| Billing | `/app/settings-billing/billing` |

Use the existing `isAppViewAllowed` policy to filter cards for the signed-in role. Do not add provider-specific buttons or bypass route authorization.

The primary hero action opens Google Profile. The existing Add completed job action remains visible only when `canConfigure` is true; otherwise Home shows the current read-only disclosure.

## Removed behavior

Delete the Home recent-review panel and its empty-review state. Google connection guidance already exists in Google Profile and Settings Connections, so Home must not create a second review or connection status surface.

Delete the unused agency Growth dashboard branch from `GrowthSuite.tsx`. Agency users continue using the existing Agency feature and protected support-session flow; this slice does not redesign Agency.

Remove the `GrowthSuite` import and composition from `App.tsx`, then delete `src/growth/GrowthSuite.tsx` when no references remain.

## State, authorization, and error behavior

- Invalid or missing selected-location input falls back only to the first location belonging to the already-scoped business.
- An empty request list renders aggregate zero/count copy without fabricating provider failures.
- Read-only users retain navigation but cannot use Add completed job or configuration actions.
- Billing-only users do not render Home under the existing route policy.
- Home introduces no new loading, network, or error state because it consumes existing scoped workspace data.
- No operational aggregate is described as proof of Google/social publishing capability.

## Accessibility and responsive behavior

- Keep semantic section headings and an explicit accessible label for the operational aggregate group.
- Keep a labelled native location selector.
- Buttons retain visible action text and existing focus behavior.
- Aggregate and module grids wrap without horizontal overflow at narrow widths.
- Permission disclosures remain visible text with status semantics; colour is not the only signal.

## Testing

Add executed domain/source and server-rendered tests that verify:

- the seven exact Home modules and their scoped destinations;
- Content routes directly to the Create tab;
- duplicate request/workflow/QR cards are consolidated into one Requests & QR card;
- the four exact operational aggregates render from the selected location;
- an invalid location ID falls back to the first scoped location;
- the selected-location request count remains scoped;
- the completed-job action follows configuration permission;
- read-only disclosure remains visible;
- no review body, reviewer name, per-review rating, reply state, review date, Google rating, total-review count, or reviews-detected metric renders;
- `HomeView` has no `ReviewRecord`, `reviews`, provider credential, OAuth, destination identity, or publication-readiness input;
- `App.tsx` passes only the approved scoped Home inputs and no longer imports or renders `GrowthSuite`;
- `src/growth/GrowthSuite.tsx` is removed;
- billing-only routing continues to bypass Home.

Run focused Home/routing/security tests, secret scan, typecheck, the full test suite, production build, demo build, and diff hygiene. Complete independent task and whole-slice review before pushing.

## Explicit exclusions

- No review replies, Google profile writes, or Google publishing.
- No social connection, destination enumeration, publishing, retry, receipt, or reconciliation work.
- No media upload, Storage, content editing, scheduling, or generation implementation.
- No Stripe, plan, credit, moderation, GPU, or MobileWAN changes.
- No database, migration, API, repository, worker, or provider-call changes.
- No Agency redesign.
- No claim of live browser, provider, or production readiness.

## Completion criteria

The slice is complete when Home is owned by the Home feature, exposes the seven simplified destinations, shows only scoped operational aggregates, cannot receive or render Google review records, preserves location and permission behavior, removes the obsolete Growth Suite business path, passes all local gates, and has no open critical or important review findings.
