# Review Anchor architecture

## Status and implementation boundary

Review Anchor has an authenticated Fastify application API, a restricted Fastify public-ingress service, a PostgreSQL persistence/security layer, a worker process and provider adapters behind the React workspace. Outside explicit `VITE_DEMO_MODE=true`, the browser loads its session and workspace from the server and does not seed tenants or select its own authoritative role.

This is code-complete foundation work, not production evidence. The PostgreSQL migrations and SQL isolation suite have not been executed in this workspace because no PostgreSQL runtime is available. No real Google Business Profile, Twilio, SendGrid or Stripe credentials have been used, and the one-business pilot has not run. Nothing in this document should be treated as evidence that a launch control has passed.

The system is one multi-tenant SaaS application. Client workspaces and the agency portfolio share one identity system and PostgreSQL database. The authenticated application, public ingress and worker are separate least-privilege processes. Navigation is derived from memberships and capabilities; there is no separate, implicitly trusted admin application.

Migrations 001 through 005 target PostgreSQL 15.9 or newer. `scripts/migrate.ts` applies them in filename order, stores SHA-256 checksums and refuses to alter an already-applied migration. `database/tests/003_tenant_isolation.sql` and `.github/workflows/database-security.yml` define executable role, RLS, dispatch and webhook-deduplication checks. They are present in code but have not been run locally; a clean database run and two-connection concurrency tests remain launch blockers.

The migrations require a dedicated database owned by `afterword_migration_owner`. The `public` schema must belong to that role or PostgreSQL 15's `pg_database_owner` role. Those ownership rules let the migration revoke public schema creation; a plain `CREATE` grant does not satisfy the bootstrap contract. The `afterword_*` database roles and other lowercase prefixes remain stable legacy implementation identifiers after the product rename.

Google Business Profile is an external launch dependency. The Google Cloud project must be approved for the Business Profile APIs and the business must have a verified profile. Google provides no Business Profile API sandbox, so real OAuth, review sync and Pub/Sub validation can only be proven in the controlled pilot.

## Client QR review flow

Migration `002_client_qr_review_flow.sql` separates the permanent public QR token from both rendered artwork and the mutable Google destination. Each active location has one active QR record. Regenerating PNG, SVG, or PDF artwork increments `artwork_revision` while preserving `public_token`, so previously printed material keeps working.

The public edge resolves `/r/:token` through the restricted ingress command surface, records a privacy-minimised scan event, and then redirects to the verified Google review URL. Raw IP addresses are not stored. Approximate unique scans use a rotating server-side keyed hash. Review attribution is explicitly labelled by method and confidence because Google review sync does not provide deterministic scan-to-review identity.

Only a business owner/admin or a configuration-scoped support session may replace a review destination or regenerate artwork. Tenant dashboards can read only their own destination, QR, scan, and conversion rows through RLS. The public edge receives only the destination required for an active, verified token.

## Runtime boundaries

```text
Browser
  -> Review Anchor API (opaque cookie and trusted request-context boundary)
       -> afterword_auth (credentials and server sessions)
       -> afterword_runtime (tenant queries and audited commands)
       -> PostgreSQL RLS + audited command functions

Provider webhooks/QR -> public ingress process -> signature/OIDC verification -> afterword_ingress -> durable deduplicated receipts
Authenticated billing action -> application API -> Stripe-hosted Checkout/Portal
Stripe event -> public ingress -> exact-body signature verification -> replay-safe billing state
Delivery/review worker -> afterword_worker -> lease/outbox/sync functions -> Google, Twilio, SendGrid
Operations -> afterword_ops -> global pause and reconciliation functions
Migration/bootstrap -> afterword_migration_owner only during controlled deployment
```

The browser never connects to PostgreSQL and never receives provider secrets. Login roles inherit exactly one matching `NOLOGIN`, `NOBYPASSRLS` group role:

