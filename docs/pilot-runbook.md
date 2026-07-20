# One-business pilot runbook

The pilot is a launch gate, not a demo. Billing and public self-service stay disabled until every acceptance item below has evidence attached to the pilot record.

Current execution status: **not started**. Migrations 001-008 and the SQL isolation tests have not been run locally because this workspace has no PostgreSQL runtime. No current-branch Google Business Profile, Twilio or SendGrid provider journey, or Stripe Checkout/webhook journey, has been run. Earlier Stripe test-mode API/catalog connectivity evidence predates this branch and is not pilot proof.

## Required access

- One verified Google Business Profile whose owner has approved Review Anchor access. Google does not provide a Business Profile API sandbox.
- A Google Cloud project approved for Business Profile APIs, an OAuth web client, exact redirect URI, and only the `https://www.googleapis.com/auth/business.manage` scope.
- A Pub/Sub topic and authenticated push subscription for `NEW_REVIEW` and `UPDATED_REVIEW` notifications, plus a scheduled reconciliation sync.
- A registered Twilio sender or Messaging Service and/or a SendGrid account with an authenticated sending domain.
- Four separate production PostgreSQL login URLs for authentication, tenant runtime traffic, webhook/QR ingress and workers. Each login inherits exactly one matching `NOLOGIN`, `NOBYPASSRLS` group role and none owns schema objects. Inject auth/runtime only into the application, ingress only into the public edge, and worker only into the worker.
- Approved customer-contact consent wording, privacy notice, retention schedule, quiet-hour timezone, sender identity, and suppression process.
- A named business owner and operator who can stop the pilot immediately. Use the business-owner path for this pilot; agency support access cannot be enabled until MFA challenge/enrolment and verified step-up evidence are implemented.
- A Stripe test-mode catalog, newly rotated restricted API key, Customer Portal configuration and webhook signing secret prepared according to [`stripe-setup.md`](stripe-setup.md). Keep Checkout disabled during the operational pilot.

Secrets belong in the deployment secret manager. Do not paste credentials into the browser, source control, pilot notes, provider metadata, or message custom arguments.

The current code exposes completed-job intake only through authenticated `POST /api/v1/businesses/:businessId/completed-jobs`. There is no signed CRM/webhook intake that derives tenant and location from a server-owned integration identity. Use the authenticated manual endpoint for this pilot and do not expose it as a general integration endpoint.

Configure provider callbacks to their exact deployed HTTPS URLs:

- Twilio message status: `/webhooks/twilio/status`
- Twilio inbound STOP/START: `/webhooks/twilio/inbound/:integrationId`, with the UUID for the pilot messaging integration
- SendGrid Event Webhook: `/webhooks/sendgrid/events`
- Google Pub/Sub push: `/webhooks/google-business-profile/reviews`; `GOOGLE_PUBSUB_AUDIENCE` must be the same full URL
- Stripe billing events: `/webhooks/stripe`; subscribe only to the event list in [`stripe-setup.md`](stripe-setup.md)

## Safe activation order

