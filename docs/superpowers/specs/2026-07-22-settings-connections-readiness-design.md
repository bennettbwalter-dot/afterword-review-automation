# Settings Connections Readiness Design

**Date:** 2026-07-22

**Status:** Approved for implementation planning

## Purpose

Move the existing operational connections UI out of `App.tsx` into the Settings feature and add an honest, read-only publication capability ledger. Operational connection health and publication approval are separate concepts and must never be presented as interchangeable.

This is provider-independent UI consolidation. It does not add a social OAuth flow, destination enumeration, publishing adapter, database record, credential, or provider mutation.

## Product contract

- Preserve the existing Connections tab and its business/location workspace scope.
- Preserve Google Business Profile review-sync/setup behavior, messaging-provider status, completed-job intake status, protected service availability, and the integration event log.
- Preserve current authorization: billing-only users cannot see Connections; support/configuration and business-role rules continue to govern the existing Google setup action.
- A healthy or connected operational integration does not imply publication capability.
- Add a separate publication-readiness ledger for Google posts and media, Facebook Page, Instagram professional account, LinkedIn organisation, and YouTube channel.
- Every publication destination is unavailable by default and has its own explicit prerequisites.
- Do not display social connection buttons, publish/schedule controls, destination selectors, account names, page/channel IDs, OAuth state, tokens, secrets, or fabricated provider health.

## Architecture

Create a small typed `connection-readiness.ts` module inside `src/features/settings`. It contains immutable, fail-closed publication capability records only. The module does not read Markdown evidence documents, environment variables, runtime service status, OAuth state, or demo data.

Create `ConnectionsView.tsx` in the same feature. Move the current inline `IntegrationsView` behavior and JSX into it. `App.tsx` remains the composition root and supplies the scoped business, existing service-status projection, demo flag, authorization result, and existing Google setup callback.

Shared `Button`, `StatusPill`, and `DemoNotice` presentation dependencies may be passed explicitly as component props to avoid importing from `App.tsx`. Icons may be imported directly from `lucide-react`. The feature must not import `App.tsx` or duplicate shared primitives.

No API, server route, repository query, provider call, or persistence is introduced.

## Operational connections section

Preserve the existing three operational records:

- **Google Business Profile:** review sync and direct review destination.
- **Messaging provider:** SMS and email delivery events.
- **Completed-job intake:** genuine completed-customer-job events.

Preserve their existing workspace-derived status, tone, last event, configured-service checks, demo disclosure, and event-log behavior.

The existing Google setup action remains the only connection-related action in this slice. It is available only under the current conditions: authenticated non-demo runtime, Google service configured, not loading, actor permitted to configure, and no support-session restriction already applied by the caller. It remains review/profile setup, not proof of publishing capability.

## Publication readiness ledger

Render these entries separately from operational connection cards:

| Capability | State | Required evidence |
| --- | --- | --- |
| Google posts and media | Unavailable | Approved write scopes, exact location capability, destination reconciliation, and controlled pilot |
| Facebook Page | Unavailable | Meta app approval, required Page scopes, exact Page enumeration, reconciliation, and controlled pilot |
| Instagram professional account | Unavailable | Meta app approval, professional-account linkage/enumeration, required scopes, reconciliation, and controlled pilot |
| LinkedIn organisation | Unavailable | LinkedIn app approval, authorised organisation/Page role, organisation enumeration, reconciliation, and controlled pilot |
| YouTube channel | Unavailable | Approved API project, required scopes, exact channel enumeration, upload reconciliation, and controlled pilot |

The ledger contains static explanatory content only. It has no buttons, links, selectors, menus, status polling, success state, or implicit activation path.

## State and error behavior

- Continue using the supplied workspace `BusinessAccount` integration states for the three operational records.
- Continue using the supplied protected `ServiceStatus[]` projection for deployment configuration evidence.
- Loading or missing Google service configuration keeps the existing setup action unavailable.
- The publication ledger remains unavailable regardless of operational Google connection health or demo data.
- A missing social provider record does not collapse or hide its ledger entry.
- No new loading or error state is needed for static publication readiness.

## Accessibility and responsive behavior

- Retain semantic headings and the existing Connections-tab `aria-current` behavior.
- Every unavailable publication entry uses visible text; colour is not the only state signal.
- Static unavailable items are not represented by disabled buttons.
- Preserve existing card/event-log responsive behavior.
- The publication ledger uses wrapping grid/list layout with no horizontal overflow at narrow widths.

## Testing

Add executed domain and server-rendered tests that verify:

- the five exact publication capabilities exist and are all unavailable;
- every entry contains non-empty, platform-specific prerequisites;
- operational Google, messaging, and completed-job status/last-event content is preserved;
- service availability and integration-log summaries are preserved;
- the Google setup action follows configured/loading/authorization/demo rules;
- publication readiness stays unavailable even when Google operational health is successful;
- no Meta, LinkedIn, or YouTube connect/publish/schedule/destination-selection control renders;
- no OAuth state, token, secret, destination identity, Page/channel ID, or fabricated provider health is present;
- billing-only Settings rendering still omits Connections;
- `App.tsx` passes only scoped existing inputs and the Google setup callback; no social callback, credentials, or provider readiness is injected.

Run focused Settings/routing/security tests, secret scan, typecheck, the full test suite, production build, demo build, and diff hygiene. Perform independent task and whole-slice review before pushing.

## Explicit exclusions

- No Meta, LinkedIn, or YouTube OAuth or developer-app configuration.
- No destination enumeration or saved social destination.
- No Google/social publishing capability activation.
- No publication adapter, job, schedule, retry, receipt, or reconciliation implementation.
- No database, migration, Storage, Stripe, moderation, GPU, or MobileWAN work.
- No redesign of Billing or broader Settings areas.
- No live browser, provider, or production-readiness claim.

## Completion criteria

The slice is complete when existing operational connection behavior lives inside the Settings feature, publication readiness is visibly and independently fail-closed for all five destinations, billing-only access remains unchanged, App is only the scoped composition root, all local gates pass, and independent review has no open critical or important findings.