- `afterword_auth` can call credential, opaque-session and OAuth-state commands only.
- `afterword_runtime` can read RLS-filtered safe columns and execute named user commands.
- `afterword_ingress` can record nonces and authenticated webhook receipts only.
- `afterword_worker` can claim, renew and finish message work only.
- `afterword_ops` can control global pauses and reconcile ambiguous provider results only.
- `afterword_migration_owner` owns schema objects and is never inherited by an application login.

Production deployment requires four distinct login identities across the system. The authenticated application receives auth/runtime URLs only, the public-ingress process receives ingress only, and the worker receives worker only; a shared production environment file would defeat this boundary. `DATABASE_URL` is a development-only fallback. The migration credential is separate and must not be present in application processes. The migration revokes direct runtime DML, schema creation and default `PUBLIC EXECUTE` on private functions, then grants only named entry points. A production DBA must still verify those catalog privileges.

`TRUST_PROXY_HOPS` defaults to zero. Set it only when the origin is reachable exclusively through that exact number of trusted reverse-proxy hops; otherwise client-IP rate limits and privacy-minimised QR hashes can be spoofed or collapsed to the proxy address.

## Request context

For each tenant API request, the server begins a transaction and binds the database context to the hashed opaque session token:

```sql
select app_private.set_request_context_from_session(
  :verified_session_token_hash,
  :support_session_id_or_null
);
```

The database resolves that hash against `app_private.auth_sessions` and derives the user, MFA and step-up evidence from the stored session. Legacy caller-supplied identity settings are blanked. The support-session ID is accepted only when it belongs to the authenticated actor and is active; tenant and scope checks are repeated by protected commands and RLS helpers. The context is transaction-local, so pooled connections do not retain it after commit or rollback.

Custom PostgreSQL settings are still not authentication for a principal with arbitrary SQL access. Database connections therefore belong only to the trusted, parameterized API and never to browser clients or user-supplied SQL. This boundary must be exercised under pooled-connection reuse before launch.

The schema supports MFA and step-up timestamps and the application fails closed when an account has `mfa_required=true`. There is not yet an MFA challenge or enrolment path that can populate verified evidence. Agency support access must remain disabled until that path is implemented and tested.

## Tenant and location model

- `business_id` is the hard tenant boundary.
- `agency_id` groups managed businesses but never substitutes for tenant isolation.
- A location is a scope within one business.
- Tenant identifiers are immutable after insert.
- Every tenant-owned operational row carries `business_id NOT NULL`.
- RLS is enabled and forced on every tenant table in the migrations; missing runtime policies default to deny.
- Composite foreign keys bind business/location, business/membership, agency/business, business/integration, business/location/ingress, business/job/outbox/attempt and audit/support-session attribution.
- Child-key indexes support those constraints and policy lookups.

Business owners and admins can access all locations. Operators and viewers require an explicit `membership_location_grants` row; no grant means no location access. Billing members receive business-summary access only. Disabled users, archived businesses and inactive memberships are rejected by the authorization helpers.

Agency users can see non-PII portfolio-level business health. Tenant-level records require the exact request-bound support session except for narrowly defined emergency pause controls.

That boundary also applies to audit reads. Agency owners and admins can read agency-scoped events directly, but a business-scoped audit row requires a business owner/admin membership or the exact active support session. A future agency-wide activity feed must be a deliberately non-PII projection rather than direct access to tenant audit rows.

## Agency support sessions

A support session is bound to one agency actor, one business, one reason and one immutable scope. The request must carry that exact session ID. Authorization rechecks all of the following on every protected query:

- The actor is enabled and still has an active agency membership.
- The session agency matches the business agency.
- The session has started, has not ended or been revoked, and has not expired.
- The most recent activity is no more than 15 minutes old.
- MFA evidence is no more than 12 hours old.
- Configuration access has configuration scope and step-up evidence no more than 15 minutes old.
- Agency `support` members are restricted to view-only sessions.

Sessions last 15 or 30 minutes. Creation is serialized per actor, so an actor cannot open two active tenant contexts. Actor, tenant, scope, authentication evidence, start and expiry are immutable. The application must show a persistent tenant-context banner and call the touch command only for genuine activity.

