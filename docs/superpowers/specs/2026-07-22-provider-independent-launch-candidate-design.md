# Provider-Independent Launch Candidate Design

**Date:** 22 July 2026
**Status:** Approved
**Branch:** `codex/provider-independent-launch`

## Objective

Finish Review Anchor as a coherent provider-independent launch candidate. Every local product, security, data, CI, accessibility, documentation, and deployment-readiness journey that does not require an external approval or credential must work end to end. Externally gated capabilities remain visibly unavailable and fail closed; the product must never simulate provider approval, media storage, publication, video generation, or billing entitlement.

This design extends the simplified Google-first product direction. Google reviews stay inside Google Profile. Content remains the single manual content workspace. MobileWAN remains the only planned production video provider and must run on a managed NVIDIA worker after its evidence gates pass.

## Delivery approach

Implementation uses launch-critical vertical slices on a branch created from merged `master`. Each slice follows test-driven development, receives independent spec and quality review, passes its relevant PostgreSQL and browser gates, and lands through a focused pull request or a clearly bounded commit series.

The work is ordered as follows:

1. Security, migration, and CI guardrails.
2. Static demo and live Google-first UI coherence.
3. Signup email readiness and recovery.
4. Provider-independent onboarding activation and QR creation.
5. Neutral messaging policy and template setup.
6. Text-only content drafts, immutable revisions, and approval.
7. Audited team invitation lifecycle.
8. Whole-product accessibility, browser, documentation, and release validation.

Backend-first development was rejected because visible core journeys would remain broken for too long. UX-first development was rejected because it would leave support-session and migration hazards underneath a polished surface.

## Global constraints

- Migration 012 remains reserved for explicit agency-access enforcement and paused until the target ledger and zero-row agency-grant coverage evidence pass.
- Migrations 013 through 018 remain reserved for the externally gated Google-write, media, publication, commercial-account, video-credit, and retention roadmap already documented in the simplified-product plan.
- New provider-independent database work uses later forward-only migration numbers and cannot make migration 012 deployable.
- No live database mutation is part of this programme. Ephemeral PostgreSQL in CI is the database execution target until the user supplies target access and migration-owner authority.
- No Google profile write, review reply, post, image, video, user-triggered sync, or disconnect is allowed through a support session.
- No social adapter is enabled without its own approval, scope, destination enumeration, retry/reconciliation, and controlled pilot evidence.
- No private-media control is exposed until private Storage, path isolation, validation, moderation, and deletion are proven.
- No fake, temporary, fallback, or selectable video provider is permitted. MobileWAN remains disabled until GPU, immutable model, legal, moderation, cost, Storage, and pricing gates pass.
- No paid-video Stripe Price or entitlement is created before measured p95 cost and owner-approved pricing exist.
- Review bodies never enter reports, content sources, prompts, or permanent analytics and expire within the documented maximum retention window.
- The static Cloudflare Pages demo remains secret-free and never calls a protected runtime.

## Slice 1: security, migration, and CI guardrails

### Support-session identity

Support-session creation requires a genuine agency-customer identity at both HTTP and PostgreSQL layers. A `direct_container` agency created for a direct business does not qualify, even if its owner session carries an agency ID and owner agency role. Owner and admin agency users may request view or configuration sessions when existing MFA and step-up rules permit; support-role users may request view sessions only.

### Google account mutations

Google OAuth start, profile selection completion, user-triggered synchronization, and disconnect remain management-authorised and explicitly reject any active support session. Read-only Google Profile projections remain available according to the support-session scope and return `cache-control: no-store`.

### Migration policy

The migrator gains an executable release policy rather than relying on prose. By default it may apply only reviewed migrations through 011. Encountering migration 012 or any later migration fails closed unless the deployment supplies an explicit, narrowly scoped approval for the exact migration set. Migration 012 additionally requires:

- confirmation of migration 011 in the target ledger with its expected checksum;
- the agency-grant coverage query to return zero rows;
- retained evidence of that result;
- an explicit one-shot approval tied to the target and migration checksum.

The documented coverage query joins `public.agencies` and considers only `customer_kind='agency'`; direct-container businesses are excluded.

Ephemeral PostgreSQL CI exercises first application, idempotent second application, checksum drift rejection, guarded-012 refusal, and interrupted ledger state. Real two-connection tests prove request context cannot leak across pooled reuse, commit, rollback, or concurrent tenants.

### CI supply chain

Both security workflows use the current Node 24 GitHub Action releases, pinned to reviewed full commit SHAs with version comments. The application runtime remains Node 22. The PostgreSQL 16 service image is pinned to a reviewed patch/digest with a documented upgrade cadence. Redundant workflow filters are removed. Tests prevent regression to deprecated action runtimes or mutable database images.

## Slice 2: demo and live Google-first coherence

`GoogleProfileView` receives an explicit snapshot source instead of unconditionally fetching the API. Production uses the scoped no-store API loader. Explicit demo mode builds a location-scoped, clearly labelled snapshot from seeded reviews, requests, QR data, and workflow state without issuing a network request. Every demo write capability remains unavailable.

Successful completed-job creation invalidates the selected Google Profile snapshot. When the user is already on Requests & QR, the new request appears without a reload or location switch. Production refetches the scoped endpoint; demo mode regenerates the seeded/local projection.

Service-status failures are distinct from an unconfigured service. Google Profile displays “Status unavailable,” preserves the last safe fail-closed state, and provides a retry wired to the existing bounded service-status refresh. It never reports missing credentials when the status request itself failed.

## Slice 3: signup email readiness and recovery

