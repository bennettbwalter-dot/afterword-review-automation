# Security and launch checklist

All acceptance items remain unchecked. The repository now contains an authenticated API, PostgreSQL migrations, a worker, provider adapters and executable test definitions, but that is not production verification. A checked item must link to a captured test run, deployed control or approved operational record.

## Repository implementation snapshot

Present in code:

- Forward-only migrations 001-004, checksum tracking, forced RLS, composite tenant keys, safe column grants and session-derived request context.
- Separate application (auth/runtime), public-ingress (ingress only) and worker (worker only) process surfaces, with distinct database login identities.
- Persistent completed jobs, encrypted contact/message fields, immutable templates, consent, review requests, outbox/attempts, suppressions, Google review cache and audit events.
- Opaque-cookie login/logout, tenant-scoped APIs, audited support sessions, Google OAuth/review sync, Twilio/SendGrid adapters, signed provider webhooks and the QR review flow.
- Server-owned Pro/Multi plan state, pre-provider SMS segment reservations, per-location usage, safe allowance holds, threshold records and combined multi-location reporting. Stripe checkout and paid bundle activation are not present.
- Node security tests plus `database/tests/003_tenant_isolation.sql`, `.github/workflows/application-security.yml` and `.github/workflows/database-security.yml`.

Not executed or approved:

- There is no local PostgreSQL runtime, so the migrations and SQL isolation suite have not been run in this workspace.
- No real Google Business Profile, Twilio or SendGrid credentials have been used. Google Business Profile API approval and a verified profile are external prerequisites, and Google provides no API sandbox.
- No real-business pilot has run. Billing, public registration and public launch remain blocked.
- MFA-required accounts fail closed, but MFA challenge/enrolment and verified step-up evidence are not implemented. Agency support access must remain off.
- A signed CRM completed-job ingress endpoint is not implemented. The controlled pilot must use the authenticated manual business endpoint.

## Database and role bootstrap

- [ ] A dedicated PostgreSQL 15.9+ test environment executes forward migrations 001-004 successfully.
- [ ] `afterword_migration_owner` owns the dedicated database, and it or `pg_database_owner` owns the `public` schema; the DBA has not substituted a narrower `CREATE` grant.
- [ ] `afterword_migration_owner`, `afterword_auth`, `afterword_runtime`, `afterword_ingress`, `afterword_worker` and `afterword_ops` are `NOLOGIN` and `NOBYPASSRLS`.
- [ ] API, webhook, worker and operations logins inherit exactly one matching group and cannot `SET ROLE` to an owner or another runtime group.
- [ ] Runtime principals do not own tables, views, schemas or `SECURITY DEFINER` functions.
- [ ] The decision to retain one migration/function owner or split authz, command, audit and worker owners has passed database threat-model review.
- [ ] Revoking `CREATE` from `PUBLIC` on the database's `public` schema is compatible with the deployment environment.
- [ ] Catalog tests prove no `PUBLIC EXECUTE`, unexpected schema privilege, direct runtime DML or worker table access exists.
- [ ] Every table has `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY`.

## Identity, tenant and RLS gate

- [ ] The production authentication design is approved, and MFA challenge/enrolment is implemented and enforced for agency roles.
- [ ] The API supplies only the hashed opaque session token and optional exact support-session ID; `set_request_context_from_session` derives user, MFA and step-up evidence from stored session state inside every transaction.
- [ ] Missing context is explicitly cleared and pooled connections are reset and tested for cross-request leakage.
- [ ] Browser clients and user-supplied SQL can never obtain a database connection.
- [ ] Deployment secrets prove the application has auth/runtime credentials only, public ingress has ingress only, the worker has worker only, and no application process receives the migration credential.
- [ ] Reverse-proxy trust is either disabled for direct serving or pinned to the exact protected hop count with direct origin access blocked.
- [ ] Disabled users, inactive memberships and archived tenants lose access promptly.
- [ ] Business owner/admin, operator, viewer and billing permissions pass positive and negative tests.
- [ ] Operator/viewer location access is explicit and default-deny; billing cannot read customer, consent, job or audit records.
- [ ] Cross-tenant and cross-location inserts fail at both RLS and composite foreign-key boundaries.
- [ ] Safe-view and column-grant tests prove token hashes, secret references, encrypted payloads, consent evidence, suppression hashes, audit metadata, lease tokens, message deduplication keys and provider idempotency keys cannot be read by runtime users.