Ownership transfer, payment changes, tenant deletion, secret disclosure and audit mutation are not exposed as support-session commands.

## Writes and audit semantics

The runtime role has no direct `INSERT`, `UPDATE` or `DELETE` privilege. Mutations use named `SECURITY DEFINER` commands that derive the actor from request context, enforce capability rules, perform the change and append a completed audit event in one transaction. Business membership changes use a per-business transaction lock before hierarchy and last-owner checks.

Audit rows are append-only and bind agency, business, location, actor and support session with composite keys. A correlation/action/target/outcome key prevents the same logical audit event being inserted twice. Runtime reads use a safe audit view that excludes IP hashes, free-text reasons and redacted metadata.

PostgreSQL has no ordinary autonomous transaction. If a command inserts a blocked audit event and then raises an exception, both operations roll back. Expected authorization denials therefore follow this API sequence:

1. Roll back the denied command transaction.
2. Open a separate transaction.
3. Call `record_blocked_admin_action` for an agency or business the actor can legitimately identify.
4. Commit the audit event, then map the original denial to HTTP 403.

Unexpected database errors require a separate durable security log after rollback. RLS-filtered `SELECT` denials appear as empty result sets and cannot be transactionally audited by a policy alone; privileged read workflows that require denial evidence must use audited API commands.

## Sensitive columns

RLS protects rows, not columns. Runtime access to sensitive tables is column-scoped and routed through `security_invoker` views. The default runtime surface excludes:

- Authentication subjects and invitation token hashes.
- Integration secret references.
- Encrypted webhook bodies and payload hashes.
- Consent wording, evidence references, customer references and IP hashes.
- Suppression destination hashes.
- Support reasons and authentication evidence timestamps.
- Audit reasons, IP hashes, user-agent details and metadata.
- Worker lease tokens and redacted provider response metadata.
- Message deduplication keys and provider idempotency keys.

The implemented server encrypts customer destinations, rendered message content, Google OAuth tokens and provider webhook evidence before storage. Passwords use scrypt hashes; opaque session tokens are stored only as keyed hashes. `FIELD_ENCRYPTION_KEY`, `SESSION_PEPPER` and provider credentials must come from a production secret manager and must never be written to logs or tenant-visible metadata.

Encrypted provider webhook evidence is capped at 30 days by the schema and has a purge command. Google review bodies, reviewer display names and replies are Google API Content: `review_records.cache_expires_at` is capped at 30 days from the last sync, runtime queries exclude expired rows, and the worker/operations purge path must be scheduled and proven before pilot activation.

## Webhook, queue and outbox model

The server applies provider-specific verification before database ingestion: Twilio request signatures over the exact callback URL and form fields, SendGrid's signed timestamp/body, Google Pub/Sub OIDC with exact issuer, audience and service-account identity, and Stripe signatures over the unchanged raw body. Request bodies are size-limited. Provider event IDs are persisted with uniqueness so at-least-once callbacks can be deduplicated. A webhook request never sends a customer message directly.

Stripe Checkout is created only for an authenticated business owner, admin or billing member, never from public pricing input or an agency support session. The database snapshots the server-owned plan and amounts into an idempotent Checkout attempt before the Stripe API call. The application then validates the configured GBP Prices against those amounts and binds the returned Session to the attempt. Subscription metadata repeats only tenant and attempt identifiers created by the server. The ingress process holds the endpoint signing secret but no Stripe API key. Billing activation requires both an active Stripe subscription state and a signature-verified paid setup fee; browser redirects are not payment evidence. Event creation timestamps fence stale subscription updates, and an event ID replay with a different payload hash fails closed.

Message execution uses a logical job plus a durable provider outbox and attempt history:

1. Workers atomically claim eligible jobs with `FOR UPDATE SKIP LOCKED`.
2. Every lease has an unguessable token; renew and completion calls require worker ID plus the exact token.
3. Global/agency and tenant/location/channel/automation pauses are checked at claim time.
4. The pause predicate is checked again when an attempt starts, immediately before the provider call.
5. One stable local idempotency key is reused for every attempt of the logical message.
6. Accepted sends complete the job. Definite failures back off or dead-letter at the attempt limit.
7. Unknown provider results and expired leases that were already `sending` enter `reconciliation_required`; they are never blindly retried.
8. A separate operations principal resolves reconciliation after querying provider state.

Database deduplication does not create exactly-once delivery at an external provider. Twilio does not accept a provider idempotency key for message creation, so an ambiguous network outcome must remain in reconciliation and must never be blindly retried. The SendGrid adapter includes an attempt identifier in signed event metadata, but its timeout and duplicate behaviour must also be proven. A provider/credential kill switch is required because a small race remains between the last database pause check and the network call.

Google Pub/Sub notifications are scheduling hints, not the review source of truth. Notifications are verified, deduplicated and used to request a durable reconciliation. The worker then fetches the canonical review list from Google. Google review objects do not contain a Review Anchor request or customer ID, so conversion reporting is estimated rather than deterministic person-level attribution.

## Implementation status and deliberate launch limits

The code now models and persists the message decision that the earlier design draft lacked. A completed job is linked to an encrypted customer destination, immutable template version, consent record, review request, sequence and durable message job. `evaluate_message_dispatch` rechecks active consent, suppressions, Google destination, pause controls, permitted local time, per-request sequence, destination frequency, hourly rate and exact worker lease before the provider payload is released.

The following are implemented in code but not yet proven against a live PostgreSQL/provider environment:

- Opaque login sessions, forced-RLS tenant reads, audited user commands and time-limited agency support sessions.
- Persistent completed jobs, consent evidence, review requests, outbox/attempt history, provider webhooks, Google review cache and audit events.
- Google OAuth/PKCE, encrypted tokens, actor-bound single-use account/location selection, scheduled review sync, Pub/Sub verification, token refresh/disconnect primitives and cached-review purge.
- Twilio and SendGrid delivery adapters, signed callbacks, STOP/unsubscribe suppression and dispatch-time quiet-hour/retry fencing.
- Forward-only billing/SMS migration 004 with exact Pro/Multi prices, pooled segment reservations before Twilio, per-location usage, safe allowance holds, threshold records and non-Stripe pilot-period resets.
- Forward-only Stripe migration 005 plus hosted Checkout, Customer Portal, server-side Price verification, exact-body signature checks, replay-safe events and paid-setup activation fencing.
- Combined business reporting with durable per-location job, delivery, click, review and SMS totals.
- Public QR resolution, privacy-minimised scans and provider continuation tracking.

Launch blockers that remain outside or incomplete in the current code path:

- Execute all migrations and `database/tests/003_tenant_isolation.sql` on clean PostgreSQL as the real least-privilege roles; add the remaining two-connection race and pool-reuse evidence.
- Complete MFA challenge/enrolment and verified step-up evidence before any agency support user handles live tenant data.
- Execute Google account/location selection against the approved pilot account, including a multi-profile account if available, and attach evidence that access and refresh tokens never reach the browser.
- Add a signed completed-job CRM/webhook endpoint that derives tenant and location from a server-owned integration identity. Until then, pilot intake is manual through the authenticated business API.
- Deploy through a real secret manager and prove key rotation, Google token revocation, provider timeout reconciliation, dead-letter recovery, emergency pause and 30-day purge jobs.
- Obtain Google Business Profile API approval, configure real Twilio/SendGrid accounts, and run the full one-business pilot before enabling Stripe Checkout, paid SMS bundles or public registration.
- Rotate the exposed Stripe test key, configure a least-privilege replacement and test-mode Prices/webhook, then prove successful, failed, delayed, expired, cancelled, past-due and replayed event paths against clean PostgreSQL before live mode.
- Complete legal, privacy, consent, retention, regional-hosting and subprocessor review for the launch regions.

The React workspace demonstrates the intended operation of these paths. It is not evidence that PostgreSQL, provider or compliance controls are live until the checklist and pilot have attached results.