Signup availability is a server-owned capability. When transactional email is not configured, production signup refuses to create a verification intent and returns an honest unavailable state. Provider rejection records a delivery failure and never claims that mail was sent.

Verification intents carry delivery state and bounded resend metadata. A same-origin, rate-limited resend command rotates or reuses tokens according to the existing single-use rules, prevents account enumeration, and records safe audit evidence. The UI offers resend only when the server reports it is allowed. Demo mode may explain the journey but does not imitate email delivery.

## Slice 4: onboarding activation and QR

New business and location records remain in onboarding until an explicit idempotent completion command validates all provider-independent requirements. Activation does not require a Google write and cannot infer readiness from a browser redirect. The command verifies the current owner/admin, exact business/location pair, required business fields, location timezone, and any locally required policy state. Provider-dependent delivery remains separately disabled.

The existing `ensure_client_qr_code` database primitive is exposed through an owner/admin repository method and same-origin route. It requires an exact selected location and a verified active Google review destination. Repeated calls return the same stable public token. The Requests & QR tab presents a Generate QR action only when those conditions hold and refreshes the scoped snapshot after success.

## Slice 5: neutral messaging policy and template setup

Owners and business admins can configure a location-scoped SMS/email policy and create an immutable neutral message-template revision. The server validates business identity, review-link placeholder, opt-out language where required, maximum touch count, quiet hours, timezone, and provider-independent compliance fields. Updating a template creates a new revision; it never edits an approved version in place.

Policy/template readiness does not imply provider delivery readiness. Requests remain blocked until consent, verified Google destination, suppression, deployment provider status, and final dispatch checks all pass. The UI states which prerequisite is missing and never routes policy absence to an unrelated Connections explanation.

## Slice 6: text-only content and approval

Content supports provider-independent text drafts sourced only from service, offer, or “Campaign or post idea.” Drafts are tenant/location scoped and stored as immutable revisions grouped under one logical content key. Google reviews and review-derived text are rejected as sources at API and database boundaries.

Authorised users may create, edit by creating a revision, submit, approve, or reject according to direct-business roles and accepted agency-grant permissions. Approval binds the exact immutable revision and records an audit event. Any new revision invalidates prior approval. The workspace shows revision history and approval state.

Media upload, scheduling, publication targets, and MobileWAN controls remain unavailable. This slice does not introduce placeholder assets, provider adapters, fake receipts, or credits.

## Slice 7: team invitations

Business and agency owners/admins receive an audited invitation lifecycle: issue, resend, expire, revoke, inspect, and accept. Invitations use opaque single-use claims, bounded expiry, normalised email matching, least-privilege roles, and exact agency or business scope. Acceptance is idempotent and cannot broaden an existing membership. Billing-only roles cannot enumerate team members unless their tenant capability permits it.

## User journeys

### Public demo

Visitors can navigate Home, Google Profile, sample reviews, Requests & QR, Content readiness, Reports, and Settings without backend errors. Every seeded state is labelled as sample data, and every provider mutation remains unavailable.

### Direct business

A user can register only while verification delivery is available, resend safely, verify, create a business/location, complete local setup, reach an active workspace, connect a real Google location when approved credentials exist, create a stable QR, configure neutral request policy/template state, and add completed jobs. A newly added job appears immediately. Delivery still fails closed until every provider and consent gate passes.

### Agency

A real agency user can invite staff, request explicit client/location permissions, and enter appropriately scoped support sessions. A client owner/admin accepts or revokes access. Revocation takes effect on the next read, mutation, approval, or spend check. Direct-business owners cannot use agency support mode.

### Content

Direct and explicitly granted agency users can prepare and approve text-only content revisions. The UI honestly explains why uploads, publishing, scheduling, and video generation are unavailable.

## Error handling

- Unavailable infrastructure never returns a success-shaped response.
- Authorization ambiguity and foreign tenant/location identifiers return deterministic 403 responses.
- Retryable operations use bounded, idempotent commands and visible retry states.
- Redirects and query parameters never grant authority or mark onboarding, billing, email, Google, or approval work complete.
- Missing repository capabilities return explicit 503 responses without leaking configuration values.
- Browser closure or refresh does not create duplicate commands.
- Logs and analytics contain identifiers, state classes, and counts only; never review bodies, prompts, tokens, signed URLs, provider receipts, email claim tokens, or credentials.

## Testing and evidence

Every implementation task begins with a failing focused test and ends with:

- focused unit/integration tests;
- TypeScript application and server checks;
- the complete Node test suite;
- relevant Cloudflare tests and type checks;
- production and demo builds;
- secret scanning, a zero-vulnerability production dependency audit, and explicit triage of development-only advisories;
- `git diff --check`;
- ephemeral PostgreSQL migration and isolation tests for database work;
- browser verification at desktop and mobile sizes for changed journeys;
- independent task-level spec and quality review.

The final branch additionally receives a whole-branch security/code review. GitHub Application Security and Database Security must pass after push. Documentation records exactly which local, CI, staging, provider, and pilot claims were proven.

## Completion boundary

The provider-independent launch candidate is complete when every journey above works under the listed tests and no independent review has an open critical or important finding.

It is not production-ready until the user separately supplies and approves:

- target Supabase migration access, target ledger evidence, and migration-owner authority;
- transactional email staging credentials and delivery evidence;
- Google, social, private Storage, moderation, MobileWAN, and Stripe resources;
- controlled direct-business and agency pilot evidence.

Those missing external resources are deployment gates, not permission to add substitutes or weaken the product’s claims.