## Agency support gate

- [ ] Agency portfolio queries expose non-PII summaries only.
- [ ] Tenant detail requires the exact `app.support_session_id`; another active session for the same actor is insufficient.
- [ ] Agency roles without a support session can read agency-scoped audit events but cannot read business-scoped audit rows.
- [ ] Support checks bind actor, agency, business and scope and recheck active membership on every request.
- [ ] View access rejects expired sessions, 15-minute inactivity and MFA evidence older than 12 hours.
- [ ] Configuration access rejects missing or step-up evidence older than 15 minutes.
- [ ] Agency support members cannot create configuration sessions.
- [ ] Concurrent session-start tests prove one actor cannot hold overlapping tenant contexts.
- [ ] Session actor, tenant, scope, evidence, start and expiry are immutable and lifecycle timestamps cannot move backwards.
- [ ] A persistent UI banner identifies the effective tenant and offers an immediate exit action.

## Audited command gate

- [ ] All user mutations use named commands; the API has no direct table DML.
- [ ] Each successful administrative mutation and its audit event commit atomically.
- [ ] Expected denials are logged in a separate committed transaction before the API returns 403.
- [ ] Unexpected failures are written to a durable post-rollback security log.
- [ ] RLS-silent denied reads that require evidence are routed through audited APIs.
- [ ] Correlation/idempotency tests prove retries cannot create duplicate audit events or duplicate mutations.
- [ ] Last-owner removal and role hierarchy pass two-connection race tests.
- [ ] Invitation create/accept/revoke is typed, token-digest based, row-locked, atomic and audited.
- [ ] Integration connect/rotate/revoke, support revoke, ownership transfer and dead-letter replay have dedicated audited commands.
- [ ] Audit rows cannot be updated or deleted by any runtime principal.

## Messaging and compliance gate

- [ ] Jobs link to an enrolment, destination, immutable template version, consent evidence and suppression decision.
- [ ] A single dispatch-authorization command rechecks permission immediately before every send.
- [ ] Consent evidence stores wording, purpose, channel, source, timestamp and withdrawal evidence.
- [ ] Missing or insufficient permission blocks enrolment before queue creation and again at dispatch.
- [ ] SMS and email suppression lists are separate, immediate and preserve lifted history.
- [ ] STOP and equivalent replies suppress before any further queued message can send.
- [ ] Quiet hours and frequency limits are jurisdiction and time-zone aware and rechecked after retries.
- [ ] The maximum three-message sequence is enforced transactionally.
- [ ] Neutral templates identify the business and include required unsubscribe instructions without review gating.
- [ ] Data access, export, deletion and retention workflows are tested.
- [ ] Google and every supported platform's current policies are reverified before launch.
- [ ] Qualified legal advice has reviewed launch regions, consent language and message flows.

## Webhook and queue gate

- [ ] HTTPS, body-size limits and provider-specific authentication are enforced before ingestion: Twilio request signatures, SendGrid signed timestamp/body and Google Pub/Sub OIDC with exact audience and service-account identity.
- [ ] Signature tampering, timestamp freshness where supplied, OIDC claim failures and safe verification-key rotation are tested.
- [ ] Duplicate and simultaneous webhook events return success without duplicate enrolment.
- [ ] A signed completed-job ingress derives business and location from a server-owned integration identity, then creates the ingress receipt and enrolment/job as one durable, restart-safe workflow. Until this exists, only manual authenticated pilot intake is permitted.
- [ ] Concurrent workers cannot claim the same job (`FOR UPDATE SKIP LOCKED` test).
- [ ] Claim, renewal, attempt start and completion require the exact lease token.
- [ ] Expired leases with no provider call are reclaimable; expired `sending` attempts enter reconciliation and are not resent.
- [ ] One local provider-attempt identity remains stable across every retry of a logical message and is correlated to signed provider events.
- [ ] Twilio's lack of send idempotency and SendGrid's timeout behaviour are proven with timeout tests; ambiguous outcomes enter reconciliation and are never blindly resent.
- [ ] Definite failures back off, stop at `max_attempts` and enter dead letter.
- [ ] Reconciliation and dead-letter replay are restricted, throttled and audited.
- [ ] Global/agency and tenant/location/channel/automation pauses hold rather than discard jobs.
- [ ] A pause created after claim blocks attempt start before the provider call.
- [ ] A provider/credential emergency kill switch is tested for the final database-to-network race.
- [ ] Per-tenant, per-location and provider throttles are implemented and load-tested.