1. Create the six database group roles and four application logins, then apply migrations 001-008 in a clean PostgreSQL environment before starting this branch's API. Migration 008 is required because the authenticated session projection consumes the business membership role it exposes. Run `database/tests/003_tenant_isolation.sql` and the remaining pool-reuse/two-connection checks, then deploy the three capability-separated API, ingress and worker processes from `render.paid.yaml`. If a reverse proxy is used, pin the exact trusted hop count and block direct origin access.
2. Bootstrap one business-owner account and one location with `BOOTSTRAP_PLAN=pro_monthly`. This creates a non-chargeable pilot billing period and a 100-segment allowance. When provider variables are configured, retain the printed `twilioIntegrationId` for the inbound callback URL. Keep Stripe checkout, paid top-ups, agency support access and public registration off.
3. Connect Google, explicitly choose the correct account/location when more than one is returned, capture the canonical Google review URL, then run a read-only review reconciliation. Confirm the selection is actor-bound, single-use and exposes no OAuth tokens to the browser.
4. Configure the exact provider callback URLs above and prove bad signatures/OIDC claims are rejected before any live send. Send only to controlled internal destinations first.
5. Prove STOP/unsubscribe suppression, quiet-hour deferral, retry backoff, duplicate-job handling, an ambiguous provider timeout, and the global/business pause control.
6. Enable one channel for the pilot location. Submit a small batch of genuine, consented, completed jobs through the authenticated manual endpoint; do not upload prospects or filter recipients by expected sentiment.
7. Observe queue state, provider acceptance, delivery receipts, link continuations, Google review detection, failures, suppressions and cache expiry for at least seven days.
8. Disconnect Google and messaging in a rehearsal, verify queued work stops and token revocation/deletion completes, reconnect, and document the recovery time.
9. Schedule and observe the Google review-content purge. Cached review bodies, reviewer names and replies must not remain available more than 30 days after the last Google sync.
10. After the operational pilot passes and written billing approval is recorded, enable Stripe in test mode only. Prove Checkout, setup-fee collection, subscription activation, Customer Portal, delayed/failing payments, cancellation, past-due recovery, signature rejection and replay handling against the pilot tenant.
11. Rotate test credentials as a rehearsal, complete tax/legal review, create equivalent least-privilege live credentials and Prices, and obtain a separate written go-live decision before setting `STRIPE_MODE=live`.

## Acceptance evidence

| Gate | Pass condition |
| --- | --- |
| Tenant isolation | Cross-tenant reads and writes fail at both the API and PostgreSQL RLS layers, including pooled-connection reuse. |
| Authentication | Opaque secure cookies, expiry/revocation, rate limiting, origin checks, disabled-user handling, and no browser-selected role or tenant authority. |
| Consent | Every attempted request links to immutable wording/version, capture time, source, channel, and transaction reference. Missing or withdrawn consent never reaches a provider. |
| Delivery safety | Final in-transaction authorization rechecks active consent, suppression, pause, frequency cap, quiet hours, lease ownership, and attempt budget immediately before send. |
| SMS allowance | The rendered message's GSM-7/UCS-2 segments are reserved before Twilio, definite failures release usage, ambiguous outcomes remain protected, and reaching the allowance holds SMS without blocking email. |
| Stripe billing | Checkout uses server-validated GBP Prices, charges setup on the initial invoice, accepts no browser amount, rejects unsigned or altered events, deduplicates replayed event IDs and does not activate until both subscription and setup-payment state agree. |
| Duplicate safety | Replaying a completed-job key does not create another review request or provider send. Ambiguous provider timeouts enter reconciliation instead of blind retry. |
| Suppression | STOP/unsubscribe/bounce events are signature-verified, deduplicated, and block the next attempted send. |
| Google monitoring | Initial reconciliation, new-review event, updated-review event, duplicate Pub/Sub delivery, token refresh, disconnect/revocation and the 30-day maximum cache purge all have evidence. |
| Neutrality | Every customer receives the same neutral review invitation; no rating prediction, incentive, negative-feedback diversion, or review gating is present. |
| Operations | Pause, dead-letter, integration-health, audit, disconnect, and incident-owner paths are usable by the authorised operator. |
| Reporting | Combined business totals and every location row reconcile to completed jobs, accepted/delivered events, link continuations, detected reviews and SMS usage. Review conversion is labelled estimated, not person-level attribution. |

## Stop conditions

Pause the pilot immediately for any cross-tenant visibility, unsigned webhook acceptance, duplicate customer send, send after suppression/withdrawal, send outside configured hours, unexplained provider timeout retry, or Google token/account mismatch. Preserve the audit trail, revoke affected credentials, and complete a root-cause review before resuming.

## Launch decision

Record the business owner, operator, dates, channels, message count, acceptance evidence, incidents and unresolved risks. Public launch and billing require written sign-off from product, engineering/security, operations and the pilot business owner. Code presence, a simulated demo or a provider dashboard screenshot without tenant-linked audit evidence is not a pass.
