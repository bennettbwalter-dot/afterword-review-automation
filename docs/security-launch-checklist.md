# Security and launch checklist

All items remain unchecked. This repository contains a browser prototype and a PostgreSQL design draft, not production verification. A checked item must link to executable evidence, a test run or an approved operational record.

## Database and role bootstrap

- [ ] A dedicated PostgreSQL 15.9+ test environment executes `001_multi_tenant_foundation.sql` successfully.
- [ ] `afterword_migration_owner` owns the dedicated database, and it or `pg_database_owner` owns the `public` schema; the DBA has not substituted a narrower `CREATE` grant.
- [ ] `afterword_migration_owner`, `afterword_runtime`, `afterword_ingress`, `afterword_worker` and `afterword_ops` are `NOLOGIN` and `NOBYPASSRLS`.
- [ ] API, webhook, worker and operations logins inherit exactly one matching group and cannot `SET ROLE` to an owner or another runtime group.
- [ ] Runtime principals do not own tables, views, schemas or `SECURITY DEFINER` functions.
- [ ] The decision to retain one migration/function owner or split authz, command, audit and worker owners has passed database threat-model review.
- [ ] Revoking `CREATE` from `PUBLIC` on the database's `public` schema is compatible with the deployment environment.
- [ ] Catalog tests prove no `PUBLIC EXECUTE`, unexpected schema privilege, direct runtime DML or worker table access exists.
- [ ] Every table has `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY`.

## Identity, tenant and RLS gate

- [ ] The production identity provider is selected and MFA is enforced for agency roles.
- [ ] The API sets user, MFA, step-up and exact support-session context with `SET LOCAL` inside every transaction.
- [ ] Missing context is explicitly cleared and pooled connections are reset and tested for cross-request leakage.
- [ ] Browser clients and user-supplied SQL can never obtain a database connection.
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

- [ ] HTTPS, HMAC signature, timestamp window, nonce replay and body-size limits are enforced before database ingestion.
- [ ] Constant-time signature comparison and safe secret rotation are tested.
- [ ] Duplicate and simultaneous webhook events return success without duplicate enrolment.
- [ ] Ingress receipt and enrolment-to-job creation form one durable, restart-safe workflow.
- [ ] Concurrent workers cannot claim the same job (`FOR UPDATE SKIP LOCKED` test).
- [ ] Claim, renewal, attempt start and completion require the exact lease token.
- [ ] Expired leases with no provider call are reclaimable; expired `sending` attempts enter reconciliation and are not resent.
- [ ] One provider idempotency key remains stable across every retry of a logical message.
- [ ] The selected provider's idempotency and message-status reconciliation behavior is proven with timeout tests.
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
- [ ] Privacy policy, DPA, retention policy, subprocessor list and deletion procedure are approved.
- [ ] Regional hosting and international-transfer requirements are documented.
- [ ] Production observability redacts message bodies, destinations, tokens and raw provider payloads.
- [ ] Monthly reports are reproducible from durable data and have tenant-isolation tests.
