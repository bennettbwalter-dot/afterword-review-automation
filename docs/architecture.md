# Afterword architecture

## Status and implementation boundary

Afterword is currently a front-end prototype plus an unexecuted PostgreSQL design draft. The browser experience is not connected to the migration, does not authenticate users, and does not send messages or call Google. Nothing in this document should be treated as evidence that a production control has passed.

The target remains one multi-tenant SaaS application. Client workspaces and the agency portfolio share one identity system, API and PostgreSQL database. Navigation is derived from memberships and capabilities; there is no separate, implicitly trusted admin application.

`database/migrations/001_multi_tenant_foundation.sql` targets PostgreSQL 15.9 or newer. This workspace has no PostgreSQL runtime, so the migration has received static review only. Executing it and running integration and concurrency tests as the real database roles are launch blockers.

The migration requires a dedicated database owned by `afterword_migration_owner`. The `public` schema must belong to that role or PostgreSQL 15's `pg_database_owner` role. Those ownership rules let the migration revoke public schema creation; a plain `CREATE` grant does not satisfy the bootstrap contract.

## Client QR review flow

Migration `002_client_qr_review_flow.sql` separates the permanent public QR token from both rendered artwork and the mutable Google destination. Each active location has one active QR record. Regenerating PNG, SVG, or PDF artwork increments `artwork_revision` while preserving `public_token`, so previously printed material keeps working.

The public edge resolves `/r/:token` through the restricted ingress command surface, records a privacy-minimised scan event, and then redirects to the verified Google review URL. Raw IP addresses are not stored. Approximate unique scans use a rotating server-side keyed hash. Review attribution is explicitly labelled by method and confidence because Google review sync does not provide deterministic scan-to-review identity.

Only a business owner/admin or a configuration-scoped support session may replace a review destination or regenerate artwork. Tenant dashboards can read only their own destination, QR, scan, and conversion rows through RLS. The public edge receives only the destination required for an active, verified token.

## Runtime boundaries

```text
Browser
  -> Identity provider
  -> Afterword API (trusted request-context boundary)
       -> afterword_runtime
       -> PostgreSQL RLS + audited command functions
       -> Secret manager

Webhook receiver -> afterword_ingress -> authenticated durable ingress functions
Delivery worker  -> afterword_worker  -> lease/outbox/attempt functions -> providers
Operations       -> afterword_ops     -> global pause + reconciliation functions
```

The browser never connects to PostgreSQL and never receives provider secrets. Login roles inherit exactly one matching `NOLOGIN`, `NOBYPASSRLS` group role:

- `afterword_runtime` can read RLS-filtered safe columns and execute named user commands.
- `afterword_ingress` can record nonces and authenticated webhook receipts only.
- `afterword_worker` can claim, renew and finish message work only.
- `afterword_ops` can control global pauses and reconcile ambiguous provider results only.
- `afterword_migration_owner` owns the draft objects and is never inherited by an application login.

The migration revokes direct runtime DML, schema creation and default `PUBLIC EXECUTE` on private functions. It repeats the function revoke after all functions are created, then grants only named entry points. A production DBA must verify these catalog privileges. Splitting authorization, command, audit and worker functions across narrower owner roles would further reduce the blast radius of a defect in a `SECURITY DEFINER` function and remains an architecture sign-off decision.

## Request context

For each API request, the API must begin a transaction and set trusted context with transaction-local settings only:

```sql
select set_config('app.user_id', :verified_user_id, true);
select set_config('app.mfa_verified_at', :verified_mfa_time, true);
select set_config('app.step_up_verified_at', :verified_step_up_time_or_empty, true);
select set_config('app.support_session_id', :exact_session_id_or_empty, true);
```

The API must explicitly clear absent values and reset pooled connections before reuse. Custom PostgreSQL settings are not authentication: any principal with arbitrary SQL access could forge them. Database connections therefore belong only to the trusted, parameterized API and never to browser clients or user-supplied SQL.

## Tenant and location model

- `business_id` is the hard tenant boundary.
- `agency_id` groups managed businesses but never substitutes for tenant isolation.
- A location is a scope within one business.
- Tenant identifiers are immutable after insert.
- Every tenant-owned operational row carries `business_id NOT NULL`.
- RLS is enabled and forced on every table in the draft; missing runtime policies default to deny.
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

Secrets themselves belong in a secret manager and are referenced by opaque IDs only. Raw-event evidence belongs in encrypted object storage with an explicit retention policy.

## Webhook, queue and outbox model

The receiver must verify HTTPS, HMAC, timestamp freshness and body limits before calling the database. `accept_ingress_nonce` provides replay protection, and `record_ingress_event` stores a durable, tenant-bound receipt with database uniqueness for simultaneous duplicate deliveries. A webhook request never sends a customer message directly.

Message execution uses a logical job plus a durable provider outbox and attempt history:

1. Workers atomically claim eligible jobs with `FOR UPDATE SKIP LOCKED`.
2. Every lease has an unguessable token; renew and completion calls require worker ID plus the exact token.
3. Global/agency and tenant/location/channel/automation pauses are checked at claim time.
4. The pause predicate is checked again when an attempt starts, immediately before the provider call.
5. One stable provider idempotency key is reused for every attempt of the logical message.
6. Accepted sends complete the job. Definite failures back off or dead-letter at the attempt limit.
7. Unknown provider results and expired leases that were already `sending` enter `reconciliation_required`; they are never blindly retried.
8. A separate operations principal resolves reconciliation after querying provider state.

Database deduplication does not create exactly-once delivery at an external provider. Launch requires a provider that honors the stable idempotency key or exposes reliable reconciliation. A provider/credential kill switch is also required because a tiny race remains between the last database pause check and the network call.

## Deliberately incomplete production work

The draft does not yet model or enforce the full message decision at dispatch. Jobs are not linked to a destination, enrolment, template/version, consent evidence or suppression decision, so the database cannot yet recheck consent, STOP suppression, quiet hours, frequency limits or the maximum three-message sequence. No production message should be sent until those entities and a single dispatch-authorization command exist.

Other launch-blocking work includes:

- Execute the migration on PostgreSQL 15.9+ and add catalog, RLS, role and two-connection race tests.
- Build the trusted API transaction/context layer and validate connection-pool reset behavior.
- Add audited invitation acceptance, agency bootstrap, integration rotate/revoke and dead-letter replay commands.
- Add an operation-key registry so retried create commands cannot create a second resource with a new target ID.
- Add the durable enrolment-to-job creation command; ingress currently records receipts but does not schedule customer messages.
- Integrate identity, secret management, provider credentials, Google OAuth, reporting and retention workflows.
- Prove provider idempotency/reconciliation behavior and emergency kill-switch operation.
- Complete legal, privacy, consent and regional launch review.

The current React UI remains a design and interaction prototype. It is not evidence that any backend, provider or compliance path is live.
