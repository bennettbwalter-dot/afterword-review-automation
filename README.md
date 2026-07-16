# Afterword

Afterword connects a Google Business Profile to completed-job events and turns those events into neutral, consent-backed review requests by SMS or email.

This branch contains two distinct surfaces:

- A polished React workspace and public QR review flow.
- An authenticated Fastify/PostgreSQL foundation for real users, agencies, businesses, requests, consent records, reviews, audit events and provider delivery.

It is a backend foundation, not a production launch. The PostgreSQL migrations and SQL tenant-isolation suite have not been executed in this workspace because no PostgreSQL runtime is available. Google Business Profile, Twilio and SendGrid have not been exercised with real credentials, and no real-business pilot has run.

## Run locally

For the explicit seeded demo, which does not require PostgreSQL:

```powershell
npm.cmd install
npm.cmd run dev:demo
```

Open `http://127.0.0.1:4173`. Seeded data and the role preview are available only when Vite runs with `VITE_DEMO_MODE=true` through `.env.demo`.

For the authenticated API and web application:

1. Provision PostgreSQL 15.9 or newer and the `NOLOGIN`, `NOBYPASSRLS` group roles described in [`docs/architecture.md`](docs/architecture.md).
2. Copy `.env.example` to `.env` and replace every placeholder. The entrypoints load this local file automatically. Production must inject only the credentials each process needs: auth/runtime for the application API, ingress for the public edge, and worker for the background worker.
3. Apply the forward-only migrations and bootstrap the first business owner:

```powershell
npm.cmd run db:migrate
npm.cmd run db:bootstrap
```

4. Start the API and web application, then start the worker in a second terminal:

```powershell
npm.cmd run dev
npm.cmd run worker
```

When Twilio or SendGrid environment variables are present, `db:bootstrap` also creates the pilot location's provider integration records and prints their IDs. Use the printed `twilioIntegrationId` in the signed inbound STOP/START callback URL; the credential values themselves are never stored in those rows.

Do not use `DATABASE_URL` in production. `MIGRATION_DATABASE_URL` is a separate privileged deployment credential and must not be available to the API or worker.

## Implemented foundation

- Opaque, hashed server sessions in secure cookies, password hashing, origin checks, rate limits, logout/revocation and disabled-user handling.
- A server-side workspace API. Browser-selected role and tenant values are not authorization inputs; seeded browser data is confined to explicit demo mode.
- Session-derived PostgreSQL request context. The runtime connection supplies the opaque session hash, and database authorization derives the user and support context from stored session state.
- Separate process and connection surfaces: the authenticated application opens auth/runtime only, public QR and provider webhooks open ingress only, and the background worker opens worker only. PostgreSQL adds forced RLS, composite tenant keys, safe column grants and audited command functions.
- Persistent completed jobs, encrypted customer contact fields, immutable template versions, consent evidence, review requests, message jobs/outbox/attempts, suppressions, Google reviews, QR scans and audit logs.
- An authenticated manual completed-job endpoint with stable duplicate keys and a final dispatch decision that rechecks consent, suppression, pauses, quiet hours, frequency limits, sequence limits and lease ownership.
- A durable delivery worker with Twilio SMS and SendGrid email adapters, signed provider callbacks, STOP/unsubscribe handling, retry/backoff and ambiguous-outcome quarantine.
- Google Business Profile OAuth with PKCE, encrypted token storage, actor-bound single-use multi-profile selection, durable sync scheduling, Pub/Sub push verification and review reconciliation.
- Google disconnect commands, token-revocation queue primitives and a 30-day maximum cache window for Google API review content.
- Client-specific QR review flows with stable public tokens, privacy-minimised scan tracking, verified Google destinations, artwork regeneration, and PNG, SVG and print-ready PDF downloads.
- A PostgreSQL isolation workflow covering session binding, cross-tenant RLS, dispatch fencing, webhook deduplication and role grants, plus an application workflow for typecheck, Node tests and production build.

## Important launch gates

- Google Business Profile API access requires Google approval and a verified Business Profile. Google does not provide a Business Profile API sandbox, so the first live validation must be tightly scoped to the approved pilot business.
- The OAuth scope is `https://www.googleapis.com/auth/business.manage`.
- MFA-required accounts currently fail closed. An MFA challenge/enrolment path and verified MFA evidence are still required before agency support access can go live.
- The only completed-job intake currently exposed is the authenticated manual API: `POST /api/v1/businesses/:businessId/completed-jobs`. A signed CRM/webhook intake that derives tenant and location from server-owned integration identity is not implemented, so the first pilot must use manual authenticated intake.
- Provider credentials, signatures, retry behaviour, STOP/unsubscribe handling, token refresh/revocation, cache purge and reconciliation must be proven against real provider accounts.
- Billing, public registration and public launch remain disabled until the one-business pilot in [`docs/pilot-runbook.md`](docs/pilot-runbook.md) passes.

Google review objects do not contain an Afterword request or customer identifier. Review conversion reporting is therefore estimated and must never be presented as deterministic person-level attribution.

## Checks

```powershell
npm.cmd run typecheck
npm.cmd run test
npm.cmd run build
# or all three
npm.cmd run check
```

The Node tests exercise API/security helpers, process-surface separation and provider-signature behaviour without a live database. Database proof is separate: apply all migrations to a clean PostgreSQL instance and run `database/tests/003_tenant_isolation.sql` as the real least-privilege roles. The repository includes `.github/workflows/application-security.yml` and `.github/workflows/database-security.yml`, but their presence is not evidence that either workflow has passed.

## Architecture and launch artifacts

- [`docs/architecture.md`](docs/architecture.md) - trust boundaries, tenant model, provider flow and known gaps.
- [`docs/security-launch-checklist.md`](docs/security-launch-checklist.md) - evidence-based pre-launch gates.
- [`docs/pilot-runbook.md`](docs/pilot-runbook.md) - controlled one-business activation and acceptance plan.
- [`database/migrations/003_authenticated_review_automation.sql`](database/migrations/003_authenticated_review_automation.sql) - authenticated persistence, dispatch, provider and retention foundation layered on migrations 001 and 002.
- [`database/tests/003_tenant_isolation.sql`](database/tests/003_tenant_isolation.sql) - PostgreSQL role and tenant-isolation checks.

## Permanent QR origin

QR exports use `VITE_PUBLIC_REVIEW_BASE_URL` as their permanent redirect origin. Set it to an owned, long-lived HTTPS domain before artwork goes to print. Demo Google destinations are visibly unverified and must be replaced with the client location's real Google "Ask for reviews" URL before pilot use.