## Operational and privacy gate

- [ ] Integration health and queue alerts reach the correct business and agency without exposing customer PII.
- [ ] Backups and a full restoration exercise are complete.
- [ ] Incident response, break-glass access and key rotation are documented and rehearsed.
- [ ] Secret-manager access, OAuth token rotation and provider credential revocation are tested.
- [ ] Google API review content is hidden after at most 30 days and the expired-cache purge job is scheduled, monitored and tested.
- [ ] Privacy policy, DPA, retention policy, subprocessor list and deletion procedure are approved.
- [ ] Regional hosting and international-transfer requirements are documented.
- [ ] Production observability redacts message bodies, destinations, tokens and raw provider payloads.
- [ ] Monthly reports are reproducible from durable data and have tenant-isolation tests.

## External integration and pilot gate

- [ ] The Google Cloud project is approved for Business Profile APIs, the OAuth client uses only the required `business.manage` scope, and the pilot profile is verified.
- [ ] Google account/location selection works for the pilot account, including actor-bound single-use selection when multiple profiles are returned, with evidence that OAuth tokens never reach the browser.
- [ ] Pub/Sub push targets `/webhooks/google-business-profile/reviews` with an audience that exactly matches the deployed HTTPS URL.
- [ ] Twilio status and inbound STOP callbacks and SendGrid Event Webhook callbacks use the exact deployed URLs and pass signature tests.
- [ ] One real, consented business completes the full pilot runbook with no stop condition, documented owner sign-off and seven days of observed evidence.
- [ ] Billing and public self-service remain disabled until engineering/security, operations and the pilot business owner approve the result.
- [ ] The Stripe key exposed during setup has been rolled, its Workbench request history reviewed, and the replacement is a test/live-separated restricted key with an access policy.
- [ ] The application process holds the Stripe API key and Price IDs; ingress holds only the endpoint signing secret; neither credential appears in browser assets, logs, provider metadata or repository history.
- [ ] `/webhooks/stripe` subscribes only to the documented Checkout and subscription events, verifies the unchanged raw body, rejects missing/invalid signatures, deduplicates event IDs and fails closed when an ID is reused with a different payload.
- [ ] Test evidence covers immediate and delayed success, payment failure, expiry, cancellation, past-due recovery, out-of-order subscription events and webhook replay.

## Commercial and data-use gate

- [ ] Checkout charges the applicable setup fee before Google, QR, messaging or template implementation starts; no free trial path exists.
- [ ] Stripe products and prices match `docs/product-commercial-rules.md`, and webhook-backed subscription state is the server-owned source of truth.
- [ ] The server retrieves each configured Price before Checkout and rejects wrong currency, amount, interval, active state or one-time/recurring type.
- [ ] An account cannot become Active until a signed event records both an active subscription and the paid setup fee; a success URL or browser payload never changes billing state.
- [ ] Stripe Tax remains disabled until registrations and tax treatment are confirmed, or registered jurisdictions and calculation evidence are attached before it is enabled.
- [ ] SMS usage counts provider-billable segments and enforces the 100-segment Pro allowance or 300-segment pooled Multi allowance.
- [ ] Accounts receive alerts at 75%, 90% and 100%, with tested billing-period resets and location-level Multi usage.
- [ ] Each owner has a recorded choice between a £10 automatic 100-segment bundle and pausing SMS while email continues.
- [ ] Customer-facing copy includes the implementation guarantee and does not promise review volume, ratings, rankings, enquiries or revenue.
- [ ] The customer platform contains no Google Maps-derived prospect database, and experimental lead-generation work cannot share production Google API credentials or projects.
